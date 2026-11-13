import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { configSchemaPath } from "../../../tools/config-schema/paths.ts";
import { PicaConfig, serializeConfigJsonSchema } from "../src/index.ts";

describe("config.schema.json", () => {
  it("matches the committed file (run `pnpm config-schema` to update it)", () => {
    expect(readFileSync(configSchemaPath, "utf8")).toBe(serializeConfigJsonSchema());
  });

  it("lists every top-level section and rejects unknown keys", () => {
    const document = JSON.parse(serializeConfigJsonSchema()) as {
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    };
    expect(Object.keys(document.properties).sort()).toEqual(Object.keys(PicaConfig.shape).sort());
    expect(document.additionalProperties).toBe(false);
  });
});
