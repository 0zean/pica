import { readdirSync } from "node:fs";
import { formatScenarioError, loadScenarioFile, parseScenario } from "../../src/index.ts";
import { describe, expect, it } from "vitest";

const fixtures = new URL("../../fixtures/runtime/", import.meta.url).pathname;

function errorFor(name: string): string {
  const loaded = loadScenarioFile(`${fixtures}invalid/${name}.jsonc`);
  if (loaded.ok) {
    throw new Error(`${name} unexpectedly validated`);
  }
  return formatScenarioError(loaded.error);
}

describe("scenario schema", () => {
  const validFiles = [
    "full-tour.jsonc",
    ...readdirSync(`${fixtures}contract`).map((name) => `contract/${name}`),
  ];

  it.each(validFiles)("accepts %s", (name) => {
    const loaded = loadScenarioFile(`${fixtures}${name}`);
    expect(loaded.ok ? "valid" : formatScenarioError(loaded.error)).toBe("valid");
  });

  it.each([
    ["unknown-step-type", 9, "turns.0.steps.1.type"],
    ["wrong-field-type", 10, "turns.0.steps.0.inputTokens"],
    ["unknown-model", 11, "turns.0.steps.0.model"],
    ["missing-key", 1, "defaultModel"],
    ["bad-deltas", 7, "turns.0.steps.0.deltas"],
    ["unknown-key", 8, "turns.0.steps.0.sucess"],
  ])("rejects %s with a line reference", (name, line, path) => {
    const message = errorFor(name);
    expect(message).toMatch(new RegExp(`^\\S+/invalid/${name}\\.jsonc:${String(line)}:\\d+: ${path.replaceAll(".", "\\.")}: `));
  });

  it("reports a JSONC syntax error at its line", () => {
    expect(errorFor("syntax-error")).toMatch(/syntax-error\.jsonc:5:\d+: \(syntax\): CommaExpected/);
  });

  it("accepts comments and trailing commas", () => {
    const text = `// comment\n{ "version": 1, "models": [{ "id": "m", "name": "M", },], "defaultModel": "m", "turns": [], }`;
    expect(parseScenario(text, "inline.jsonc").ok).toBe(true);
  });

  it("reports an empty file", () => {
    const parsed = parseScenario("", "empty.jsonc");
    expect(parsed.ok ? "" : formatScenarioError(parsed.error)).toMatch(/^empty\.jsonc:1:1: /);
  });
});
