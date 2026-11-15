import * as z from "zod";
import * as common from "./common.ts";
import * as agents from "./dto/agents.ts";
import * as config from "./dto/config.ts";
import * as fanout from "./dto/fanout.ts";
import * as files from "./dto/files.ts";
import * as git from "./dto/git.ts";
import * as github from "./dto/github.ts";
import * as mcp from "./dto/mcp.ts";
import * as mcpImport from "./dto/mcp-import.ts";
import * as models from "./dto/models.ts";
import * as policy from "./dto/policy.ts";
import * as repo from "./dto/repo.ts";
import * as session from "./dto/session.ts";
import * as usage from "./dto/usage.ts";
import * as workspace from "./dto/workspace.ts";
import { eventPayloads, eventSchemas, eventTypes, SessionEvent } from "./events.ts";
import * as jsonrpc from "./jsonrpc.ts";
import { RPC_ERROR_NUMBERS } from "./jsonrpc.ts";
import { ById, ByRepo, BySession, ByWorktree, methodNames, methods, notificationNames, notifications, Ok } from "./methods.ts";
import { PROTOCOL_VERSION } from "./version.ts";

const dtoModules = [common, agents, config, fanout, files, git, github, mcp, mcpImport, models, policy, repo, session, usage, workspace, jsonrpc];
const sharedShapes = { ById, ByRepo, BySession, ByWorktree, Ok };

// "session.state_changed" → "SessionStateChanged"
export function typeName(dotted: string): string {
  return dotted
    .split(/[._]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function buildRegistry() {
  const registry = z.registry<{ id: string }>();
  const register = (schema: z.ZodType, id: string): void => {
    if (!registry.has(schema)) {
      registry.add(schema, { id });
    }
  };
  for (const module of dtoModules) {
    for (const [name, value] of Object.entries(module)) {
      if (value instanceof z.ZodType) {
        register(value, name);
      }
    }
  }
  for (const [name, schema] of Object.entries(sharedShapes)) {
    register(schema, name);
  }
  for (const type of eventTypes) {
    register(eventPayloads[type], `${typeName(type)}Payload`);
    register(eventSchemas[type], `${typeName(type)}Event`);
  }
  register(SessionEvent, "SessionEvent");
  for (const name of methodNames) {
    register(methods[name].params, `${typeName(name)}Params`);
    register(methods[name].result, `${typeName(name)}Result`);
  }
  for (const name of notificationNames) {
    register(notifications[name], `${typeName(name)}Notification`);
  }
  return registry;
}

function ref(registry: ReturnType<typeof buildRegistry>, schema: z.ZodType): { $ref: string } {
  const meta = registry.get(schema);
  if (meta === undefined) {
    throw new Error("schema missing from registry");
  }
  return { $ref: `#/$defs/${meta.id}` };
}

export function buildProtocolJsonSchema(): Record<string, unknown> {
  const registry = buildRegistry();
  const { schemas } = z.toJSONSchema(registry, {
    target: "draft-2020-12",
    io: "input",
    uri: (id) => `#/$defs/${id}`,
  });
  const defs = Object.fromEntries(
    Object.keys(schemas)
      .sort()
      .map((id) => {
        const definition: Record<string, unknown> = { ...schemas[id] };
        delete definition.$schema;
        delete definition.$id;
        return [id, definition];
      }),
  );
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:pica:protocol",
    title: "Pica engine protocol",
    "x-pica-protocol-version": PROTOCOL_VERSION,
    "x-pica-methods": Object.fromEntries(
      methodNames.map((name) => [
        name,
        {
          direction: methods[name].direction,
          params: ref(registry, methods[name].params),
          result: ref(registry, methods[name].result),
        },
      ]),
    ),
    "x-pica-notifications": Object.fromEntries(
      notificationNames.map((name) => [name, { params: ref(registry, notifications[name]) }]),
    ),
    "x-pica-events": Object.fromEntries(eventTypes.map((type) => [type, ref(registry, eventSchemas[type])])),
    "x-pica-rpc-error-numbers": RPC_ERROR_NUMBERS,
    $defs: defs,
  };
}

export function serializeProtocolJsonSchema(): string {
  return `${JSON.stringify(buildProtocolJsonSchema(), null, 2)}\n`;
}
