import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Result } from "@pica/core";
import { parseJsoncWithSchema, type ScenarioError } from "../runtime/scenario-loader.ts";
import { transcriptSchema, type Transcript } from "./transcript-schema.ts";

export function parseTranscript(text: string, file: string): Result<Transcript, ScenarioError> {
  return parseJsoncWithSchema(text, file, transcriptSchema);
}

export function loadTranscriptFile(file: string): Result<Transcript, ScenarioError> {
  return parseTranscript(readFileSync(file, "utf8"), file);
}

// Transcripts shipped with testkit: one per contract fixture plus the error cases.
export function copilotTranscriptPath(name: string): string {
  return fileURLToPath(new URL(`../../fixtures/copilot/${name}.jsonc`, import.meta.url));
}
