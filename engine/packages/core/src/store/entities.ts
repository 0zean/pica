import type { Tier } from "@pica/protocol";
import type { DiscoverySnapshot } from "../discovery/sync.ts";
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
  readonly id: string;
  readonly kind: RepoSourceKind;
  readonly org: string | null;
  readonly selector: string;
  readonly lastSyncAt: string | null;
  // What the last sync resolved to (R-06): the ETag snapshot to revalidate with, and the Repo ids it selected.
  readonly snapshot: DiscoverySnapshot | null;
  readonly repoIds: readonly string[];
}

export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly sources: readonly RepoSource[];
  readonly pinnedRepoIds: readonly string[];
  // The workspace layer of the E-04 configuration (a partial `config.jsonc`).
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
  // The tier of the agent that made the call; null for records written before tiers were stored.
  readonly tier: Tier | null;
  readonly timestamp: string;
}

export type UsageGrouping = "session" | "agent" | "model" | "workspace" | "day" | "tier";

// `from` is inclusive and `to` exclusive; both are compared as instants, so offsets are honoured.
// Days are UTC calendar days.
export interface UsageQuery {
  readonly groupBy: UsageGrouping;
  readonly sessionId?: string | undefined;
  readonly workspaceId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface UsageTotals {
  readonly key: string;
  readonly calls: number;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly credits: number;
}
