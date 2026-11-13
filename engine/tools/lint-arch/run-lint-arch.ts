import { spawnSync } from "node:child_process";
import { join } from "node:path";

export const fixtures = join(import.meta.dirname, "fixtures");

export function lintArch(...args: string[]): { status: number | null; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(import.meta.dirname, "main.ts"), ...args],
    { encoding: "utf8" },
  );
  return { status: result.status, stderr: result.stderr };
}
