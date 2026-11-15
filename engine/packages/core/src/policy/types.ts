import type { PicaConfig } from "@pica/protocol";

// The engine maps each runtime tool to one of these targets before asking the policy (C-04, C-06).
export type ToolTarget =
  // `force`: the read asked for the whole file past the runtime's own size limit (`forceReadLargeFiles`).
  | {
      readonly kind: "read";
      readonly path: string;
      readonly sizeBytes: number;
      readonly range?: LineRange;
      readonly force?: true;
    }
  | { readonly kind: "write"; readonly path: string }
  | { readonly kind: "search"; readonly paths: readonly string[] }
  | { readonly kind: "shell"; readonly command: string; readonly cwd: string }
  | {
      readonly kind: "mcp";
      readonly server: string;
      // The tool's name on its server, and whether it is read-class (docs/mcp-permissions.md).
      readonly tool?: string;
      readonly readOnly?: boolean;
    }
  | { readonly kind: "other" };

export type PolicyToolKind = ToolTarget["kind"];

export interface LineRange {
  readonly startLine: number;
  readonly endLine: number;
}

export const mainAgent = "main";

export interface ToolCall {
  readonly id: string;
  readonly tool: string;
  /** `main` for the main agent, otherwise the sub-agent's name. */
  readonly agent: string;
  readonly target: ToolTarget;
  /** Present when the call is decided in `onPostToolUse`, after the tool ran. */
  readonly result?: { readonly bytes: number };
}

export interface ManagedRule {
  readonly id: string;
  readonly reason: string;
  // Every criterion given must match; a rule with no criteria matches every call.
  readonly tools?: readonly string[];
  readonly kinds?: readonly PolicyToolKind[];
  readonly agents?: readonly string[];
  readonly pathPrefixes?: readonly string[];
  readonly mcpServers?: readonly string[];
  readonly commandPattern?: RegExp;
}

// The managed list of MCP servers a session may use; a server not on it cannot be attached or called.
export interface ManagedMcpAllowlist {
  readonly id: string;
  readonly servers: readonly ManagedMcpServer[];
}

// A given `url` or `command` pins the entry to that endpoint, so a renamed server does not pass.
export interface ManagedMcpServer {
  readonly id: string;
  readonly url?: string;
  readonly command?: string;
}

export interface CommandRule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly reason: string;
}

export interface PolicyConfig {
  readonly routing: Pick<PicaConfig["routing"], "profile" | "delegation">;
  readonly permissions: PicaConfig["permissions"];
}

export interface PolicyContext {
  /** Relative paths in a tool call resolve against this directory. */
  readonly cwd: string;
  readonly writeRoots: readonly string[];
  readonly referenceRoots: readonly string[];
  readonly config: PolicyConfig;
  readonly managed: readonly ManagedRule[];
  readonly managedMcpAllowlist?: ManagedMcpAllowlist;
  readonly commandDenyList: readonly CommandRule[];
  /** Symlink-free paths for the call's paths and roots, from the sandbox (R-07). Absent: lexical only. */
  readonly realPaths?: ReadonlyMap<string, string>;
}

export type RuleGroup = "managed" | "safety" | "cost" | "permission";

export type RuleId =
  | `managed:${string}`
  | "safety.outside-roots"
  | "safety.outside-write-roots"
  | `safety.command-denied:${string}`
  | "safety.shell-outside-write-roots"
  | "cost.large-read"
  | "cost.oversized-output"
  | `permission.mcp-tool:${string}`
  | "permission.mcp-read-only"
  | "permission.auto"
  | "permission.read-only"
  | "permission.ask"
  | "permission.result";

export interface TruncateRewrite {
  readonly kind: "truncate";
  readonly maxBytes: number;
  readonly originalBytes: number;
}

interface DecisionBase {
  readonly ruleId: RuleId;
  readonly ruleGroup: RuleGroup;
  readonly reason: string;
  readonly call: ToolCall;
}

export type PolicyDecision =
  | (DecisionBase & { readonly outcome: "allow" })
  | (DecisionBase & { readonly outcome: "deny" })
  | (DecisionBase & { readonly outcome: "ask" })
  | (DecisionBase & { readonly outcome: "rewrite"; readonly rewrite: TruncateRewrite });

export type PolicyOutcome = PolicyDecision["outcome"];

/** A rule returns a decision when it matches, or `undefined` to let the next rule decide. */
export type Rule = (call: ToolCall, context: PolicyContext) => PolicyDecision | undefined;
