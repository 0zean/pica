import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

export const configSchemaPath = join(repoRoot, "engine", "packages", "protocol", "config.schema.json");
