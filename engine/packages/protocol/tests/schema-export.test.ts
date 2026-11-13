import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { protocolSchemaPath } from "../../../tools/protocol-schema/paths.ts";
import { serializeProtocolJsonSchema } from "../src/index.ts";

describe("protocol.schema.json", () => {
  it("matches the committed file (run `pnpm protocol-schema` to update it)", () => {
    expect(readFileSync(protocolSchemaPath, "utf8")).toBe(serializeProtocolJsonSchema());
  });

  it("resolves every $ref to a definition", () => {
    const text = serializeProtocolJsonSchema();
    const document = JSON.parse(text) as { $defs: Record<string, unknown> };
    const refs = [...text.matchAll(/"\$ref": "#\/\$defs\/([^"]+)"/g)].map((match) => match[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const id of refs) {
      expect(document.$defs).toHaveProperty(id ?? "");
    }
  });
});
