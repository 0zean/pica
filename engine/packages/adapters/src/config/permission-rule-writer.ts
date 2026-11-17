import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { applyEdits, modify } from "jsonc-parser";
import { sameRule } from "@pica/core";
import { PicaConfig } from "@pica/protocol";
import type { ToolPermissionRule } from "@pica/protocol";
import { parseConfigFile } from "./jsonc.ts";

export type PermissionRuleWrite = { readonly ok: true } | { readonly ok: false; readonly message: string };

const formatting = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } };

// A-07: appends a `permissions.tools` rule to a config.jsonc (the user layer), editing in place so
// the user's comments and formatting survive. The file is replaced atomically, and only when the
// result still validates, so a write never leaves a config the engine would refuse.
export function appendPermissionRule(file: string, rule: ToolPermissionRule): PermissionRuleWrite {
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
  // A file that does not validate is not the one the engine is using; editing it would hide that.
  const existing = PicaConfig.safeParse(parsed.value.value);
  if (!existing.success) {
    return { ok: false, message: `${file} does not validate: ${existing.error.issues.map((issue) => issue.message).join("; ")}` };
  }
  if ((existing.data.permissions.tools ?? []).some((present) => sameRule(present, rule))) {
    return { ok: true };
  }
  const updated = applyEdits(text, modify(text, ["permissions", "tools", -1], rule, { ...formatting, isArrayInsertion: true }));
  const reparsed = parseConfigFile(file, updated);
  if (!reparsed.ok || !PicaConfig.safeParse(reparsed.value.value).success) {
    return { ok: false, message: `${file} would not validate with the new rule` };
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
