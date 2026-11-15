import * as z from "zod";

// The shape of one server entry in a Pica `mcp.jsonc` file (docs/mcp-configuration.md). Strings in
// `env`, `headers`, and `args` may contain `${secret:<provider>:<name>}` references
// (docs/secret-references.md); core checks their syntax and placement.

const McpFileSecretRef = z.strictObject({ secretRef: z.string().min(1) });
const McpFileValue = z.union([z.string(), McpFileSecretRef]);
const McpFileTools = z.array(z.string().min(1)).describe("Tools the session may use; absent means all");

// M-07: where an imported entry came from. `source` is the file it was copied from, with the home
// directory written as `~`; a pasted snippet has none.
export const McpFileImportedFrom = z.strictObject({
  platform: z.string().min(1),
  source: z.string().min(1).optional(),
  name: z.string().min(1),
  project: z.string().min(1).optional(),
});

const McpFileStdioServer = z.strictObject({
  name: z.string().min(1).optional(),
  type: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), McpFileValue).optional(),
  cwd: z.string().min(1).optional(),
  tools: McpFileTools.optional(),
  importedFrom: McpFileImportedFrom.optional(),
});

const McpFileRemoteServer = z.strictObject({
  name: z.string().min(1).optional(),
  type: z.enum(["http", "sse"]),
  url: z.url(),
  headers: z.record(z.string(), McpFileValue).optional(),
  tools: McpFileTools.optional(),
  importedFrom: McpFileImportedFrom.optional(),
});

export const PicaMcpServerEntry = z.discriminatedUnion("type", [McpFileStdioServer, McpFileRemoteServer]);
export type PicaMcpServerEntry = z.output<typeof PicaMcpServerEntry>;
export type PicaMcpFileValue = z.output<typeof McpFileValue>;
export type McpFileImportedFrom = z.output<typeof McpFileImportedFrom>;
