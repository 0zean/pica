import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { err, ok } from "@pica/core";
import type { DiagnosticsBundle, Result } from "@pica/core";

export interface DiagnosticsFileError {
  readonly code: "diagnostics.exists" | "diagnostics.write_failed";
  readonly message: string;
}

// Writes the bundle as pretty JSON, readable only by the user, and never over an existing file.
export function writeDiagnosticsFile(
  path: string,
  bundle: DiagnosticsBundle,
): Result<{ readonly path: string; readonly bytes: number }, DiagnosticsFileError> {
  const text = `${JSON.stringify(bundle, null, 2)}\n`;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return ok({ path, bytes: Buffer.byteLength(text) });
  } catch (thrown) {
    if (thrown instanceof Error && "code" in thrown && thrown.code === "EEXIST") {
      return err({ code: "diagnostics.exists", message: `${path} already exists` });
    }
    return err({ code: "diagnostics.write_failed", message: thrown instanceof Error ? thrown.message : String(thrown) });
  }
}
