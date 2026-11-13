import { describe, expect, it } from "vitest";
import * as z from "zod";
import { buildProtocolJsonSchema, methodNames, methods, NAMESPACES, notificationNames, notifications } from "../src/index.ts";

describe("RPC methods", () => {
  it.each(methodNames)("%s has a request and a response schema", (name) => {
    expect(methods[name].params).toBeInstanceOf(z.ZodType);
    expect(methods[name].result).toBeInstanceOf(z.ZodType);
  });

  it("puts every method in a §4.5 namespace", () => {
    const namespaces = new Set<string>(NAMESPACES);
    for (const name of methodNames) {
      expect(namespaces.has(name.split(".")[0] ?? "")).toBe(true);
    }
  });

  it.each(NAMESPACES)("namespace %s has at least one method", (namespace) => {
    expect(methodNames.some((name) => name.startsWith(`${namespace}.`))).toBe(true);
  });

  it("sends only secrets.* from the engine to the client", () => {
    const engineToClient = methodNames.filter((name) => methods[name].direction === "engine");
    expect(engineToClient.every((name) => name.startsWith("secrets."))).toBe(true);
    expect(engineToClient.length).toBeGreaterThan(0);
  });

  it("exports a params and a result definition for every method", () => {
    const document = buildProtocolJsonSchema() as {
      $defs: Record<string, unknown>;
      "x-pica-methods": Record<string, { params: { $ref: string }; result: { $ref: string } }>;
    };
    expect(Object.keys(document["x-pica-methods"]).sort()).toEqual([...methodNames].sort());
    for (const entry of Object.values(document["x-pica-methods"])) {
      for (const { $ref } of [entry.params, entry.result]) {
        expect(document.$defs).toHaveProperty($ref.replace("#/$defs/", ""));
      }
    }
  });

  it.each(notificationNames)("notification %s has a params schema", (name) => {
    expect(notifications[name]).toBeInstanceOf(z.ZodType);
  });
});
