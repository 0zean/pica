import { writeFileSync } from "node:fs";
import { serializeProtocolJsonSchema } from "../../packages/protocol/src/json-schema.ts";
import { protocolSchemaPath } from "./paths.ts";

writeFileSync(protocolSchemaPath, serializeProtocolJsonSchema());
console.log(`wrote ${protocolSchemaPath}`);
