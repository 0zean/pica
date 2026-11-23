import * as z from "zod";
import { AbsolutePath, Credits, Id, Timestamp } from "../common.ts";
import { RoutingProfile } from "./workspace.ts";

export const SessionState = z.enum([
  "starting",
  "idle",
  "running",
  "awaiting_approval",
  "ended",
  "failed",
  "resumable",
]);

export const Worktree = z.object({
  repoId: Id,
  sessionId: Id,
  path: AbsolutePath,
  branch: z.string().min(1),
});

// A session's own model per tier, over the config's `routing.tiers`: a model id or "auto", resolved as the
// config's setting is (docs/model-catalog.md). A tier left out follows `routing.tiers`.
export const SessionModelTiers = z.object({
  reasoning: z.string().min(1).optional(),
  worker: z.string().min(1).optional(),
});

export const Session = z.object({
  id: Id,
  workspaceId: Id,
  title: z.string(),
  state: SessionState,
  writeRoots: z.array(Worktree),
  referenceRoots: z.array(AbsolutePath),
  routingProfile: RoutingProfile,
  // Absent when the session follows `routing.tiers` for both tiers.
  modelTiers: SessionModelTiers.optional(),
  budgetCredits: Credits.nullable(),
  lastSeq: z.int().nonnegative(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

// A-10: a directory the session works in. Until R-10's worktrees are reported, a repo's is its checkout.
export const SessionRoot = z.object({
  path: AbsolutePath,
  access: z.enum(["write", "reference"]),
  // The registered repo checked out at `path`, or null when none is.
  repoId: Id.nullable(),
});

export const SendMode = z.enum(["send", "steer", "queue"]);
