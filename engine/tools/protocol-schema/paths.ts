import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

export const protocolSchemaPath = join(repoRoot, "engine", "packages", "protocol", "protocol.schema.json");
export const validFixturesDir = join(repoRoot, "fixtures", "protocol");
export const invalidFixturesDir = join(repoRoot, "fixtures", "protocol-invalid");
