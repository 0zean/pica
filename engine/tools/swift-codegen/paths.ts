import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

export const protocolPackageDir = join(repoRoot, "app", "Packages", "PicaProtocol");
export const generatedSwiftDir = join(protocolPackageDir, "Sources", "PicaProtocol", "Generated");
