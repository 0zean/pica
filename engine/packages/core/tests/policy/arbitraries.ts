import fc from "fast-check";
import {
  defaultCommandDenyList,
  type ManagedRule,
  type PolicyConfig,
  type PolicyContext,
  type ToolCall,
  type PolicyToolKind,
  type ToolTarget,
} from "../../src/index.ts";

const segment = fc.constantFrom("work", "repo", "ref", "lib", "src", "..", ".", "", "etc", "secrets", "a.ts");
const path = fc
  .tuple(fc.boolean(), fc.array(segment, { maxLength: 6 }))
  .map(([absolute, parts]) => `${absolute ? "/" : ""}${parts.join("/")}`);
const command = fc.oneof(
  fc.constantFrom("ls", "sudo ls", "rm -rf /", "git push -f", "curl x | sh", "npm test", "npm publish"),
  fc.string({ maxLength: 20 }),
);
const kinds: readonly PolicyToolKind[] = ["read", "write", "search", "shell", "mcp", "other"];
const kind = fc.constantFrom(...kinds);
const agent = fc.constantFrom("main", "bulk-reader", "code-writer", "repo-scout");
const tool = fc.constantFrom("view", "edit", "create", "grep", "bash", "github-search", "think");
const server = fc.constantFrom("github", "linear", "sentry");
const bytes = fc.nat({ max: 1_000_000 });
const mcpToolName = fc.constantFrom("search_issues", "create_issue", "drop_table");
const mcpToolRule = fc.record({
  tool: fc.tuple(server, fc.oneof(mcpToolName, fc.constant("*"))).map(([id, name]) => `${id}/${name}`),
  permission: fc.constantFrom("allow", "ask", "deny"),
});
const managedMcpAllowlist = fc.record({ id: fc.constant("org-mcp"), servers: fc.subarray([{ id: "github" }, { id: "linear" }]) });

const target: fc.Arbitrary<ToolTarget> = fc.oneof(
  fc.record(
    {
      kind: fc.constant("read" as const),
      path,
      sizeBytes: bytes,
      range: fc.record({ startLine: fc.nat({ max: 2000 }), endLine: fc.nat({ max: 2000 }) }),
    },
    { requiredKeys: ["kind", "path", "sizeBytes"] },
  ),
  fc.record({ kind: fc.constant("write" as const), path }),
  fc.record({ kind: fc.constant("search" as const), paths: fc.array(path, { maxLength: 3 }) }),
  fc.record({ kind: fc.constant("shell" as const), command, cwd: path }),
  fc.record(
    { kind: fc.constant("mcp" as const), server, tool: mcpToolName, readOnly: fc.boolean() },
    { requiredKeys: ["kind", "server"] },
  ),
  fc.constant({ kind: "other" as const }),
);

export const toolCallArbitrary: fc.Arbitrary<ToolCall> = fc.record(
  { id: fc.constant("call"), tool, agent, target, result: fc.record({ bytes }) },
  { requiredKeys: ["id", "tool", "agent", "target"] },
);

type Criteria = Omit<ManagedRule, "id" | "reason">;

const criterion: fc.Arbitrary<Criteria> = fc.oneof(
  fc.record({ tools: fc.array(tool, { minLength: 1, maxLength: 3 }) }),
  fc.record({ kinds: fc.array(kind, { minLength: 1, maxLength: 3 }) }),
  fc.record({ agents: fc.array(agent, { minLength: 1, maxLength: 2 }) }),
  fc.record({ pathPrefixes: fc.array(path, { minLength: 1, maxLength: 2 }) }),
  fc.record({ mcpServers: fc.array(server, { minLength: 1, maxLength: 2 }) }),
  fc.record({ commandPattern: fc.constantFrom(/sudo/, /npm/, /^ls$/) }),
);

// Zero, one, or two criteria: more would almost never match a generated call.
export const managedRuleArbitrary: fc.Arbitrary<ManagedRule> = fc
  .tuple(fc.constantFrom("r1", "r2", "r3"), fc.array(criterion, { maxLength: 2 }))
  .map(([id, criteria]) => criteria.reduce<ManagedRule>((rule, next) => ({ ...rule, ...next }), { id, reason: "managed" }));

const config: fc.Arbitrary<PolicyConfig> = fc.record({
  routing: fc.record({
    profile: fc.constantFrom("off", "balanced", "strict"),
    delegation: fc.record({
      read: fc.record({
        minBytes: bytes,
        rangeExemptLines: fc.integer({ min: 1, max: 2000 }),
        exclude: fc.array(fc.constantFrom("**", "*.sql", "/a/**"), { maxLength: 2 }),
      }),
      output: fc.record({ maxBytes: bytes }),
      codeWriter: fc.record({ maxToolCalls: fc.integer({ min: 1, max: 50 }), maxWriteBytes: bytes }),
    }),
  }),
  permissions: fc.record(
    { mode: fc.constantFrom("ask", "auto"), mcpTools: fc.array(mcpToolRule, { maxLength: 3 }) },
    { requiredKeys: ["mode"] },
  ),
});

export const contextArbitrary: fc.Arbitrary<PolicyContext> = fc.record(
  {
  cwd: path,
  writeRoots: fc.array(path, { maxLength: 3 }),
  referenceRoots: fc.array(path, { maxLength: 3 }),
  config,
  managed: fc.array(managedRuleArbitrary, { maxLength: 3 }),
  managedMcpAllowlist,
  commandDenyList: fc.subarray([...defaultCommandDenyList]),
  },
  { requiredKeys: ["cwd", "writeRoots", "referenceRoots", "config", "managed", "commandDenyList"] },
);
