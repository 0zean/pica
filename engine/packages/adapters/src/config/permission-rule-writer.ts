import { applyEdits, modify } from "jsonc-parser";
import { sameRule } from "@pica/core";
import type { ToolPermissionRule } from "@pica/protocol";
import { jsoncFormatting, readEditableConfig, writeEditedConfig } from "./config-file-edit.ts";
import type { ConfigFileWrite } from "./config-file-edit.ts";

export type PermissionRuleWrite = ConfigFileWrite;

// A-07: appends a `permissions.tools` rule to a config.jsonc (the user layer), editing in place so
// the user's comments and formatting survive.
export function appendPermissionRule(file: string, rule: ToolPermissionRule): PermissionRuleWrite {
  const read = readEditableConfig(file);
  if (!read.ok) return read;
  if ((read.config.permissions.tools ?? []).some((present) => sameRule(present, rule))) {
    return { ok: true };
  }
  const { text } = read;
  const updated = applyEdits(text, modify(text, ["permissions", "tools", -1], rule, { ...jsoncFormatting, isArrayInsertion: true }));
  return writeEditedConfig(file, updated, "the new rule");
}
