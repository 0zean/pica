import type { Result } from "../result.ts";
import type {
  NewSessionEvent,
  Repo,
  Session,
  SessionEvent,
  SessionModelTiers,
  SessionState,
  UsageQuery,
  UsageRecord,
  UsageTotals,
  Workspace,
} from "./entities.ts";

export type StoreErrorCode =
  | "store.not_found"
  | "store.conflict"
  | "store.busy"
  | "store.schema_too_new"
  // H-05: the database file is damaged or is not a database.
  | "store.corrupt"
  // H-05: the disk (or the database's size limit) is full; nothing was written.
  | "store.full"
  | "store.failed";

export interface StoreError {
  readonly code: StoreErrorCode;
  readonly message: string;
}

export type StoreResult<T> = Result<T, StoreError>;

export interface WorkspaceRepository {
  save(workspace: Workspace): StoreResult<void>;
  get(id: string): StoreResult<Workspace>;
  list(): StoreResult<readonly Workspace[]>;
  // Refuses (`store.conflict`) while the workspace has sessions.
  delete(id: string): StoreResult<void>;
  // In one transaction: refuses (`store.conflict`) while any of its sessions is in a live state
  // (`starting`, `idle`, `running`, `awaiting_approval`); else deletes its sessions with their
  // events and usage records, then the workspace and its pins.
  deleteWithSessions(id: string): StoreResult<void>;
}

export interface RepoRepository {
  save(repo: Repo): StoreResult<void>;
  get(id: string): StoreResult<Repo>;
  findByRemoteUrl(remoteUrl: string): StoreResult<Repo>;
  list(): StoreResult<readonly Repo[]>;
  delete(id: string): StoreResult<void>;
}

export interface SessionRepository {
  create(session: Session): StoreResult<void>;
  get(id: string): StoreResult<Session>;
  listByWorkspace(workspaceId: string): StoreResult<readonly Session[]>;
  updateState(id: string, state: SessionState, updatedAt: string): StoreResult<void>;
  updateBudget(id: string, budgetMaxCredits: number | null, updatedAt: string): StoreResult<void>;
  // Sets the routing profile and the per-tier models (`null` clears them) together.
  updateRouting(id: string, routingProfile: string, modelTiers: SessionModelTiers | null, updatedAt: string): StoreResult<void>;
  // `null` clears the user's title. `updatedAt` is left alone, so renaming does not reorder sessions.
  rename(id: string, title: string | null): StoreResult<void>;
  // Removes the session's events and marks it deleted, in one transaction. The row stays so its
  // usage records keep counting; its state becomes `ended`. `get` and `listByWorkspace` no longer find it.
  delete(id: string, deletedAt: string): StoreResult<void>;
}

// PLAN.md D-06: each session's events carry their own sequence, starting at 1 with no gaps.
export interface EventRepository {
  append(sessionId: string, event: NewSessionEvent): StoreResult<SessionEvent>;
  readAfter(sessionId: string, afterSeq: number, limit?: number): StoreResult<readonly SessionEvent[]>;
  lastSeq(sessionId: string): StoreResult<number>;
}

export interface UsageRepository {
  record(usage: UsageRecord): StoreResult<void>;
  listBySession(sessionId: string): StoreResult<readonly UsageRecord[]>;
  // One row per group, ordered by key. Groups with no records are absent.
  rollup(query: UsageQuery): StoreResult<readonly UsageTotals[]>;
}

export interface Store {
  readonly workspaces: WorkspaceRepository;
  readonly repos: RepoRepository;
  readonly sessions: SessionRepository;
  readonly events: EventRepository;
  readonly usage: UsageRepository;
  close(): void;
}
