import type { EventLog, EventSubscription } from "../events/index.ts";
import { ok } from "../result.ts";
import type { SessionRoutingProfile, SessionService, SessionServiceError } from "../sessions/index.ts";
import type { WorkspaceService } from "../workspaces/index.ts";
import { fanOutCounts, fanOutState, isActiveRun, isTerminalRun, observeRunEvent, publicRun } from "./aggregate.ts";
import type { TrackedRun } from "./aggregate.ts";
import { fanOutFailure } from "./types.ts";
import type { FanOutInfo, FanOutResult, FanOutRunError } from "./types.ts";

export const defaultFanOutConcurrency = 3;
export const maxFanOutConcurrency = 16;

export interface FanOutServiceDeps {
  readonly sessions: Pick<SessionService, "create" | "send" | "abort">;
  readonly events: Pick<EventLog, "subscribe">;
  // R-06: when set, every repo must belong to the workspace and is cloned before its session starts.
  readonly workspaces?: Pick<WorkspaceService, "repos" | "ensureCloned">;
  readonly clock: () => string;
  readonly newFanOutId: () => string;
  readonly onChanged?: (fanOut: FanOutInfo) => void;
}

export interface StartFanOutRequest {
  readonly workspaceId: string;
  readonly repoIds: readonly string[];
  readonly prompt: string;
  readonly concurrency?: number | undefined;
  // Read-only in every session of the fan-out, except the one that writes to the same repo.
  readonly referenceRepoIds?: readonly string[] | undefined;
  readonly routingProfile?: SessionRoutingProfile | undefined;
  readonly budgetCredits?: number | undefined;
}

export interface FanOutService {
  // Starts one session per repo, at most `concurrency` at once, each sent `prompt` as its first turn.
  start(request: StartFanOutRequest): FanOutResult<FanOutInfo>;
  get(fanOutId: string): FanOutResult<FanOutInfo>;
  list(workspaceId?: string): readonly FanOutInfo[];
  // Queued runs never start; running sessions are aborted. A failing run never cancels the others.
  cancel(fanOutId: string): Promise<FanOutResult<FanOutInfo>>;
  // Resolves once every run has succeeded, failed or been cancelled.
  settled(fanOutId: string): Promise<FanOutResult<FanOutInfo>>;
}

interface FanOutRecord {
  readonly id: string;
  readonly request: StartFanOutRequest;
  readonly concurrency: number;
  readonly createdAt: string;
  readonly runs: TrackedRun[];
  readonly subscriptions: Map<number, EventSubscription>;
  readonly waiters: ((info: FanOutInfo) => void)[];
  updatedAt: string;
  cancelRequested: boolean;
}

export function createFanOutService(deps: FanOutServiceDeps): FanOutService {
  const records = new Map<string, FanOutRecord>();

  function infoOf(record: FanOutRecord): FanOutInfo {
    const runs = record.runs.map(publicRun);
    return {
      id: record.id,
      workspaceId: record.request.workspaceId,
      prompt: record.request.prompt,
      concurrency: record.concurrency,
      state: fanOutState(runs, record.cancelRequested),
      runs,
      counts: fanOutCounts(runs),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  function changed(record: FanOutRecord): void {
    record.updatedAt = deps.clock();
    const info = infoOf(record);
    deps.onChanged?.(info);
    if (info.state === "completed" || info.state === "cancelled") {
      for (const resolve of record.waiters.splice(0)) {
        resolve(info);
      }
    }
  }

  function update(record: FanOutRecord, index: number, next: TrackedRun): void {
    const previous = record.runs[index];
    if (previous === undefined || sameRun(previous, next)) {
      return;
    }
    record.runs[index] = next;
    if (isTerminalRun(next.status)) {
      record.subscriptions.get(index)?.close();
      record.subscriptions.delete(index);
      // Deferred: a run usually ends inside the session service's event append.
      queueMicrotask(() => {
        fill(record);
      });
    }
    changed(record);
  }

  function finish(record: FanOutRecord, index: number, status: "failed" | "cancelled", error: FanOutRunError | null): void {
    const run = record.runs[index];
    if (run !== undefined && !isTerminalRun(run.status)) {
      update(record, index, { ...run, status, error: run.error ?? error });
    }
  }

  function fill(record: FanOutRecord): void {
    while (!record.cancelRequested && record.runs.filter((run) => isActiveRun(run.status)).length < record.concurrency) {
      const index = record.runs.findIndex((run) => run.status === "queued");
      const run = record.runs[index];
      if (run === undefined) {
        return;
      }
      update(record, index, { ...run, status: "starting" });
      void launch(record, index);
    }
  }

  async function launch(record: FanOutRecord, index: number): Promise<void> {
    const repoId = record.runs[index]?.repoId ?? "";
    const { request } = record;
    if (deps.workspaces !== undefined) {
      const cloned = await deps.workspaces.ensureCloned(repoId);
      if (!cloned.ok) {
        finish(record, index, "failed", { code: cloned.error.code, message: cloned.error.message });
        return;
      }
    }
    if (record.cancelRequested) {
      finish(record, index, "cancelled", null);
      return;
    }
    const created = await deps.sessions.create({
      workspaceId: request.workspaceId,
      writeRepoIds: [repoId],
      referenceRepoIds: (request.referenceRepoIds ?? []).filter((id) => id !== repoId),
      routingProfile: request.routingProfile,
      budgetCredits: request.budgetCredits,
    });
    if (!created.ok) {
      finish(record, index, "failed", sessionError(created.error));
      return;
    }
    const sessionId = created.value.id;
    const run = record.runs[index];
    if (run !== undefined) {
      update(record, index, { ...run, sessionId });
    }
    if (cancelRequested(record)) {
      finish(record, index, "cancelled", null);
      return;
    }
    follow(record, index, sessionId, created.value.lastSeq);
    const sent = await deps.sessions.send(sessionId, request.prompt, "send");
    if (!sent.ok) {
      finish(record, index, "failed", sessionError(sent.error));
    } else if (!sent.value.accepted) {
      finish(record, index, "failed", { code: "session.busy", message: `session ${sessionId} was already running a turn` });
    }
  }

  function follow(record: FanOutRecord, index: number, sessionId: string, afterSeq: number): void {
    const subscription = deps.events.subscribe(sessionId, afterSeq, {
      onEvent: (event) => {
        const run = record.runs[index];
        if (run !== undefined) {
          update(record, index, observeRunEvent(run, event));
        }
      },
      onError: (error) => {
        finish(record, index, "failed", { code: error.code, message: error.message });
      },
    });
    const run = record.runs[index];
    if (run === undefined || isTerminalRun(run.status)) {
      subscription.close();
    } else {
      record.subscriptions.set(index, subscription);
    }
  }

  function validate(request: StartFanOutRequest): FanOutResult<number> {
    const concurrency = request.concurrency ?? defaultFanOutConcurrency;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > maxFanOutConcurrency) {
      return fanOutFailure("fanout.invalid_request", `concurrency must be an integer from 1 to ${String(maxFanOutConcurrency)}`);
    }
    if (request.prompt.trim() === "") {
      return fanOutFailure("fanout.invalid_request", "a fan-out needs a prompt");
    }
    if (request.repoIds.length === 0) {
      return fanOutFailure("fanout.invalid_request", "a fan-out needs at least one repo");
    }
    if (new Set(request.repoIds).size !== request.repoIds.length) {
      return fanOutFailure("fanout.invalid_request", "each repo can appear only once in a fan-out");
    }
    const members = checkMembers(request);
    return members.ok ? ok(concurrency) : members;
  }

  function checkMembers(request: StartFanOutRequest): FanOutResult<undefined> {
    if (deps.workspaces === undefined) {
      return ok(undefined);
    }
    const repos = deps.workspaces.repos(request.workspaceId);
    if (!repos.ok) {
      const code = repos.error.code === "workspace.not_found" ? "fanout.not_found" : "fanout.invalid_request";
      return fanOutFailure(code, repos.error.message);
    }
    const members = new Set(repos.value.map((repo) => repo.id));
    const outside = request.repoIds.filter((id) => !members.has(id));
    if (outside.length > 0) {
      return fanOutFailure("fanout.invalid_request", `not in workspace ${request.workspaceId}: ${outside.join(", ")}`);
    }
    return ok(undefined);
  }

  function start(request: StartFanOutRequest): FanOutResult<FanOutInfo> {
    const concurrency = validate(request);
    if (!concurrency.ok) {
      return concurrency;
    }
    const at = deps.clock();
    const record: FanOutRecord = {
      id: deps.newFanOutId(),
      request,
      concurrency: concurrency.value,
      createdAt: at,
      updatedAt: at,
      runs: request.repoIds.map((repoId) => ({ repoId, sessionId: null, status: "queued", error: null, aborted: false })),
      subscriptions: new Map(),
      waiters: [],
      cancelRequested: false,
    };
    records.set(record.id, record);
    changed(record);
    fill(record);
    return ok(infoOf(record));
  }

  function find(fanOutId: string): FanOutResult<FanOutRecord> {
    const record = records.get(fanOutId);
    return record === undefined ? fanOutFailure("fanout.not_found", `fan-out ${fanOutId} not found`) : ok(record);
  }

  async function cancel(fanOutId: string): Promise<FanOutResult<FanOutInfo>> {
    const found = find(fanOutId);
    if (!found.ok) {
      return found;
    }
    const record = found.value;
    if (record.cancelRequested || infoOf(record).state === "completed") {
      return ok(infoOf(record));
    }
    record.cancelRequested = true;
    record.runs.forEach((run, index) => {
      if (run.status === "queued") {
        record.runs[index] = { ...run, status: "cancelled" };
      }
    });
    changed(record);
    const running = record.runs.flatMap((run, index) =>
      isActiveRun(run.status) && run.sessionId !== null ? [{ index, sessionId: run.sessionId }] : [],
    );
    await Promise.all(
      running.map(async ({ index, sessionId }) => {
        const aborted = await deps.sessions.abort(sessionId);
        if (!aborted.ok) {
          finish(record, index, "failed", sessionError(aborted.error));
        }
      }),
    );
    return ok(infoOf(record));
  }

  function settled(fanOutId: string): Promise<FanOutResult<FanOutInfo>> {
    const found = find(fanOutId);
    if (!found.ok) {
      return Promise.resolve(found);
    }
    const info = infoOf(found.value);
    if (info.state === "completed" || info.state === "cancelled") {
      return Promise.resolve(ok(info));
    }
    return new Promise((resolve) => {
      found.value.waiters.push((done) => {
        resolve(ok(done));
      });
    });
  }

  return {
    start,
    get: (fanOutId) => {
      const found = find(fanOutId);
      return found.ok ? ok(infoOf(found.value)) : found;
    },
    list: (workspaceId) =>
      [...records.values()]
        .filter((record) => workspaceId === undefined || record.request.workspaceId === workspaceId)
        .map(infoOf),
    cancel,
    settled,
  };
}

// Read through a call: `cancel` can set the flag while `launch` awaits.
function cancelRequested(record: FanOutRecord): boolean {
  return record.cancelRequested;
}

function sameRun(a: TrackedRun, b: TrackedRun): boolean {
  return (
    a.status === b.status &&
    a.sessionId === b.sessionId &&
    a.aborted === b.aborted &&
    a.error?.code === b.error?.code &&
    a.error?.message === b.error?.message
  );
}

function sessionError(error: SessionServiceError): FanOutRunError {
  return { code: error.runtimeCode ?? error.code, message: error.message };
}
