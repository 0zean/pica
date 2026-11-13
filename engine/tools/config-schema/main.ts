import { writeFileSync } from "node:fs";
import { serializeConfigJsonSchema } from "../../packages/protocol/src/config-file.ts";
import { configSchemaPath } from "./paths.ts";

writeFileSync(configSchemaPath, serializeConfigJsonSchema());
console.log(`wrote ${configSchemaPath}`);
