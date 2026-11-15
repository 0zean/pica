import type { EventDraft, EventLog } from "../events/index.ts";
import { createRuntimeEventRecorder } from "../events/index.ts";
import type { RuntimeEventRecorder } from "../events/index.ts";
import type { AgentRuntime, EngineTool, RuntimeEvent, RuntimeHooks, RuntimeSession } from "../runtime/index.ts";
import { ok } from "../result.ts";
import type { Session, SessionState, Store, StoreError, UsageRepository } from "../store/index.ts";
import { checkWorkspaceDailyCap, createSessionBudget, sessionSpend, withinSessionCeiling } from "./budget.ts";
import type { BudgetSettings, SessionBudget } from "./budget.ts";
import { runtimeFailure, sessionFailure } from "./errors.ts";
import type { SessionResult } from "./errors.ts";
import { toSessionInfo } from "./info.ts";
import type {
  PendingApproval,
  SessionApprovalChoice,
  SessionInfo,
  SessionRoutingProfile,
  SessionSendMode,
} from "./info.ts";
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
  readonly onChanged?: (session: SessionInfo) => void;
  // C-09: without `usage` the workspace daily cap is not checked and spend starts at zero on resume.
  readonly budget?: BudgetSettings;
  readonly usage?: Pick<UsageRepository, "rollup">;
  // X-03: awaited once the runtime is ready and once the session has ended; it does not block either.
  readonly lifecycle?: (event: SessionLifecycleEvent) => Promise<void>;
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
}

type AbortReason = "user" | "budget" | "engine";

interface LiveSession {
  readonly runtime: RuntimeSession;
  readonly recorder: RuntimeEventRecorder;
  readonly approvals: Map<string, PendingApproval>;
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

  function read(sessionId: string): SessionResult<Session> {
    const session = store.sessions.get(sessionId);
    return session.ok ? session : storeFailure(session.error, `session ${sessionId}`);
  }

  function info(session: Session): SessionResult<SessionInfo> {
    const lastSeq = store.events.lastSeq(session.id);
    return lastSeq.ok ? ok(toSessionInfo(session, lastSeq.value)) : storeFailure(lastSeq.error);
  }

  function append(sessionId: string, draft: EventDraft): SessionResult<undefined> {
    const appended = deps.events.append(sessionId, draft);
    return appended.ok ? ok(undefined) : sessionFailure("session.store_failed", appended.error.message);
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
    return session.ok ? session.value.state : undefined;
  }

  function attach(sessionId: string, runtime: RuntimeSession, budget: SessionBudget): LiveSession {
    const limit = budget.limit();
    const session: LiveSession = {
      runtime,
      recorder: createRuntimeEventRecorder(deps.events, { sessionId, rootAgent }),
      approvals: new Map(),
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
    for (const appended of session.recorder.record(event).appended) {
      if (appended.type === "approval.requested") {
        session.approvals.set(appended.payload.id, appended.payload);
      }
    }
    if (stateOf(sessionId) === "running") {
      move(sessionId, "approval_requested");
    }
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
    // Removed before the first await, so a concurrent second resolve cannot reach the runtime.
    session.approvals.delete(approvalId);
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
    const resumed = await deps.runtime.resumeSession({
      sessionId,
      workingDirectory: directory,
      ...withRuntimeLimit(runtimeLimit(limit)),
      ...runtimeHooks(sessionId),
      ...engineTools(stored.value),
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
      routingProfile: request.routingProfile ?? "balanced",
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
    return startRuntime(session, directory, request.prompt);
  }

  async function startRuntime(
    session: Session,
    directory: string,
    prompt: string | undefined,
  ): Promise<SessionResult<SessionInfo>> {
    const limit = session.budgetMaxCredits;
    const opened = await deps.runtime.createSession({
      sessionId: session.id,
      workingDirectory: directory,
      ...withRuntimeLimit(runtimeLimit(limit)),
      ...runtimeHooks(session.id),
      ...engineTools(session),
    });
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
      sessions.push(...listed.value);
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
    listApprovals: (sessionId) => {
      const session = read(sessionId);
      if (!session.ok) {
        return session;
      }
      return ok([...(live.get(sessionId)?.approvals.values() ?? [])]);
    },
    resolveApproval,
    runningCount: () =>
      [...live.keys()].filter((id) => {
        const state = stateOf(id);
        return state === "running" || state === "awaiting_approval";
      }).length,
  };
}

function stateChanged(from: SessionState | null, to: SessionState, timestamp: string): EventDraft {
  return { type: "session.state_changed", payload: { from, to }, timestamp };
}

function storeFailure(error: StoreError, subject?: string): ReturnType<typeof sessionFailure> {
  if (error.code === "store.not_found") {
    return sessionFailure("session.not_found", subject === undefined ? error.message : `${subject} not found`);
  }
  return sessionFailure("session.store_failed", error.message);
}

function withRuntimeLimit(limit: number | undefined): { readonly maxAiCredits?: number } {
  return limit === undefined ? {} : { maxAiCredits: limit };
}
