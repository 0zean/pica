import type { Result } from "../result.ts";
import type {
  NewSessionEvent,
  Repo,
  Session,
  SessionEvent,
  SessionState,
  UsageRecord,
  Workspace,
} from "./entities.ts";

export type StoreErrorCode =
  | "store.not_found"
  | "store.conflict"
  | "store.busy"
  | "store.schema_too_new"
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
  delete(id: string): StoreResult<void>;
}

export interface RepoRepository {
  save(repo: Repo): StoreResult<void>;
  get(id: string): StoreResult<Repo>;
  findByRemoteUrl(remoteUrl: string): StoreResult<Repo>;
  list(): StoreResult<readonly Repo[]>;
}

export interface SessionRepository {
  create(session: Session): StoreResult<void>;
  get(id: string): StoreResult<Session>;
  listByWorkspace(workspaceId: string): StoreResult<readonly Session[]>;
  updateState(id: string, state: SessionState, updatedAt: string): StoreResult<void>;
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
}

export interface Store {
  readonly workspaces: WorkspaceRepository;
  readonly repos: RepoRepository;
  readonly sessions: SessionRepository;
  readonly events: EventRepository;
  readonly usage: UsageRepository;
  close(): void;
}
