import * as z from "zod";
import { AbsolutePath, Id, Timestamp } from "../common.ts";

export const CloneState = z.enum(["available", "cloning", "cloned", "failed"]);

export const Repo = z.object({
  id: Id,
  remoteUrl: z.string().min(1).nullable(),
  localPath: AbsolutePath.nullable(),
  managed: z.boolean(),
  defaultBranch: z.string().min(1).nullable(),
  cloneState: CloneState,
});

export const RepoSourceKind = z.enum(["manual", "team", "topic", "property"]);

export const RepoSource = z.object({
  id: Id,
  kind: RepoSourceKind,
  org: z.string().min(1).nullable(),
  selector: z.string().min(1).nullable(),
  lastSyncedAt: Timestamp.nullable(),
});

export const RepoCard = z.object({
  repoId: Id,
  headCommit: z.string().min(1),
  languages: z.array(z.string()),
  manifests: z.array(z.string()),
  buildCommands: z.array(z.string()),
  testCommands: z.array(z.string()),
  owners: z.array(z.string()),
  entryPoints: z.array(z.string()),
});
