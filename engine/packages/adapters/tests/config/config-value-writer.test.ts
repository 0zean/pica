import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseConfigFile, setConfigValue } from "../../src/index.ts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pica-set-"));
  file = join(dir, "Pica", "config.jsonc");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function read(): Record<string, unknown> {
  const parsed = parseConfigFile(file, readFileSync(file, "utf8"));
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value.value as Record<string, unknown>;
}

describe("A-14 setConfigValue", () => {
  it("creates the file when there is none", () => {
    expect(setConfigValue(file, "routing.tiers.reasoning", "model-a")).toEqual({ ok: true });
    expect(read()).toEqual({ routing: { tiers: { reasoning: "model-a" } } });
  });

  it("edits in place, keeping comments and other keys", () => {
    mkdirSync(join(dir, "Pica"));
    writeFileSync(file, '{\n  // keep me\n  "budget": { "sessionCredits": 10 },\n}\n');
    expect(setConfigValue(file, "keybindings.toggleInspector", "cmd+ctrl+j")).toEqual({ ok: true });
    const text = readFileSync(file, "utf8");
    expect(text).toContain("// keep me");
    expect(read()).toEqual({ budget: { sessionCredits: 10 }, keybindings: { toggleInspector: "cmd+ctrl+j" } });
  });

  it("removes a key for null", () => {
    setConfigValue(file, "keybindings.toggleInspector", "cmd+j");
    expect(setConfigValue(file, "keybindings.toggleInspector", null)).toEqual({ ok: true });
    expect(read()).toEqual({ keybindings: {} });
  });

  it("refuses a value that does not validate and leaves the file as it was", () => {
    mkdirSync(join(dir, "Pica"));
    writeFileSync(file, '{ "budget": { "sessionCredits": 10 } }\n');
    const written = setConfigValue(file, "budget.sessionCredits", "lots");
    expect(written.ok).toBe(false);
    expect(setConfigValue(file, "budget.misspelt", 1).ok).toBe(false);
    expect(readFileSync(file, "utf8")).toBe('{ "budget": { "sessionCredits": 10 } }\n');
  });

  it("refuses a file that does not parse", () => {
    mkdirSync(join(dir, "Pica"));
    writeFileSync(file, "{ not json\n");
    expect(setConfigValue(file, "budget.sessionCredits", 1).ok).toBe(false);
    expect(readFileSync(file, "utf8")).toBe("{ not json\n");
  });
});
