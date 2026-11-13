import * as z from "zod";
import { Credits, Id } from "../common.ts";
import { RepoSource } from "./repo.ts";

export const RoutingProfile = z.enum(["off", "balanced", "strict"]);

export const WorkspaceOverrides = z.object({
  routingProfile: RoutingProfile.optional(),
  dailyCredits: Credits.optional(),
  mcpServerIds: z.array(Id).optional(),
});

export const Workspace = z.object({
  id: Id,
  name: z.string().min(1),
  sources: z.array(RepoSource),
  pinnedRepoIds: z.array(Id),
  overrides: WorkspaceOverrides,
});
