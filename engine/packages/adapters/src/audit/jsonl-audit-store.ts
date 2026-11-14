import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { err, ok } from "@pica/core";
import type { AuditErrorCode, AuditResult, AuditStore } from "@pica/core";

// One JSON entry per line. Each line goes out in a single append, so an entry is never interleaved
// with another; a crash mid-write leaves a partial last line that verification reports.
export function createJsonlAuditStore(path: string): AuditStore {
  return {
    readLines: () =>
      attempt("audit.read_failed", () => {
        const text = readIfPresent(path);
        const lines = text.split("\n");
        return text.endsWith("\n") || text === "" ? lines.slice(0, -1) : lines;
      }),
    appendLine: (line) =>
      attempt("audit.write_failed", () => {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        appendFileSync(path, `${line}\n`, { encoding: "utf8", mode: 0o600 });
      }),
  };
}

function readIfPresent(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (thrown) {
    if (thrown instanceof Error && "code" in thrown && thrown.code === "ENOENT") {
      return "";
    }
    throw thrown;
  }
}

function attempt<T>(code: AuditErrorCode, run: () => T): AuditResult<T> {
  try {
    return ok(run());
  } catch (thrown) {
    return err({ code, message: thrown instanceof Error ? thrown.message : String(thrown) });
  }
}
