import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendPermissionRule, parseConfigFile } from "../../src/index.ts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pica-rules-"));
  file = join(dir, "Pica", "config.jsonc");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const rule = { tool: "bash", match: "npm test", permission: "allow" } as const;

function tools(): unknown {
  const parsed = parseConfigFile(file, readFileSync(file, "utf8"));
  if (!parsed.ok) throw new Error(parsed.error.message);
  return (parsed.value.value as { permissions?: { tools?: unknown } }).permissions?.tools;
}

describe("A-07 appendPermissionRule", () => {
  it("creates the file when there is none", () => {
    expect(appendPermissionRule(file, rule)).toEqual({ ok: true });
    expect(tools()).toEqual([rule]);
  });

  it("appends to the user's rules, keeping comments and other keys", () => {
    mkdirSync(join(dir, "Pica"));
    writeFileSync(file, '{\n  // keep me\n  "permissions": { "mode": "ask", "tools": [{ "tool": "edit", "permission": "deny" }] },\n}\n');
    expect(appendPermissionRule(file, rule)).toEqual({ ok: true });
    expect(tools()).toEqual([{ tool: "edit", permission: "deny" }, rule]);
    const text = readFileSync(file, "utf8");
    expect(text).toContain("// keep me");
    expect(text).toContain('"mode": "ask"');
  });

  it("does not add an identical rule twice", () => {
    appendPermissionRule(file, rule);
    expect(appendPermissionRule(file, rule)).toEqual({ ok: true });
    expect(tools()).toEqual([rule]);
  });

  it("refuses a file that does not parse and leaves it as it was", () => {
    mkdirSync(join(dir, "Pica"));
    writeFileSync(file, "{ not json\n");
    const written = appendPermissionRule(file, rule);
    expect(written.ok).toBe(false);
    expect(readFileSync(file, "utf8")).toBe("{ not json\n");
  });

  it("refuses to write a config that would not validate", () => {
    mkdirSync(join(dir, "Pica"));
    writeFileSync(file, '{ "permissions": { "tools": "everything" } }\n');
    expect(appendPermissionRule(file, rule).ok).toBe(false);
    expect(readFileSync(file, "utf8")).toBe('{ "permissions": { "tools": "everything" } }\n');
  });
});
