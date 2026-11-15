import * as z from "zod";
import { McpTransport } from "./mcp.ts";

// M-07: MCP servers the user already runs in another agent platform (docs/mcp-import.md).

// `paste` is a snippet the user pasted rather than a file Pica found.
export const McpImportPlatform = z.enum([
  "claude-desktop",
  "claude-code",
  "cursor",
  "windsurf",
  "vscode",
  "gemini-cli",
  "copilot-cli",
  "mcp-json",
  "paste",
]);

export const McpImportNote = z.object({
  keyPath: z.string(),
  message: z.string(),
});

export const McpImportCandidate = z.object({
  // Opaque; send it back in `mcp.import`.
  candidateId: z.string().min(1),
  platform: McpImportPlatform,
  // The server's name in the platform's file.
  name: z.string().min(1),
  // The Pica server id the import proposes; `mcp.import` may override it.
  id: z.string().min(1),
  // Claude Code keeps servers per project; the project directory, else null.
  project: z.string().nullable(),
  // What the import would write, with inline secrets shown as the references that replace them.
  // Null when the entry cannot be imported (see `issues`).
  transport: McpTransport.nullable(),
  toolAllowlist: z.array(z.string().min(1)).nullable(),
  // Key paths of inline secrets the import moves to the Keychain.
  secretFields: z.array(z.string()),
  // Fields Pica drops.
  notes: z.array(McpImportNote),
  // Reasons the entry cannot be imported; empty when it can.
  issues: z.array(McpImportNote),
});

export const McpImportSource = z.object({
  platform: McpImportPlatform,
  // The file, with the home directory written as `~`; "paste" for a snippet.
  source: z.string().min(1),
  candidates: z.array(McpImportCandidate),
  notes: z.array(McpImportNote),
});

export const McpImportSelection = z.object({
  candidateId: z.string().min(1),
  id: z.string().min(1).optional(),
});

export const McpImportSnippet = z.object({
  text: z.string().min(1),
  // Required when the snippet is a single entry without its name.
  name: z.string().min(1).optional(),
});

export type McpImportPlatform = z.infer<typeof McpImportPlatform>;
export type McpImportNote = z.infer<typeof McpImportNote>;
export type McpImportCandidate = z.infer<typeof McpImportCandidate>;
export type McpImportSource = z.infer<typeof McpImportSource>;
export type McpImportSelection = z.infer<typeof McpImportSelection>;
export type McpImportSnippet = z.infer<typeof McpImportSnippet>;
