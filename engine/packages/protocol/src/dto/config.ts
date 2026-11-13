import * as z from "zod";

export const ConfigLayer = z.enum(["default", "user", "workspace", "repo", "managed"]);

export const ConfigValue = z.object({
  keyPath: z.string().min(1),
  value: z.unknown(),
  layer: ConfigLayer,
  locked: z.boolean(),
});
