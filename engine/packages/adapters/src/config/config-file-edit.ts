import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PicaConfig } from "@pica/protocol";
import { parseConfigFile } from "./jsonc.ts";

export type ConfigFileWrite = { readonly ok: true } | { readonly ok: false; readonly message: string };

export const jsoncFormatting = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } } as const;

type Read = { readonly ok: true; readonly text: string; readonly config: PicaConfig } | { readonly ok: false; readonly message: string };

// The text of a config.jsonc to edit in place, or `{}` when there is none. A file that does not
// parse or validate is not the one the engine is using; editing it would hide that.
export function readEditableConfig(file: string): Read {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (thrown) {
    if (!isMissing(thrown)) return { ok: false, message: errorMessage(thrown) };
    text = "{}\n";
  }
  const parsed = parseConfigFile(file, text);
  if (!parsed.ok) {
    return { ok: false, message: `${file} does not parse: ${parsed.error.issues.map((issue) => issue.message).join("; ")}` };
  }
  const existing = PicaConfig.safeParse(parsed.value.value);
  if (!existing.success) {
    return { ok: false, message: `${file} does not validate: ${existing.error.issues.map((issue) => issue.message).join("; ")}` };
  }
  return { ok: true, text, config: existing.data };
}

// Replaces the file atomically, and only when the edited text still validates, so a write never
// leaves a config the engine would refuse.
export function writeEditedConfig(file: string, updated: string, change: string): ConfigFileWrite {
  const reparsed = parseConfigFile(file, updated);
  if (!reparsed.ok) {
    return { ok: false, message: `${file} would not parse with ${change}` };
  }
  const validated = PicaConfig.safeParse(reparsed.value.value);
  if (!validated.success) {
    return {
      ok: false,
      message: `${file} would not validate with ${change}: ${validated.error.issues.map((issue) => issue.message).join("; ")}`,
    };
  }
  try {
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.${String(process.pid)}.tmp`;
    writeFileSync(temporary, updated.endsWith("\n") ? updated : `${updated}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, file);
  } catch (thrown) {
    return { ok: false, message: errorMessage(thrown) };
  }
  return { ok: true };
}

function isMissing(thrown: unknown): boolean {
  return typeof thrown === "object" && thrown !== null && "code" in thrown && (thrown.code === "ENOENT" || thrown.code === "ENOTDIR");
}

function errorMessage(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}
