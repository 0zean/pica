import { describe, expect, it } from "vitest";
import { decide, type PolicyContext, type RuleId, type ToolCall, type ToolTarget } from "../../src/index.ts";
import { baseContext, policyConfig, referenceRoot, toolCall, writeRoot } from "./fixtures.ts";

interface Case {
  readonly name: string;
  readonly call: ToolCall;
  readonly context?: Partial<PolicyContext>;
  readonly outcome: "allow" | "deny" | "ask" | "rewrite";
  readonly ruleId: RuleId;
}

const minBytes = 32768;
const rangeExemptLines = 400;
const maxBytes = 16384;

const smallRead = (path: string): ToolTarget => ({ kind: "read", path, sizeBytes: 100 });
const largeRead = (path = `${writeRoot}/schema.sql`): ToolTarget => ({ kind: "read", path, sizeBytes: 212_000 });
const write = (path: string): ToolTarget => ({ kind: "write", path });
const shell = (command: string, cwd = writeRoot): ToolTarget => ({ kind: "shell", command, cwd });
const mcp = (server: string): ToolTarget => ({ kind: "mcp", server });
const other: ToolTarget = { kind: "other" };
const withResult = (target: ToolTarget, bytes: number, agent = "main"): ToolCall =>
  toolCall(target, { result: { bytes }, agent });
const ranged = (startLine: number, endLine: number): ToolTarget => ({
  kind: "read",
  path: `${writeRoot}/schema.sql`,
  sizeBytes: 212_000,
  range: { startLine, endLine },
});
const routing = (routingOverrides: unknown, permissions: unknown = {}): Partial<PolicyContext> => ({
  config: policyConfig({ routing: routingOverrides, permissions }),
});
const auto: Partial<PolicyContext> = { config: policyConfig({ permissions: { mode: "auto" } }) };
const managed = (...rules: PolicyContext["managed"]): Partial<PolicyContext> => ({ managed: rules });
const block = { id: "block", reason: "Blocked by the organization" };

const managedCases: Case[] = [
  { name: "a rule with no criteria denies every call", call: toolCall(smallRead(`${writeRoot}/a.ts`)), context: managed(block), outcome: "deny", ruleId: "managed:block" },
  { name: "tools criterion matches the tool name", call: toolCall(write(`${writeRoot}/a.ts`)), context: managed({ ...block, tools: ["edit"] }), outcome: "deny", ruleId: "managed:block" },
  { name: "tools criterion ignores other tools", call: toolCall(smallRead(`${writeRoot}/a.ts`)), context: managed({ ...block, tools: ["edit"] }), outcome: "allow", ruleId: "permission.read-only" },
  { name: "kinds criterion matches the target kind", call: toolCall(write(`${writeRoot}/a.ts`)), context: managed({ ...block, kinds: ["write", "shell"] }), outcome: "deny", ruleId: "managed:block" },
  { name: "kinds criterion ignores other kinds", call: toolCall(smallRead(`${writeRoot}/a.ts`)), context: managed({ ...block, kinds: ["write"] }), outcome: "allow", ruleId: "permission.read-only" },
  { name: "agents criterion matches a sub-agent", call: toolCall(smallRead(`${writeRoot}/a.ts`), { agent: "bulk-reader" }), context: managed({ ...block, agents: ["bulk-reader"] }), outcome: "deny", ruleId: "managed:block" },
  { name: "agents criterion ignores the main agent", call: toolCall(smallRead(`${writeRoot}/a.ts`)), context: managed({ ...block, agents: ["bulk-reader"] }), outcome: "allow", ruleId: "permission.read-only" },
  { name: "mcpServers criterion matches the server", call: toolCall(mcp("github")), context: managed({ ...block, mcpServers: ["github"] }), outcome: "deny", ruleId: "managed:block" },
  { name: "mcpServers criterion ignores other servers", call: toolCall(mcp("linear")), context: managed({ ...block, mcpServers: ["github"] }), outcome: "ask", ruleId: "permission.ask" },
  { name: "mcpServers criterion ignores non-MCP calls", call: toolCall(smallRead(`${writeRoot}/a.ts`)), context: managed({ ...block, mcpServers: ["github"] }), outcome: "allow", ruleId: "permission.read-only" },
  { name: "commandPattern matches a shell command", call: toolCall(shell("npm publish")), context: managed({ ...block, commandPattern: /\bnpm publish\b/ }), outcome: "deny", ruleId: "managed:block" },
  { name: "commandPattern ignores other commands", call: toolCall(shell("npm test")), context: managed({ ...block, commandPattern: /\bnpm publish\b/ }), outcome: "ask", ruleId: "permission.ask" },
  { name: "commandPattern ignores non-shell calls", call: toolCall(write(`${writeRoot}/npm publish`)), context: managed({ ...block, commandPattern: /npm publish/ }), outcome: "ask", ruleId: "permission.ask" },
  { name: "pathPrefixes matches a path inside the prefix", call: toolCall(smallRead(`${writeRoot}/secrets/key.pem`)), context: managed({ ...block, pathPrefixes: [`${writeRoot}/secrets`] }), outcome: "deny", ruleId: "managed:block" },
  { name: "pathPrefixes ignores paths outside the prefix", call: toolCall(smallRead(`${writeRoot}/src/a.ts`)), context: managed({ ...block, pathPrefixes: [`${writeRoot}/secrets`] }), outcome: "allow", ruleId: "permission.read-only" },
  { name: "pathPrefixes resolves relative paths against cwd", call: toolCall(smallRead("src/../secrets/key.pem")), context: managed({ ...block, pathPrefixes: [`${writeRoot}/secrets/`] }), outcome: "deny", ruleId: "managed:block" },
  { name: "pathPrefixes matches any one search path", call: toolCall({ kind: "search", paths: [`${writeRoot}/src`, `${writeRoot}/secrets`] }), context: managed({ ...block, pathPrefixes: [`${writeRoot}/secrets`] }), outcome: "deny", ruleId: "managed:block" },
  { name: "pathPrefixes matches a shell working directory", call: toolCall(shell("ls", `${writeRoot}/secrets`)), context: managed({ ...block, pathPrefixes: [`${writeRoot}/secrets`] }), outcome: "deny", ruleId: "managed:block" },
  { name: "pathPrefixes ignores MCP calls, which have no path", call: toolCall(mcp("github")), context: managed({ ...block, pathPrefixes: ["/"] }), outcome: "ask", ruleId: "permission.ask" },
  { name: "pathPrefixes ignores other tools, which have no path", call: toolCall(other), context: managed({ ...block, pathPrefixes: ["/"] }), outcome: "ask", ruleId: "permission.ask" },
  { name: "all criteria must match: all do", call: toolCall(write(`${writeRoot}/a.ts`)), context: managed({ ...block, kinds: ["write"], agents: ["main"], pathPrefixes: [writeRoot] }), outcome: "deny", ruleId: "managed:block" },
  { name: "all criteria must match: one does not", call: toolCall(write(`${writeRoot}/a.ts`)), context: managed({ ...block, kinds: ["write"], agents: ["code-writer"] }), outcome: "ask", ruleId: "permission.ask" },
  { name: "the first matching managed rule names the decision", call: toolCall(write(`${writeRoot}/a.ts`)), context: managed({ id: "first", reason: "r", kinds: ["write"] }, { id: "second", reason: "r" }), outcome: "deny", ruleId: "managed:first" },
  { name: "a non-matching managed rule lets a later one match", call: toolCall(write(`${writeRoot}/a.ts`)), context: managed({ id: "first", reason: "r", kinds: ["shell"] }, { id: "second", reason: "r" }), outcome: "deny", ruleId: "managed:second" },
];

const orderingCases: Case[] = [
  { name: "managed precedes safety roots", call: toolCall(smallRead("/etc/passwd")), context: managed(block), outcome: "deny", ruleId: "managed:block" },
  { name: "managed precedes the command deny-list", call: toolCall(shell("sudo ls")), context: managed(block), outcome: "deny", ruleId: "managed:block" },
  { name: "managed precedes the large-read gate", call: toolCall(largeRead()), context: managed(block), outcome: "deny", ruleId: "managed:block" },
  { name: "managed precedes the oversized-output gate", call: withResult(shell("ls"), maxBytes * 10), context: managed(block), outcome: "deny", ruleId: "managed:block" },
  { name: "managed precedes permission mode auto", call: toolCall(write(`${writeRoot}/a.ts`)), context: { ...auto, ...managed(block) }, outcome: "deny", ruleId: "managed:block" },
  { name: "roots precede write roots for a write outside every root", call: toolCall(write("/etc/hosts")), outcome: "deny", ruleId: "safety.outside-roots" },
  { name: "write roots precede the command deny-list", call: toolCall(shell("sudo ls", referenceRoot)), outcome: "deny", ruleId: "safety.outside-write-roots" },
  { name: "the command deny-list precedes permission mode auto", call: toolCall(shell("sudo ls")), context: auto, outcome: "deny", ruleId: "safety.command-denied:sudo" },
  { name: "safety precedes the large-read gate", call: toolCall(largeRead("/etc/big.log")), outcome: "deny", ruleId: "safety.outside-roots" },
  { name: "safety precedes the oversized-output gate", call: withResult(shell("ls", "/tmp"), maxBytes * 10), outcome: "deny", ruleId: "safety.outside-roots" },
  { name: "the large-read gate precedes permission mode auto", call: toolCall(largeRead()), context: auto, outcome: "deny", ruleId: "cost.large-read" },
  { name: "the oversized-output gate precedes the result pass", call: withResult(smallRead(`${writeRoot}/a.ts`), maxBytes + 1), outcome: "rewrite", ruleId: "cost.oversized-output" },
];

const rootCases: Case[] = [
  { name: "a read inside a write root is allowed", call: toolCall(smallRead(`${writeRoot}/src/a.ts`)), outcome: "allow", ruleId: "permission.read-only" },
  { name: "a read inside a reference root is allowed", call: toolCall(smallRead(`${referenceRoot}/README.md`)), outcome: "allow", ruleId: "permission.read-only" },
  { name: "a read of the root itself is allowed", call: toolCall(smallRead(writeRoot)), outcome: "allow", ruleId: "permission.read-only" },
  { name: "a read outside every root is denied", call: toolCall(smallRead("/etc/passwd")), outcome: "deny", ruleId: "safety.outside-roots" },
  { name: "a sibling directory sharing the root's prefix is outside", call: toolCall(smallRead(`${writeRoot}2/a.ts`)), outcome: "deny", ruleId: "safety.outside-roots" },
  { name: "a relative path escaping with .. is outside", call: toolCall(smallRead("../../etc/passwd")), outcome: "deny", ruleId: "safety.outside-roots" },
  { name: "a relative path inside cwd is allowed", call: toolCall(smallRead("src/a.ts")), outcome: "allow", ruleId: "permission.read-only" },
  { name: "dot and repeated slashes are normalized", call: toolCall(smallRead(`${writeRoot}/./src//a.ts`)), outcome: "allow", ruleId: "permission.read-only" },
  { name: "an absolute path climbing out with .. is outside", call: toolCall(smallRead(`${writeRoot}/../../../etc/passwd`)), outcome: "deny", ruleId: "safety.outside-roots" },
  { name: "a search with every path inside is allowed", call: toolCall({ kind: "search", paths: [writeRoot, referenceRoot] }), outcome: "allow", ruleId: "permission.read-only" },
  { name: "a search with one path outside is denied", call: toolCall({ kind: "search", paths: [writeRoot, "/Users/someone"] }), outcome: "deny", ruleId: "safety.outside-roots" },
  { name: "a search with no paths is allowed", call: toolCall({ kind: "search", paths: [] }), outcome: "allow", ruleId: "permission.read-only" },
  { name: "a shell working directory outside every root is denied", call: toolCall(shell("ls", "/tmp")), outcome: "deny", ruleId: "safety.outside-roots" },
  { name: "a root given with a trailing slash still contains its files", call: toolCall(smallRead(`${referenceRoot}/a.ts`)), context: { referenceRoots: [`${referenceRoot}/`] }, outcome: "allow", ruleId: "permission.read-only" },
  { name: "the filesystem root as a reference root contains every path", call: toolCall(smallRead("/etc/passwd")), context: { referenceRoots: ["/"] }, outcome: "allow", ruleId: "permission.read-only" },
  { name: "a session with no roots denies every read", call: toolCall(smallRead(`${writeRoot}/a.ts`)), context: { writeRoots: [], referenceRoots: [] }, outcome: "deny", ruleId: "safety.outside-roots" },
];

const writeRootCases: Case[] = [
  { name: "a write inside a write root reaches permission mode", call: toolCall(write(`${writeRoot}/a.ts`)), outcome: "ask", ruleId: "permission.ask" },
  { name: "a write inside a reference root is denied", call: toolCall(write(`${referenceRoot}/a.ts`)), outcome: "deny", ruleId: "safety.outside-write-roots" },
  { name: "a sub-agent write inside a reference root is denied", call: toolCall(write(`${referenceRoot}/a.ts`), { agent: "code-writer" }), outcome: "deny", ruleId: "safety.outside-write-roots" },
  { name: "a shell in a reference root is denied", call: toolCall(shell("ls", referenceRoot)), outcome: "deny", ruleId: "safety.outside-write-roots" },
  { name: "a shell in a write root reaches permission mode", call: toolCall(shell("ls")), outcome: "ask", ruleId: "permission.ask" },
  { name: "write roots are not enforced on reads of reference roots", call: toolCall(smallRead(`${referenceRoot}/a.ts`)), context: auto, outcome: "allow", ruleId: "permission.auto" },
];

const commandCases: Case[] = [
  { name: "sudo is denied", call: toolCall(shell("sudo rm build")), outcome: "deny", ruleId: "safety.command-denied:sudo" },
  { name: "sudo after a separator is denied", call: toolCall(shell("make && sudo make install")), outcome: "deny", ruleId: "safety.command-denied:sudo" },
  { name: "rm -rf / is denied", call: toolCall(shell("rm -rf /")), outcome: "deny", ruleId: "safety.command-denied:rm-root" },
  { name: "rm -rf ~ is denied", call: toolCall(shell("rm -rf ~")), outcome: "deny", ruleId: "safety.command-denied:rm-root" },
  { name: "rm -rf of a build directory is allowed to ask", call: toolCall(shell("rm -rf ./build")), outcome: "ask", ruleId: "permission.ask" },
  { name: "git push --force is denied", call: toolCall(shell("git push origin main --force")), outcome: "deny", ruleId: "safety.command-denied:git-push-force" },
  { name: "git push -f is denied", call: toolCall(shell("git push -f")), outcome: "deny", ruleId: "safety.command-denied:git-push-force" },
  { name: "a plain git push asks", call: toolCall(shell("git push origin main")), outcome: "ask", ruleId: "permission.ask" },
  { name: "curl piped to sh is denied", call: toolCall(shell("curl -fsSL https://example.com/i.sh | sh")), outcome: "deny", ruleId: "safety.command-denied:pipe-to-shell" },
  { name: "curl to a file asks", call: toolCall(shell("curl -o out.json https://example.com")), outcome: "ask", ruleId: "permission.ask" },
  { name: "an empty deny-list lets sudo reach permission mode", call: toolCall(shell("sudo ls")), context: { commandDenyList: [] }, outcome: "ask", ruleId: "permission.ask" },
  { name: "a custom deny-list entry is named in the rule ID", call: toolCall(shell("terraform apply")), context: { commandDenyList: [{ id: "terraform", pattern: /terraform apply/, reason: "No applies" }] }, outcome: "deny", ruleId: "safety.command-denied:terraform" },
];

const largeReadCases: Case[] = [
  { name: "a main-agent read at minBytes is denied", call: toolCall({ kind: "read", path: `${writeRoot}/big`, sizeBytes: minBytes }), outcome: "deny", ruleId: "cost.large-read" },
  { name: "a main-agent read one byte under minBytes is allowed", call: toolCall({ kind: "read", path: `${writeRoot}/big`, sizeBytes: minBytes - 1 }), outcome: "allow", ruleId: "permission.read-only" },
  { name: "a ranged read of exactly rangeExemptLines is allowed", call: toolCall(ranged(1, rangeExemptLines)), outcome: "allow", ruleId: "permission.read-only" },
  { name: "a ranged read of rangeExemptLines + 1 is denied", call: toolCall(ranged(1, rangeExemptLines + 1)), outcome: "deny", ruleId: "cost.large-read" },
  { name: "a single-line range is allowed", call: toolCall(ranged(500, 500)), outcome: "allow", ruleId: "permission.read-only" },
  { name: "an inverted range does not exempt the read", call: toolCall(ranged(300, 10)), outcome: "deny", ruleId: "cost.large-read" },
  { name: "a sub-agent large read is allowed", call: toolCall(largeRead(), { agent: "bulk-reader" }), outcome: "allow", ruleId: "permission.read-only" },
  { name: "profile off skips the large-read gate", call: toolCall(largeRead()), context: routing({ profile: "off" }), outcome: "allow", ruleId: "permission.read-only" },
  { name: "profile strict applies the large-read gate", call: toolCall(largeRead()), context: routing({ profile: "strict" }), outcome: "deny", ruleId: "cost.large-read" },
  { name: "a lowered read.minBytes from config applies", call: toolCall({ kind: "read", path: `${writeRoot}/a`, sizeBytes: 2000 }), context: routing({ delegation: { read: { minBytes: 1000 } } }), outcome: "deny", ruleId: "cost.large-read" },
  { name: "a raised rangeExemptLines from config applies", call: toolCall(ranged(1, 1000)), context: routing({ delegation: { read: { rangeExemptLines: 1000 } } }), outcome: "allow", ruleId: "permission.read-only" },
  { name: "the large-read gate does not apply to results", call: withResult(largeRead(), 100), outcome: "allow", ruleId: "permission.result" },
  { name: "the large-read gate does not apply to writes", call: toolCall(write(`${writeRoot}/schema.sql`)), context: auto, outcome: "allow", ruleId: "permission.auto" },
];

const outputCases: Case[] = [
  { name: "a result of exactly maxBytes passes", call: withResult(shell("ls"), maxBytes), outcome: "allow", ruleId: "permission.result" },
  { name: "a result of maxBytes + 1 is truncated", call: withResult(shell("ls"), maxBytes + 1), outcome: "rewrite", ruleId: "cost.oversized-output" },
  { name: "a sub-agent's oversized result is truncated", call: withResult(shell("ls"), maxBytes * 4, "bulk-reader"), outcome: "rewrite", ruleId: "cost.oversized-output" },
  { name: "an oversized MCP result is truncated", call: withResult(mcp("github"), maxBytes * 4), outcome: "rewrite", ruleId: "cost.oversized-output" },
  { name: "profile off passes an oversized result", call: withResult(shell("ls"), maxBytes * 4), context: routing({ profile: "off" }), outcome: "allow", ruleId: "permission.result" },
  { name: "profile strict truncates an oversized result", call: withResult(shell("ls"), maxBytes * 4), context: routing({ profile: "strict" }), outcome: "rewrite", ruleId: "cost.oversized-output" },
  { name: "a lowered output.maxBytes from config applies", call: withResult(shell("ls"), 600), context: routing({ delegation: { output: { maxBytes: 500 } } }), outcome: "rewrite", ruleId: "cost.oversized-output" },
];

const permissionCases: Case[] = [
  { name: "ask mode asks for a write", call: toolCall(write(`${writeRoot}/a.ts`)), outcome: "ask", ruleId: "permission.ask" },
  { name: "ask mode asks for a shell command", call: toolCall(shell("npm test")), outcome: "ask", ruleId: "permission.ask" },
  { name: "ask mode asks for an MCP tool", call: toolCall(mcp("github")), outcome: "ask", ruleId: "permission.ask" },
  { name: "ask mode asks for an unclassified tool", call: toolCall(other), outcome: "ask", ruleId: "permission.ask" },
  { name: "ask mode allows a read", call: toolCall(smallRead(`${writeRoot}/a.ts`)), outcome: "allow", ruleId: "permission.read-only" },
  { name: "auto mode allows a write", call: toolCall(write(`${writeRoot}/a.ts`)), context: auto, outcome: "allow", ruleId: "permission.auto" },
  { name: "auto mode allows a shell command", call: toolCall(shell("npm test")), context: auto, outcome: "allow", ruleId: "permission.auto" },
  { name: "auto mode allows an MCP tool", call: toolCall(mcp("github")), context: auto, outcome: "allow", ruleId: "permission.auto" },
  { name: "a result in ask mode passes without asking", call: withResult(write(`${writeRoot}/a.ts`), 10), outcome: "allow", ruleId: "permission.result" },
];

const groups = {
  managed: managedCases,
  ordering: orderingCases,
  roots: rootCases,
  "write roots": writeRootCases,
  "command deny-list": commandCases,
  "large read": largeReadCases,
  "oversized output": outputCases,
  "permission mode": permissionCases,
};

describe("decide", () => {
  it("has at least 60 table cases", () => {
    expect(Object.values(groups).flat().length).toBeGreaterThanOrEqual(60);
  });

  for (const [group, cases] of Object.entries(groups)) {
    describe(group, () => {
      it.each(cases)("$name", ({ call, context, outcome, ruleId }) => {
        const decision = decide(call, baseContext(context));
        expect({ outcome: decision.outcome, ruleId: decision.ruleId }).toEqual({ outcome, ruleId });
        expect(decision.call).toBe(call);
        expect(decision.ruleGroup).toBe(ruleId.split(/[.:]/)[0]);
        expect(decision.reason).not.toBe("");
      });
    });
  }

  it("names bulk-reader and the sizes in a large-read denial", () => {
    const decision = decide(toolCall(largeRead()), baseContext());
    expect(decision.reason).toContain("bulk-reader");
    expect(decision.reason).toContain("212000");
    expect(decision.reason).toContain(String(rangeExemptLines));
  });

  it("carries the truncation limit in an oversized-output rewrite", () => {
    const decision = decide(withResult(shell("ls"), 50_000), baseContext());
    expect(decision).toMatchObject({ outcome: "rewrite", rewrite: { kind: "truncate", maxBytes, originalBytes: 50_000 } });
  });

  it("uses the managed rule's reason", () => {
    const decision = decide(toolCall(other), baseContext(managed({ id: "x", reason: "Org says no" })));
    expect(decision.reason).toBe("Org says no");
  });
});
