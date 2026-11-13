import * as z from "zod";
import { Count, Id } from "../common.ts";

export const FileEntry = z.object({
  repoId: Id,
  path: z.string().min(1),
  kind: z.enum(["file", "directory", "symlink"]),
  sizeBytes: Count.nullable(),
});

export const QuickOpenHit = z.object({
  repoId: Id,
  path: z.string().min(1),
  score: z.number(),
});
