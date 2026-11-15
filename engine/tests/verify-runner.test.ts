import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const runner = join(import.meta.dirname, "..", "..", "tools", "verify", "run.sh");

interface Check {
  check: string;
  run?: string;
  live?: boolean;
  manual?: boolean;
}

// Each call with `units` writes them to a fresh temp folder; all are removed when the file's tests end.
const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function verify(unit: string | undefined, units?: Record<string, Check[]>, extraEnv: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  if (units !== undefined) {
    const dir = mkdtempSync(join(tmpdir(), "pica-verify-"));
    tempDirs.push(dir);
    const file = join(dir, "units.json");
    writeFileSync(file, JSON.stringify(units));
    env.VERIFY_UNITS_FILE = file;
  }
  const result = spawnSync("sh", unit === undefined ? [runner] : [runner, unit], {
    encoding: "utf8",
    env,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("verify runner", () => {
  it("rejects an unknown unit ID and names it", () => {
    const result = verify("Z-99");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Z-99");
  });

  it("rejects a missing unit ID", () => {
    expect(verify(undefined).status).not.toBe(0);
  });

  it("passes when every command passes, skipping manual and unattended live checks", () => {
    const result = verify("T-01", {
      "T-01": [
        { check: "passes", run: "true" },
        { check: "needs a person", manual: true },
        { check: "needs Copilot", live: true, run: "false" },
      ],
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("SKIPPED  needs Copilot");
  });

  it("fails when a command fails", () => {
    const result = verify("T-01", { "T-01": [{ check: "fails", run: "exit 3" }, { check: "passes", run: "true" }] });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAILED   fails");
    expect(result.stdout).toContain("PASSED   passes");
  });

  it("fails when a check has no command yet", () => {
    const result = verify("T-01", { "T-01": [{ check: "not built" }] });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("PENDING  not built");
  });

  it("does not pass the outer make's UNIT to commands", () => {
    const result = verify("T-01", { "T-01": [{ check: "clean env", run: 'test -z "${UNIT:-}${MAKEFLAGS:-}"' }] }, {
      UNIT: "T-01",
      MAKEFLAGS: " -- UNIT=T-01",
    });
    expect(result.status).toBe(0);
  });
});
