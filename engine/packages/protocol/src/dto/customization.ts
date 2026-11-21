import * as z from "zod";
import { AbsolutePath, Id } from "../common.ts";

// X-02: custom agents, skills and instruction files, discovered from every layer (docs/agents.md).
export const CustomizationKind = z.enum(["agent", "skill", "instructions"]);
export const CustomizationLayer = z.enum(["builtin", "user", "workspace", "repo"]);

// Agents and skills of the same name: the highest location wins and the others are overridden.
// Instruction files all apply. A file that does not validate is `invalid` and takes no part.
export const CustomizationStatus = z.enum(["active", "overridden", "invalid"]);

// A folder or file Pica reads one kind from, lowest precedence first in `customization.list`.
export const CustomizationLocation = z.object({
  id: Id,
  kind: CustomizationKind,
  layer: CustomizationLayer,
  // How the location is named to the user: "Pica agents", ".github/agents", "AGENTS.md".
  label: z.string().min(1),
  repoId: Id.nullable(),
  // A folder, or the one file the location is (an instructions file).
  path: AbsolutePath,
  // Set when the location is one file: a new item there takes no name.
  singleFile: z.boolean(),
  writable: z.boolean(),
  // The managed policy that stops Pica writing this kind (H-01).
  lockedBy: z.string().optional(),
});

export const CustomizationProblem = z.object({ field: z.string(), message: z.string() });

export const CustomizationItem = z.object({
  kind: CustomizationKind,
  name: z.string().min(1),
  locationId: Id,
  layer: CustomizationLayer,
  repoId: Id.nullable(),
  path: AbsolutePath,
  description: z.string().nullable(),
  text: z.string(),
  status: CustomizationStatus,
  // The file of the same name that wins over this one.
  overriddenBy: AbsolutePath.nullable(),
  problems: z.array(CustomizationProblem),
  writable: z.boolean(),
  lockedBy: z.string().optional(),
});

export type CustomizationKind = z.infer<typeof CustomizationKind>;
export type CustomizationLayer = z.infer<typeof CustomizationLayer>;
export type CustomizationStatus = z.infer<typeof CustomizationStatus>;
export type CustomizationLocation = z.infer<typeof CustomizationLocation>;
export type CustomizationProblem = z.infer<typeof CustomizationProblem>;
export type CustomizationItem = z.infer<typeof CustomizationItem>;
