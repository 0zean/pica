import * as z from "zod";

export const ConfigLayer = z.enum(["default", "user", "workspace", "repo", "managed"]);

export const ConfigValue = z.object({
  keyPath: z.string().min(1),
  value: z.unknown(),
  layer: ConfigLayer,
  locked: z.boolean(),
  // A-14: the managed policy (its `id`) that locks the key, so a client can name it.
  lockedBy: z.string().min(1).optional(),
});
