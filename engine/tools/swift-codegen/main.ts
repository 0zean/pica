import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { protocolSchemaPath } from "../protocol-schema/paths.ts";
import { generateSwift } from "./files.ts";
import { generatedSwiftDir } from "./paths.ts";
import type { ProtocolDocument } from "./schema.ts";

const document = JSON.parse(readFileSync(protocolSchemaPath, "utf8")) as ProtocolDocument;
const files = generateSwift(document);

mkdirSync(generatedSwiftDir, { recursive: true });
for (const stale of readdirSync(generatedSwiftDir).filter((name) => !(name in files))) {
  rmSync(join(generatedSwiftDir, stale));
}
for (const [name, contents] of Object.entries(files)) {
  writeFileSync(join(generatedSwiftDir, name), contents);
}
console.log(`wrote ${String(Object.keys(files).length)} files to ${generatedSwiftDir}`);
