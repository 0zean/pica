import type { DelegationError, Delegator, DelegationSetup } from "../delegation/index.ts";
import type { EventDraft, EventLog } from "../events/index.ts";
import { createRuntimeEventRecorder } from "../events/index.ts";
import type { RuntimeEventRecorder } from "../events/index.ts";
import type { AgentRuntime, EngineTool, RuntimeEvent, RuntimeHooks, RuntimeSession } from "../runtime/index.ts";
import { err, ok } from "../result.ts";
import type { Result } from "../result.ts";
import type { Session, SessionState, Store, StoreError, UsageRepository } from "../store/index.ts";
import { checkWorkspaceDailyCap, createSessionBudget, sessionSpend, withinSessionCeiling } from "./budget.ts";
import type { BudgetSettings, SessionBudget } from "./budget.ts";
import { runtimeFailure, sessionFailure } from "./errors.ts";
import type { SessionResult } from "./errors.ts";
import { defaultRoutingProfile, isRoutingProfile, toSessionInfo } from "./info.ts";
import type {
  PendingApproval,
  SessionApprovalChoice,
  SessionInfo,
  SessionRoutingProfile,
  SessionSendMode,
} from "./info.ts";
import { describeRule, matchingRule, ruleFor } from "./permission-rules.ts";
import type { PermissionRules } from "./permission-rules.ts";
import { withMcpServers } from "./mcp-options.ts";
import { createStorageFailures, storageFullCode } from "./storage-full.ts";
import type { SessionMcp } from "./mcp-options.ts";
import { isLiveSessionState, transitionSession } from "./transitions.ts";
import type { SessionTrigger } from "./transitions.ts";

// Rounding between the runtime's nano-AIU total and the ledger's per-call credits.
const spendTolerance = 1e-6;

export interface SessionServiceDeps {
  readonly store: Pick<Store, "workspaces" | "repos" | "sessions" | "events">;
  readonly events: EventLog;
  readonly runtime: AgentRuntime;
  readonly clock: () => string;
  readonly newSessionId: () => string;
  readonly rootAgent?: string;
  // Tool-call hooks for one session's runtime; the policy engine (C-03) supplies them.
  readonly hooks?: (sessionId: string) => RuntimeHooks;
  // Engine-implemented tools for one session, such as the R-08 repo tools over its workspace.
  readonly tools?: (session: Session) => readonly EngineTool[];
  // C-07: the session's sub-agents. Without it the runtime gets no `customAgents`.
  readonly delegator?: Delegator;
  // The profile for a session created without one: the workspace's override, else the user's
  // config. Without it, `defaultRoutingProfile`.
  readonly defaultProfile?: (workspaceId: string) => SessionRoutingProfile;
  readonly onChanged?: (session: SessionInfo) => void;
  // Called once a session is deleted, for what the engine keeps outside the store (MCP
  // attachments, artifacts) and to announce it.
  readonly onDeleted?: (sessionId: string) => Promise<void> | void;
  // C-09: without `usage` the workspace daily cap is not checked and spend starts at zero on resume.
  readonly budget?: BudgetSettings;
  readonly usage?: Pick<UsageRepository, "rollup">;
  // X-03: awaited once the runtime is ready and once the session has ended; it does not block either.
  readonly lifecycle?: (event: SessionLifecycleEvent) => Promise<void>;
  // A-07: `permissions.tools` answer matching permission prompts, and "always allow" adds one.
  // Without it every prompt is an approval and `allow_always` allows once.
  readonly permissionRules?: PermissionRules;
  // A-13: the session's attached MCP servers. Without it sessions get none.
  readonly mcp?: SessionMcp;
}

export interface SessionLifecycleEvent {
  readonly kind: "sessionStart" | "sessionEnd";
  readonly sessionId: string;
  readonly directory: string;
  readonly writeRoots: readonly string[];
  readonly referenceRoots: readonly string[];
}

export interface CreateSessionRequest {
  readonly workspaceId: string;
  readonly writeRepoIds: readonly string[];
  readonly referenceRepoIds: readonly string[];
  readonly routingProfile?: SessionRoutingProfile | undefined;
  readonly budgetCredits?: number | undefined;
  readonly prompt?: string | undefined;
}

export interface SessionService {
  // Run once at engine start: every session the previous engine left live becomes `resumable`.
  recover(): SessionResult<readonly SessionInfo[]>;
  create(request: CreateSessionRequest): Promise<SessionResult<SessionInfo>>;
  get(sessionId: string): SessionResult<SessionInfo>;
  list(workspaceId?: string): SessionResult<readonly SessionInfo[]>;
  // `send` starts a turn on an idle session and is not accepted while one runs. `queue` runs after
  // the current turn (and any queued before it). `steer` aborts the current turn and runs next.
  send(sessionId: string, text: string, mode: SessionSendMode): Promise<SessionResult<{ readonly accepted: boolean }>>;
  abort(sessionId: string): Promise<SessionResult<undefined>>;
  resume(sessionId: string): Promise<SessionResult<SessionInfo>>;
  end(sessionId: string): Promise<SessionResult<undefined>>;
  // Sets the user's title (trimmed); an empty one clears it. Allowed in every state.
  rename(sessionId: string, title: string): SessionResult<SessionInfo>;
  // Ends a live session first, stopping any turn and dropping its pending approvals, then removes
  // its events and what the runtime keeps of it. Usage records stay. Allowed in every state.
  delete(sessionId: string): Promise<SessionResult<undefined>>;
  listApprovals(sessionId: string): SessionResult<readonly PendingApproval[]>;
  // Each pending approval is resolved at most once; a repeat answers `session.approval_not_found`.
  // For a budget approval, allowing raises the session limit to `budgetCredits` (by default, by
  // the configured session budget); denying cancels the blocked model call and ends the turn.
  resolveApproval(
    approvalId: string,
    choice: SessionApprovalChoice,
    budgetCredits?: number,
  ): Promise<SessionResult<undefined>>;
  runningCount(): number;
  // A-13: reopens an idle session's runtime so it starts with the MCP servers attached now. The
  // conversation continues; the prompt cache does not.
  reconfigure(sessionId: string): Promise<SessionResult<undefined>>;
}

type AbortReason = "user" | "budget" | "engine";

type PermissionPrompt = Pick<Extract<RuntimeEvent, { type: "permission.requested" }>["data"], "toolName" | "arguments">;

interface LiveSession {
  readonly runtime: RuntimeSession;
  readonly recorder: RuntimeEventRecorder;
  readonly approvals: Map<string, PendingApproval>;
  // The tool and arguments of each pending tool-call approval, from which "always allow" derives its rule.
  readonly prompts: Map<string, PermissionPrompt>;
  readonly queue: string[];
  readonly budget: SessionBudget;
  // True when the limit is below what the runtime accepts, so the engine stops the turn itself.
  readonly enforcesBudget: boolean;
  // Budget approvals the engine raised for its own limit; resolving them involves no runtime call.
  readonly engineApprovals: Set<string>;
  unsubscribe: () => void;
  steer: string | undefined;
  abortReason: AbortReason;
}

export function createSessionService(deps: SessionServiceDeps): SessionService {
  const { store, clock } = deps;
  const rootAgent = deps.rootAgent ?? "main";
  const live = new Map<string, LiveSession>();
  const storage = createStorageFailures((sessionId, message) => {
    void failForStorage(sessionId, message);
  });
  const events = storage.watch(deps.events);

  function read(sessionId: string): SessionResult<Session> {
    const session = store.sessions.get(sessionId);
    return session.ok ? ok(storage.overlay(session.value)) : storeFailure(session.error, `session ${sessionId}`);
  }

  function info(session: Session): SessionResult<SessionInfo> {
    const lastSeq = store.events.lastSeq(session.id);
    return lastSeq.ok ? ok(toSessionInfo(session, lastSeq.value)) : storeFailure(lastSeq.error);
  }

  function append(sessionId: string, draft: EventDraft): SessionResult<undefined> {
    const appended = events.append(sessionId, draft);
    return appended.ok ? ok(undefined) : storeFailure(appended.error);
  }

  // H-05: the disk is full. A live session's runtime is closed and the session fails with
  // `storage_full`; what the log already holds stays readable. Writing the failure may itself
  // fail, so it is remembered here too. A session without a runtime (resumable, or being
  // recovered at start) only gets the error: it can be resumed once there is space.
  async function failForStorage(sessionId: string, message: string): Promise<void> {
    const session = live.get(sessionId);
    if (session === undefined) {
      return;
    }
    live.delete(sessionId);
    session.unsubscribe();
    append(sessionId, { type: "session.error", payload: { code: storageFullCode, message }, timestamp: clock() });
    const moved = move(sessionId, "fail");
    storage.record(sessionId, message);
    const current = moved.ok ? undefined : read(sessionId);
    if (current?.ok === true) {
      changed(current.value);
    }
    await session.runtime.close();
  }

  function changed(session: Session): SessionResult<SessionInfo> {
    const current = info(session);
    if (current.ok) {
      deps.onChanged?.(current.value);
    }
    return current;
  }

  function move(sessionId: string, trigger: SessionTrigger): SessionResult<SessionInfo> {
    const session = read(sessionId);
    if (!session.ok) {
      return session;
    }
    const next = transitionSession(session.value.state, trigger);
    if (!next.ok) {
      return sessionFailure("session.invalid_state", `session ${sessionId}: ${next.error.message}`);
    }
    const at = clock();
    const updated = store.sessions.updateState(sessionId, next.value, at);
    if (!updated.ok) {
      storage.notice(sessionId, updated.error);
      return storeFailure(updated.error);
    }
    const recorded = append(sessionId, stateChanged(session.value.state, next.value, at));
    if (!recorded.ok) {
      return recorded;
    }
    return changed({ ...session.value, state: next.value, updatedAt: at });
  }

  function stateOf(sessionId: string): SessionState | undefined {
    const session = store.sessions.get(sessionId);
    return session.ok ? storage.overlay(session.value).state : undefined;
  }

  function attach(sessionId: string, runtime: RuntimeSession, budget: SessionBudget): LiveSession {
    const limit = budget.limit();
    const session: LiveSession = {
      runtime,
      recorder: createRuntimeEventRecorder(events, { sessionId, rootAgent }),
      approvals: new Map(),
      prompts: new Map(),
      queue: [],
      budget,
      enforcesBudget: limit !== null && runtimeLimit(limit) === undefined,
      engineApprovals: new Set(),
      unsubscribe: () => undefined,
      steer: undefined,
      abortReason: "user",
    };
    session.unsubscribe = runtime.subscribe((event) => {
      onRuntimeEvent(sessionId, session, event);
    });
    live.set(sessionId, session);
    return session;
  }

  // The service records what it knows better than the runtime: the user's message and its mode,
  // the approval choice, and why a turn was aborted. Lifecycle events drive the state machine.
  function onRuntimeEvent(sessionId: string, session: LiveSession, event: RuntimeEvent): void {
    switch (event.type) {
      case "user.message":
      case "permission.completed":
      case "session_limits_exhausted.completed":
        return;
      case "abort":
        session.recorder.interrupt(event.timestamp);
        append(sessionId, { type: "session.aborted", payload: { reason: session.abortReason }, timestamp: event.timestamp });
        session.abortReason = "user";
        return;
      case "permission.requested":
      case "session_limits_exhausted.requested":
        requestApproval(sessionId, session, event);
        return;
      case "assistant.usage":
        recordUsage(sessionId, session, event);
        return;
      case "session.usage_checkpoint":
        catchUpSpend(sessionId, session, event.data.billedCredits, event.timestamp);
        return;
      case "session.shutdown":
        if (event.data.billedCredits !== undefined) catchUpSpend(sessionId, session, event.data.billedCredits, event.timestamp);
        session.recorder.record(event);
        return;
      case "session.idle":
        move(sessionId, "turn_ended");
        void startNext(sessionId, session);
        return;
      default:
        session.recorder.record(event);
    }
  }

  function requestApproval(
    sessionId: string,
    session: LiveSession,
    event: Extract<RuntimeEvent, { type: "permission.requested" | "session_limits_exhausted.requested" }>,
  ): void {
    if (event.type === "permission.requested" && answerByRule(sessionId, session, event)) {
      return;
    }
    if (event.type === "permission.requested") {
      session.prompts.set(event.data.requestId, { toolName: event.data.toolName, arguments: event.data.arguments });
    }
    for (const appended of session.recorder.record(event).appended) {
      if (appended.type === "approval.requested") {
        session.approvals.set(appended.payload.id, appended.payload);
      }
    }
    if (stateOf(sessionId) === "running") {
      move(sessionId, "approval_requested");
    }
  }

  // A prompt a permission rule matches is answered at once and is no approval: the decision is
  // recorded (and audited) as the rule's, and the runtime's `permission.completed` is ignored.
  function answerByRule(
    sessionId: string,
    session: LiveSession,
    event: Extract<RuntimeEvent, { type: "permission.requested" }>,
  ): boolean {
    const { requestId, toolCallId, toolName } = event.data;
    const rule = matchingRule(deps.permissionRules?.current() ?? [], toolName, event.data.arguments);
    if (rule === undefined) {
      return false;
    }
    const allowed = rule.permission === "allow";
    append(sessionId, {
      type: "policy.decision",
      payload: {
        ruleId: "permission.rule",
        ruleGroup: "permission",
        outcome: allowed ? "allow" : "deny",
        reason: `The permission rule for ${describeRule(rule)} ${allowed ? "allows" : "denies"} it`,
        toolCallId,
        toolName,
        agent: rootAgent,
      },
      timestamp: event.timestamp,
    });
    void session.runtime.resolvePermission(requestId, allowed).then((resolved) => {
      if (!resolved.ok) {
        append(sessionId, { type: "session.error", payload: { code: resolved.error.code, message: resolved.error.message }, timestamp: clock() });
      }
    });
    return true;
  }

  function recordUsage(
    sessionId: string,
    session: LiveSession,
    event: Extract<RuntimeEvent, { type: "assistant.usage" }>,
  ): void {
    for (const appended of session.recorder.record(event).appended) {
      if (appended.type !== "usage.recorded") {
        continue;
      }
      for (const warning of session.budget.record(appended.payload.credits)) {
        append(sessionId, { type: "budget.warning", payload: warning, timestamp: appended.timestamp });
      }
    }
    if (session.enforcesBudget && session.budget.exhausted() && session.abortReason !== "budget") {
      void stopForBudget(sessionId, session);
    }
  }

  // The runtime's running total of what it billed (S-01) is the floor for the session's spend. When
  // the ledger has less, because a call carried no billed credits and its model has no prices, the
  // budget takes the difference so enforcement never trails the runtime. The ledger is unchanged:
  // the gap has no model or agent to attribute it to.
  function catchUpSpend(sessionId: string, session: LiveSession, billedCredits: number, timestamp: string): void {
    const gap = billedCredits - session.budget.spent();
    if (gap <= spendTolerance) return;
    for (const warning of session.budget.record(gap)) {
      append(sessionId, { type: "budget.warning", payload: warning, timestamp });
    }
    if (session.enforcesBudget && session.budget.exhausted() && session.abortReason !== "budget") {
      void stopForBudget(sessionId, session);
    }
  }

  // The engine's own stop for a limit the runtime does not hold (S-03): it ends the turn at once,
  // which stops billing even inside a sub-agent, and drops queued messages.
  async function stopForBudget(sessionId: string, session: LiveSession): Promise<void> {
    session.queue.length = 0;
    session.steer = undefined;
    const aborted = await abortTurn(session, "budget");
    if (!aborted.ok) {
      append(sessionId, { type: "session.error", payload: { code: aborted.error.code, message: aborted.error.message }, timestamp: clock() });
    }
    requestEngineBudgetApproval(sessionId, session);
  }

  // The same budget approval the runtime raises (`budget.exhausted`), so allowing it with
  // `budgetCredits` raises the engine's limit and the session can take turns again.
  function requestEngineBudgetApproval(sessionId: string, session: LiveSession): void {
    const limit = session.budget.limit();
    if (limit === null) {
      return;
    }
    // Unique across resumes, since earlier approvals stay in the session's event log.
    const requestId = `${sessionId}-budget-${clock()}-${String(session.engineApprovals.size + 1)}`;
    const event: RuntimeEvent = {
      id: requestId,
      timestamp: clock(),
      type: "session_limits_exhausted.requested",
      data: { requestId, usedAiCredits: session.budget.spent(), maxAiCredits: limit },
    };
    for (const appended of session.recorder.record(event).appended) {
      if (appended.type === "approval.requested") {
        session.approvals.set(appended.payload.id, appended.payload);
        session.engineApprovals.add(appended.payload.id);
      }
    }
  }

  // The limit to hand the runtime as `maxAiCredits`, or undefined when it is below the runtime's floor.
  function runtimeLimit(limit: number | null): number | undefined {
    return limit !== null && limit >= (deps.runtime.minSessionCredits ?? 0) ? limit : undefined;
  }

  function budgetExhausted(sessionId: string, session: LiveSession): SessionResult<never> | undefined {
    if (!session.enforcesBudget || !session.budget.exhausted()) {
      return undefined;
    }
    const pending = [...session.engineApprovals].find((id) => session.approvals.has(id));
    const raise = pending === undefined ? "" : `; allow approval ${pending} with a higher budget to continue`;
    return sessionFailure(
      "session.budget_exhausted",
      `session ${sessionId} has used ${String(session.budget.spent())} of its ${String(session.budget.limit())} credits${raise}`,
    );
  }

  function budgetFor(limitCredits: number | null, spentCredits: number): SessionBudget {
    return createSessionBudget(limitCredits, spentCredits, deps.budget?.warningThresholds);
  }

  function checkDailyCap(workspaceId: string): SessionResult<undefined> {
    const cap = deps.budget?.workspaceDailyCredits;
    if (cap === undefined || deps.usage === undefined) {
      return ok(undefined);
    }
    return checkWorkspaceDailyCap(deps.usage, workspaceId, cap, clock());
  }

  async function startTurn(
    sessionId: string,
    session: LiveSession,
    text: string,
    mode: SessionSendMode | undefined,
  ): Promise<SessionResult<undefined>> {
    const exhausted = budgetExhausted(sessionId, session);
    if (exhausted !== undefined) {
      return exhausted;
    }
    const running = move(sessionId, "send");
    if (!running.ok) {
      return running;
    }
    if (mode !== undefined) {
      append(sessionId, { type: "user.message", payload: { text, mode }, timestamp: clock() });
    }
    const sent = await session.runtime.send(text);
    if (!sent.ok) {
      append(sessionId, { type: "session.error", payload: { code: sent.error.code, message: sent.error.message }, timestamp: clock() });
      move(sessionId, "turn_ended");
      return runtimeFailure(sent.error);
    }
    return ok(undefined);
  }

  async function startNext(sessionId: string, session: LiveSession): Promise<void> {
    if (live.get(sessionId) !== session || stateOf(sessionId) !== "idle") {
      return;
    }
    const steer = session.steer;
    session.steer = undefined;
    const text = steer ?? session.queue.shift();
    if (text !== undefined) {
      await startTurn(sessionId, session, text, undefined);
    }
  }

  function liveSession(sessionId: string): SessionResult<LiveSession> {
    const session = live.get(sessionId);
    if (session !== undefined) {
      return ok(session);
    }
    const stored = read(sessionId);
    if (!stored.ok) {
      return stored;
    }
    const full = storage.reason(sessionId);
    if (full !== undefined) {
      return sessionFailure("session.storage_full", `session ${sessionId} failed because the disk is full: ${full}`);
    }
    const hint = stored.value.state === "resumable" ? "; resume it first" : "";
    return sessionFailure("session.invalid_state", `session ${sessionId} is ${stored.value.state}${hint}`);
  }

  async function send(
    sessionId: string,
    text: string,
    mode: SessionSendMode,
  ): Promise<SessionResult<{ readonly accepted: boolean }>> {
    const session = liveSession(sessionId);
    if (!session.ok) {
      return session;
    }
    const state = stateOf(sessionId);
    if (state === "idle") {
      const started = await startTurn(sessionId, session.value, text, mode);
      return started.ok ? ok({ accepted: true }) : started;
    }
    if (state !== "running" && state !== "awaiting_approval") {
      return sessionFailure("session.invalid_state", `session ${sessionId} is ${String(state)}`);
    }
    if (mode === "send") {
      return ok({ accepted: false });
    }
    const recorded = append(sessionId, { type: "user.message", payload: { text, mode }, timestamp: clock() });
    if (!recorded.ok) {
      return recorded;
    }
    if (mode === "queue") {
      session.value.queue.push(text);
      return ok({ accepted: true });
    }
    session.value.steer = text;
    const aborted = await abortTurn(session.value, "user");
    return aborted.ok ? ok({ accepted: true }) : aborted;
  }

  async function abortTurn(session: LiveSession, reason: AbortReason): Promise<SessionResult<undefined>> {
    session.abortReason = reason;
    session.approvals.clear();
    const aborted = await session.runtime.abort();
    return aborted.ok ? ok(undefined) : runtimeFailure(aborted.error);
  }

  async function abort(sessionId: string): Promise<SessionResult<undefined>> {
    const session = liveSession(sessionId);
    if (!session.ok) {
      return session;
    }
    const state = stateOf(sessionId);
    if (state !== "running" && state !== "awaiting_approval") {
      return ok(undefined);
    }
    session.value.queue.length = 0;
    session.value.steer = undefined;
    return abortTurn(session.value, "user");
  }

  async function resolveApproval(
    approvalId: string,
    choice: SessionApprovalChoice,
    budgetCredits?: number,
  ): Promise<SessionResult<undefined>> {
    const found = [...live.entries()].find(([, session]) => session.approvals.has(approvalId));
    if (found === undefined) {
      return sessionFailure("session.approval_not_found", `no pending approval ${approvalId}`);
    }
    const [sessionId, session] = found;
    if (session.approvals.get(approvalId)?.kind === "budget") {
      return resolveBudget(sessionId, session, approvalId, choice, budgetCredits);
    }
    if (choice === "allow_always") {
      const saved = saveRule(session, approvalId);
      if (!saved.ok) {
        return saved;
      }
    }
    // Removed before the first await, so a concurrent second resolve cannot reach the runtime.
    session.approvals.delete(approvalId);
    session.prompts.delete(approvalId);
    append(sessionId, { type: "approval.resolved", payload: { approvalId, choice }, timestamp: clock() });
    if (session.approvals.size === 0 && stateOf(sessionId) === "awaiting_approval") {
      move(sessionId, "approval_resolved");
    }
    const resolved = await session.runtime.resolvePermission(approvalId, choice !== "deny");
    if (!resolved.ok) {
      append(sessionId, { type: "session.error", payload: { code: resolved.error.code, message: resolved.error.message }, timestamp: clock() });
      return runtimeFailure(resolved.error);
    }
    return ok(undefined);
  }

  // Written before the approval is resolved: when the rule cannot be saved the approval stays
  // pending, so the user can still allow it once or deny it.
  function saveRule(session: LiveSession, approvalId: string): SessionResult<undefined> {
    const prompt = session.prompts.get(approvalId);
    if (deps.permissionRules === undefined || prompt === undefined) {
      return ok(undefined);
    }
    const added = deps.permissionRules.add(ruleFor(prompt.toolName, prompt.arguments, "allow"));
    return added.ok ? ok(undefined) : sessionFailure("session.store_failed", `the permission rule was not saved: ${added.message}`);
  }

  async function resolveBudget(
    sessionId: string,
    session: LiveSession,
    approvalId: string,
    choice: SessionApprovalChoice,
    budgetCredits: number | undefined,
  ): Promise<SessionResult<undefined>> {
    const limit = choice === "deny" ? null : raisedLimit(session.budget, budgetCredits);
    if (limit !== null && !(limit > session.budget.spent())) {
      return sessionFailure(
        "session.invalid_request",
        `the new budget must exceed the ${String(session.budget.spent())} credits already spent`,
      );
    }
    session.approvals.delete(approvalId);
    if (limit === null) {
      session.queue.length = 0;
      session.steer = undefined;
    } else {
      const updated = store.sessions.updateBudget(sessionId, limit, clock());
      if (!updated.ok) {
        return storeFailure(updated.error);
      }
      session.budget.raise(limit);
    }
    append(sessionId, { type: "approval.resolved", payload: { approvalId, choice }, timestamp: clock() });
    if (session.approvals.size === 0 && stateOf(sessionId) === "awaiting_approval") {
      move(sessionId, "approval_resolved");
    }
    if (session.engineApprovals.has(approvalId)) {
      // The engine already ended the turn when it raised this approval; the runtime knows nothing of it.
      return ok(undefined);
    }
    if (limit === null) {
      append(sessionId, { type: "session.aborted", payload: { reason: "budget" }, timestamp: clock() });
    }
    const resolved = await session.runtime.resolveSessionLimit(approvalId, limit);
    if (!resolved.ok) {
      append(sessionId, { type: "session.error", payload: { code: resolved.error.code, message: resolved.error.message }, timestamp: clock() });
      return runtimeFailure(resolved.error);
    }
    return ok(undefined);
  }

  function raisedLimit(budget: SessionBudget, requested: number | undefined): number {
    const current = budget.limit() ?? budget.spent();
    const raised = requested ?? current + (deps.budget?.sessionCredits ?? current);
    return withinSessionCeiling(raised, deps.budget) ?? raised;
  }

  function workingDirectory(session: Pick<Session, "writeRoots" | "referenceRoots">): string | undefined {
    return session.writeRoots[0] ?? session.referenceRoots[0];
  }

  async function lifecycle(kind: SessionLifecycleEvent["kind"], session: Session): Promise<void> {
    const { id, writeRoots, referenceRoots } = session;
    await deps.lifecycle?.({ kind, sessionId: id, directory: workingDirectory(session) ?? "/", writeRoots, referenceRoots });
  }

  function runtimeHooks(sessionId: string): { readonly hooks?: RuntimeHooks } {
    return deps.hooks === undefined ? {} : { hooks: deps.hooks(sessionId) };
  }

  function engineTools(session: Session): { readonly tools?: readonly EngineTool[] } {
    return deps.tools === undefined ? {} : { tools: deps.tools(session) };
  }

  // A session whose agent definitions do not load fails to start rather than run without sub-agents.
  async function delegationOptions(session: Session): Promise<SessionResult<DelegationSetup["sessionOptions"]>> {
    const setup = await delegationSetup(session);
    if (setup.ok) {
      return ok(setup.value);
    }
    append(session.id, { type: "session.error", payload: { code: setup.error.code, message: setup.error.message }, timestamp: clock() });
    move(session.id, "fail");
    return sessionFailure("session.invalid_request", setup.error.message);
  }

  async function delegationSetup(session: Session): Promise<Result<DelegationSetup["sessionOptions"], DelegationError>> {
    if (deps.delegator === undefined) {
      return ok({});
    }
    const profile = session.routingProfile;
    const setup = isRoutingProfile(profile)
      ? await deps.delegator.setup({ sessionId: session.id, routingProfile: profile })
      : err<DelegationError>({ code: "delegation.invalid_profile", message: `unknown routing profile ${JSON.stringify(profile)}` });
    return setup.ok ? ok(setup.value.sessionOptions) : setup;
  }

  async function withSessionMcp<T extends DelegationSetup["sessionOptions"]>(session: Session, options: T): Promise<T> {
    return deps.mcp === undefined ? options : withMcpServers(options, await deps.mcp.options(session));
  }

  // Everything the new runtime needs, secrets included, is gathered while the old one still runs,
  // and the session is checked again before it is closed: a turn or an end that arrived meanwhile wins.
  // A runtime that cannot be reopened leaves the session `resumable`, never `failed`.
  async function reconfigure(sessionId: string): Promise<SessionResult<undefined>> {
    const stored = read(sessionId);
    if (!stored.ok) {
      return stored;
    }
    const current = live.get(sessionId);
    if (current === undefined || stored.value.state !== "idle") {
      return sessionFailure("session.invalid_state", `session ${sessionId} is ${stored.value.state}; only an idle session can be reopened`);
    }
    const delegation = await delegationSetup(stored.value);
    if (!delegation.ok) {
      return sessionFailure("session.invalid_request", delegation.error.message);
    }
    const options = await withSessionMcp(stored.value, delegation.value);
    if (live.get(sessionId) !== current || stateOf(sessionId) !== "idle") {
      return sessionFailure("session.invalid_state", `session ${sessionId} changed while its new servers were prepared; try again when it is idle`);
    }
    live.delete(sessionId);
    current.unsubscribe();
    await current.runtime.close();
    const reopened = await deps.runtime.resumeSession({
      sessionId,
      workingDirectory: workingDirectory(stored.value) ?? "/",
      ...withRuntimeLimit(runtimeLimit(current.budget.limit())),
      ...runtimeHooks(sessionId),
      ...engineTools(stored.value),
      ...options,
    });
    if (!reopened.ok) {
      append(sessionId, { type: "session.error", payload: { code: reopened.error.code, message: reopened.error.message }, timestamp: clock() });
      move(sessionId, "engine_lost");
      return runtimeFailure(reopened.error);
    }
    if (stateOf(sessionId) !== "idle") {
      await reopened.value.close();
      return sessionFailure("session.invalid_state", `session ${sessionId} was ended while it was reopened`);
    }
    attach(sessionId, reopened.value, current.budget);
    return ok(undefined);
  }

  async function resume(sessionId: string): Promise<SessionResult<SessionInfo>> {
    const stored = read(sessionId);
    if (!stored.ok) {
      return stored;
    }
    if (stored.value.state !== "resumable") {
      return sessionFailure("session.invalid_state", `session ${sessionId} is ${stored.value.state}, not resumable`);
    }
    const capped = checkDailyCap(stored.value.workspaceId);
    if (!capped.ok) {
      return capped;
    }
    const directory = workingDirectory(stored.value) ?? "/";
    const limit = withinSessionCeiling(stored.value.budgetMaxCredits ?? undefined, deps.budget) ?? null;
    const delegation = await delegationOptions(stored.value);
    if (!delegation.ok) {
      return delegation;
    }
    const resumed = await deps.runtime.resumeSession({
      sessionId,
      workingDirectory: directory,
      ...withRuntimeLimit(runtimeLimit(limit)),
      ...runtimeHooks(sessionId),
      ...engineTools(stored.value),
      ...(await withSessionMcp(stored.value, delegation.value)),
    });
    if (!resumed.ok) {
      append(sessionId, { type: "session.error", payload: { code: resumed.error.code, message: resumed.error.message }, timestamp: clock() });
      move(sessionId, "fail");
      return runtimeFailure(resumed.error);
    }
    const attached = attach(sessionId, resumed.value, budgetFor(limit, deps.usage === undefined ? 0 : sessionSpend(deps.usage, sessionId)));
    const moved = move(sessionId, "resume");
    // A limit the engine enforces was used up before the restart: offer to raise it again.
    if (moved.ok && attached.enforcesBudget && attached.budget.exhausted()) {
      requestEngineBudgetApproval(sessionId, attached);
    }
    return moved;
  }

  async function end(sessionId: string): Promise<SessionResult<undefined>> {
    const stored = read(sessionId);
    if (!stored.ok) {
      return stored;
    }
    const ended = transitionSession(stored.value.state, "end");
    if (!ended.ok) {
      return sessionFailure("session.invalid_state", `session ${sessionId}: ${ended.error.message}`);
    }
    const session = live.get(sessionId);
    if (session !== undefined) {
      live.delete(sessionId);
      session.unsubscribe();
      await session.runtime.close();
    }
    const moved = move(sessionId, "end");
    if (!moved.ok) {
      return moved;
    }
    await lifecycle("sessionEnd", stored.value);
    return ok(undefined);
  }

  const maxTitleLength = 200;

  function rename(sessionId: string, title: string): SessionResult<SessionInfo> {
    const stored = read(sessionId);
    if (!stored.ok) {
      return stored;
    }
    const trimmed = title.trim();
    if (trimmed.length > maxTitleLength) {
      return sessionFailure("session.invalid_request", `a session title is at most ${String(maxTitleLength)} characters`);
    }
    const renamed = store.sessions.rename(sessionId, trimmed === "" ? null : trimmed);
    if (!renamed.ok) {
      storage.notice(sessionId, renamed.error);
      return storeFailure(renamed.error, `session ${sessionId}`);
    }
    return changed(withTitle(stored.value, trimmed));
  }

  async function remove(sessionId: string): Promise<SessionResult<undefined>> {
    const stored = read(sessionId);
    if (!stored.ok) {
      return stored;
    }
    const session = live.get(sessionId);
    if (session !== undefined) {
      live.delete(sessionId);
      session.unsubscribe();
      await session.runtime.close();
    }
    const deleted = store.sessions.delete(sessionId, clock());
    if (!deleted.ok) {
      storage.notice(sessionId, deleted.error);
      return storeFailure(deleted.error, `session ${sessionId}`);
    }
    // The runtime may hold nothing for a session that never started; that is not a failure.
    await deps.runtime.deleteSession?.(sessionId);
    if (stored.value.state !== "ended" && stored.value.state !== "failed") {
      await lifecycle("sessionEnd", stored.value);
    }
    deps.mcp?.forget?.(sessionId);
    await deps.onDeleted?.(sessionId);
    return ok(undefined);
  }

  async function create(request: CreateSessionRequest): Promise<SessionResult<SessionInfo>> {
    const roots = resolveRoots(request);
    if (!roots.ok) {
      return roots;
    }
    const directory = workingDirectory(roots.value);
    if (directory === undefined) {
      return sessionFailure("session.invalid_request", "a session needs at least one write or reference repo");
    }
    const capped = checkDailyCap(request.workspaceId);
    if (!capped.ok) {
      return capped;
    }
    const budgetCredits = withinSessionCeiling(request.budgetCredits ?? deps.budget?.sessionCredits, deps.budget);
    const at = clock();
    const session: Session = {
      id: deps.newSessionId(),
      workspaceId: request.workspaceId,
      ...roots.value,
      state: "starting",
      routingProfile: request.routingProfile ?? deps.defaultProfile?.(request.workspaceId) ?? defaultRoutingProfile,
      budgetMaxCredits: budgetCredits ?? null,
      createdAt: at,
      updatedAt: at,
    };
    const created = store.sessions.create(session);
    if (!created.ok) {
      return storeFailure(created.error);
    }
    append(session.id, stateChanged(null, "starting", at));
    changed(session);
    deps.mcp?.seed(session);
    return startRuntime(session, directory, request.prompt);
  }

  async function startRuntime(
    session: Session,
    directory: string,
    prompt: string | undefined,
  ): Promise<SessionResult<SessionInfo>> {
    const limit = session.budgetMaxCredits;
    const delegation = await delegationOptions(session);
    if (!delegation.ok) {
      return delegation;
    }
    const opened = await deps.runtime.createSession({
      sessionId: session.id,
      workingDirectory: directory,
      ...withRuntimeLimit(runtimeLimit(limit)),
      ...runtimeHooks(session.id),
      ...engineTools(session),
      ...(await withSessionMcp(session, delegation.value)),
    });
    if (opened.ok && !read(session.id).ok) {
      // Deleted while its runtime was starting.
      await opened.value.close();
      return sessionFailure("session.not_found", `session ${session.id} was deleted`);
    }
    if (!opened.ok) {
      append(session.id, { type: "session.error", payload: { code: opened.error.code, message: opened.error.message }, timestamp: clock() });
      move(session.id, "fail");
      return runtimeFailure(opened.error);
    }
    attach(session.id, opened.value, budgetFor(limit, 0));
    const ready = move(session.id, "runtime_ready");
    if (ready.ok) {
      await lifecycle("sessionStart", session);
    }
    if (!ready.ok || prompt === undefined || prompt === "") {
      return ready;
    }
    const sent = await send(session.id, prompt, "send");
    return sent.ok ? get(session.id) : sent;
  }

  function resolveRoots(
    request: CreateSessionRequest,
  ): SessionResult<Pick<Session, "writeRoots" | "referenceRoots">> {
    const workspace = store.workspaces.get(request.workspaceId);
    if (!workspace.ok) {
      return storeFailure(workspace.error, `workspace ${request.workspaceId}`);
    }
    const writeRoots = repoPaths(request.writeRepoIds);
    if (!writeRoots.ok) {
      return writeRoots;
    }
    const referenceRoots = repoPaths(request.referenceRepoIds);
    return referenceRoots.ok ? ok({ writeRoots: writeRoots.value, referenceRoots: referenceRoots.value }) : referenceRoots;
  }

  function repoPaths(repoIds: readonly string[]): SessionResult<readonly string[]> {
    const paths: string[] = [];
    for (const repoId of repoIds) {
      const repo = store.repos.get(repoId);
      if (!repo.ok) {
        return storeFailure(repo.error, `repo ${repoId}`);
      }
      if (repo.value.localPath === null) {
        return sessionFailure("session.invalid_request", `repo ${repoId} is not cloned`);
      }
      paths.push(repo.value.localPath);
    }
    return ok(paths);
  }

  function get(sessionId: string): SessionResult<SessionInfo> {
    const session = read(sessionId);
    return session.ok ? info(session.value) : session;
  }

  function storedSessions(workspaceId?: string): SessionResult<readonly Session[]> {
    const workspaceIds: string[] = [];
    if (workspaceId === undefined) {
      const workspaces = store.workspaces.list();
      if (!workspaces.ok) {
        return storeFailure(workspaces.error);
      }
      workspaceIds.push(...workspaces.value.map((workspace) => workspace.id));
    } else {
      workspaceIds.push(workspaceId);
    }
    const sessions: Session[] = [];
    for (const id of workspaceIds) {
      const listed = store.sessions.listByWorkspace(id);
      if (!listed.ok) {
        return storeFailure(listed.error);
      }
      sessions.push(...listed.value.map((session) => storage.overlay(session)));
    }
    return ok(sessions);
  }

  function list(workspaceId?: string): SessionResult<readonly SessionInfo[]> {
    const sessions = storedSessions(workspaceId);
    if (!sessions.ok) {
      return sessions;
    }
    const infos: SessionInfo[] = [];
    for (const session of sessions.value) {
      const current = info(session);
      if (!current.ok) {
        return current;
      }
      infos.push(current.value);
    }
    return ok(infos);
  }

  function recover(): SessionResult<readonly SessionInfo[]> {
    const sessions = storedSessions();
    if (!sessions.ok) {
      return sessions;
    }
    const recovered: SessionInfo[] = [];
    for (const session of sessions.value) {
      if (live.has(session.id) || !isLiveSessionState(session.state)) {
        continue;
      }
      if (session.state === "running" || session.state === "awaiting_approval") {
        append(session.id, { type: "session.aborted", payload: { reason: "engine" }, timestamp: clock() });
      }
      const moved = move(session.id, "engine_lost");
      if (!moved.ok) {
        return moved;
      }
      recovered.push(moved.value);
    }
    return ok(recovered);
  }

  return {
    recover,
    create,
    get,
    list,
    send,
    abort,
    resume,
    end,
    rename,
    delete: remove,
    listApprovals: (sessionId) => {
      const session = read(sessionId);
      if (!session.ok) {
        return session;
      }
      return ok([...(live.get(sessionId)?.approvals.values() ?? [])]);
    },
    resolveApproval,
    reconfigure,
    runningCount: () =>
      [...live.keys()].filter((id) => {
        const state = stateOf(id);
        return state === "running" || state === "awaiting_approval";
      }).length,
  };
}

function withTitle(session: Session, title: string): Session {
  const untitled: Session = {
    id: session.id,
    workspaceId: session.workspaceId,
    writeRoots: session.writeRoots,
    referenceRoots: session.referenceRoots,
    state: session.state,
    routingProfile: session.routingProfile,
    budgetMaxCredits: session.budgetMaxCredits,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
  return title === "" ? untitled : { ...untitled, title };
}

function stateChanged(from: SessionState | null, to: SessionState, timestamp: string): EventDraft {
  return { type: "session.state_changed", payload: { from, to }, timestamp };
}

function storeFailure(error: Pick<StoreError, "message"> & { readonly code: string }, subject?: string): ReturnType<typeof sessionFailure> {
  if (error.code === "store.not_found") {
    return sessionFailure("session.not_found", subject === undefined ? error.message : `${subject} not found`);
  }
  if (error.code === "store.full") {
    return sessionFailure("session.storage_full", error.message);
  }
  return sessionFailure("session.store_failed", error.message);
}

function withRuntimeLimit(limit: number | undefined): { readonly maxAiCredits?: number } {
  return limit === undefined ? {} : { maxAiCredits: limit };
}
