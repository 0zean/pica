import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { protocolSchemaPath } from "../protocol-schema/paths.ts";
import { generateSwift } from "./files.ts";
import type { ProtocolDocument, SchemaNode } from "./schema.ts";

const committed = JSON.parse(readFileSync(protocolSchemaPath, "utf8")) as ProtocolDocument;

function documentWith(defs: Record<string, SchemaNode>): ProtocolDocument {
  return { ...committed, "x-pica-events": {}, "x-pica-methods": {}, "x-pica-notifications": {}, $defs: { ...defs, SessionEvent: committed.$defs.SessionEvent ?? {} } };
}

describe("generateSwift", () => {
  it("is deterministic", () => {
    expect(generateSwift(committed)).toEqual(generateSwift(structuredClone(committed)));
  });

  it("declares every definition in the schema", () => {
    const swift = Object.values(generateSwift(committed)).join("\n");
    for (const name of Object.keys(committed.$defs)) {
      expect(swift).toMatch(new RegExp(`public (struct|enum|typealias) ${name}\\b`));
    }
  });

  it("gives the event union an unknown case", () => {
    expect(generateSwift(committed)["Events.swift"]).toContain("default: self = .unknown(try Unknown(from: decoder))");
  });

  it("refuses an inline type that would shadow a definition", () => {
    const document = documentWith({
      Mode: { type: "string" },
      Holder: { type: "object", properties: { mode: { type: "string", enum: ["a", "b"] } }, required: ["mode"] },
    });
    expect(() => generateSwift(document)).toThrow(/would shadow/);
  });

  it("refuses enum values that collide as Swift case names", () => {
    const document = documentWith({ Choice: { type: "string", enum: ["dry_run", "dry-run"] } });
    expect(() => generateSwift(document)).toThrow(/collide/);
  });
});
