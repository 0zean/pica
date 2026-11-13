import type { JsonObject, JsonValue } from "../json.ts";

// Store-local shapes of the PLAN.md §4.4 entities. Timestamps are ISO 8601 strings chosen by the caller.

export type CloneState = "absent" | "cloning" | "ready" | "failed";

export interface Repo {
  readonly id: string;
  readonly remoteUrl: string;
  readonly localPath: string | null;
  readonly managed: boolean;
  readonly defaultBranch: string | null;
  readonly cloneState: CloneState;
}

export type RepoSourceKind = "manual" | "team" | "topic" | "property";

export interface RepoSource {
  readonly kind: RepoSourceKind;
  readonly org: string | null;
  readonly selector: string;
  readonly lastSyncAt: string | null;
}

export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly sources: readonly RepoSource[];
  readonly pinnedRepoIds: readonly string[];
  readonly settingsOverrides: JsonObject;
}

export type SessionState =
  | "starting"
  | "idle"
  | "running"
  | "awaiting_approval"
  | "ended"
  | "failed"
  | "resumable";

export interface Session {
  readonly id: string;
  readonly workspaceId: string;
  readonly writeRoots: readonly string[];
  readonly referenceRoots: readonly string[];
  readonly state: SessionState;
  readonly routingProfile: string;
  readonly budgetMaxCredits: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewSessionEvent {
  readonly type: string;
  readonly payload: JsonValue;
  readonly timestamp: string;
}

export interface SessionEvent extends NewSessionEvent {
  readonly sessionId: string;
  readonly seq: number;
}

export interface UsageRecord {
  readonly sessionId: string;
  readonly agent: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly credits: number;
  readonly timestamp: string;
}
