import { applyEdits, modify } from "jsonc-parser";
import { jsoncFormatting, readEditableConfig, writeEditedConfig } from "./config-file-edit.ts";
import type { ConfigFileWrite } from "./config-file-edit.ts";

// A-14: sets one key of a config.jsonc (`config.set`), editing in place so comments and formatting
// survive. `null` removes the key, so the layers below apply again.
export function setConfigValue(file: string, keyPath: string, value: unknown): ConfigFileWrite {
  const read = readEditableConfig(file);
  if (!read.ok) return read;
  const { text } = read;
  const path = keyPath.split(".");
  const updated = applyEdits(text, modify(text, path, value === null ? undefined : value, jsoncFormatting));
  return writeEditedConfig(file, updated, `${keyPath} set`);
}
