import type { Session, SessionState } from "../store/index.ts";

export type SessionRoutingProfile = "off" | "balanced" | "strict";
export type SessionSendMode = "send" | "steer" | "queue";
export type SessionApprovalChoice = "allow_once" | "allow_always" | "deny";

export interface SessionWorktreeInfo {
  readonly repoId: string;
  readonly sessionId: string;
  readonly path: string;
  readonly branch: string;
}

// The protocol's `Session` DTO (PLAN.md §4.5), as the session service reports it.
export interface SessionInfo {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly state: SessionState;
  readonly writeRoots: readonly SessionWorktreeInfo[];
  readonly referenceRoots: readonly string[];
  readonly routingProfile: SessionRoutingProfile;
  readonly budgetCredits: number | null;
  readonly lastSeq: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PendingApproval {
  readonly id: string;
  readonly sessionId: string;
  readonly kind: "tool_call" | "budget";
  readonly toolCallId: string | null;
  readonly summary: string;
}

const routingProfiles: readonly string[] = ["off", "balanced", "strict"] satisfies SessionRoutingProfile[];

export function isRoutingProfile(value: string): value is SessionRoutingProfile {
  return routingProfiles.includes(value);
}

export function toSessionInfo(session: Session, lastSeq: number): SessionInfo {
  return {
    id: session.id,
    workspaceId: session.workspaceId,
    title: "",
    state: session.state,
    // TODO(R-10): report the worktrees Pica creates per write root; until then sessions run in the repo itself.
    writeRoots: [],
    referenceRoots: session.referenceRoots,
    routingProfile: isRoutingProfile(session.routingProfile) ? session.routingProfile : "balanced",
    budgetCredits: session.budgetMaxCredits,
    lastSeq,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}
