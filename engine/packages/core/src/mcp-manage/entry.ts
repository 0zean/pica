import type { McpServerDef, PicaMcpServerEntry } from "@pica/protocol";
import { configError } from "../config/errors.ts";
import type { ConfigError } from "../config/errors.ts";
import { buildMcpDefinitions } from "../mcp/definitions.ts";
import { err, ok } from "../result.ts";
import type { Result } from "../result.ts";

// The `mcp.jsonc` entry that reads back as `definition`. Secret references stay references.
export function mcpServerFileEntry(definition: McpServerDef): PicaMcpServerEntry {
  const tools = definition.toolAllowlist === null ? {} : { tools: [...definition.toolAllowlist] };
  const transport = definition.transport;
  if (transport.type === "stdio") {
    return {
      name: definition.name,
      type: "stdio",
      command: transport.command,
      ...(transport.args.length === 0 ? {} : { args: [...transport.args] }),
      ...(Object.keys(transport.env).length === 0 ? {} : { env: { ...transport.env } }),
      ...(transport.cwd === null ? {} : { cwd: transport.cwd }),
      ...tools,
    };
  }
  return {
    name: definition.name,
    type: transport.type,
    url: transport.url,
    ...(Object.keys(transport.headers).length === 0 ? {} : { headers: { ...transport.headers } }),
    ...tools,
  };
}

// Reads the entry back through M-01's rules, so an added server obeys what a hand-edited file
// does: a valid id, well-formed references, and no inline secret.
export function checkedMcpServerEntry(
  definition: McpServerDef,
  file: string,
): Result<{ readonly entry: PicaMcpServerEntry; readonly definition: McpServerDef }, ConfigError> {
  const entry = mcpServerFileEntry(definition);
  const built = buildMcpDefinitions(file, definition.scope, [{ id: definition.id, keyPath: ["servers", definition.id], entry }]);
  if (!built.ok) {
    return built;
  }
  const [read] = built.value;
  if (read === undefined) {
    return err(configError("config.invalid", file, [{ keyPath: `servers.${definition.id}`, message: "the server was not read back" }]));
  }
  return ok({ entry, definition: read });
}
