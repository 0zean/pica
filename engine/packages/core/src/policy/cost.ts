import { isInsideAny, joinPath, realPath } from "./paths.ts";
import { isExcludedRead } from "./read-exclusions.ts";
import { shellPaths } from "./shell-paths.ts";
import { mainAgent, type LineRange, type Rule } from "./types.ts";

export const largeReadRule: Rule = (call, context) => {
  const { target } = call;
  const { profile, delegation } = context.config.routing;
  if (profile === "off" || call.result !== undefined || call.agent !== mainAgent || target.kind !== "read") {
    return undefined;
  }
  const { minBytes, rangeExemptLines } = delegation.read;
  if (
    target.sizeBytes < minBytes ||
    (target.force !== true && isExemptRange(target.range, rangeExemptLines)) ||
    isExcludedRead(target.path, context)
  ) {
    return undefined;
  }
  return {
    outcome: "deny",
    ruleId: "cost.large-read",
    ruleGroup: "cost",
    reason:
      `${target.path} is ${String(target.sizeBytes)} bytes (limit ${String(minBytes)}). ` +
      `Delegate the question to bulk-reader, or read a range of at most ${String(rangeExemptLines)} lines.`,
    call,
  };
};

// Writes are routed to code-writer by taking write tools from the main agent (PLAN.md §5.4), so a
// main-agent shell command must not write files into the write roots either. Only the targets the
// shell parser can see count: redirections, `tee`, `touch`, and `cp`/`mv`/`install` destinations.
// An interpreter or script that writes (`python -c`, `node -e`, `sed -i`) is not classified and
// passes to the later rules. A target the parser cannot resolve is left to `shellScopeRule`.
export const shellWriteRule: Rule = (call, context) => {
  const { target } = call;
  const { profile } = context.config.routing;
  if (profile === "off" || call.result !== undefined || call.agent !== mainAgent || target.kind !== "shell") {
    return undefined;
  }
  const writeRoots = context.writeRoots.map((root) => realPath(root, context));
  const written = shellPaths(target.command, joinPath(context.cwd, target.cwd)).find(
    (entry) => entry.role === "write target" && entry.path !== undefined && isInsideAny(realPath(entry.path, context), writeRoots),
  );
  if (written === undefined) {
    return undefined;
  }
  return {
    outcome: "deny",
    ruleId: "cost.shell-write",
    ruleGroup: "cost",
    reason:
      `This command writes ${written.raw}, and the ${profile} profile routes file writes to sub-agents. ` +
      "Ask code-writer to write it from a precise spec.",
    call,
  };
};

export const oversizedOutputRule: Rule = (call, context) => {
  const { result } = call;
  const { profile, delegation } = context.config.routing;
  if (profile === "off" || result === undefined) {
    return undefined;
  }
  const { maxBytes } = delegation.output;
  if (result.bytes <= maxBytes) {
    return undefined;
  }
  return {
    outcome: "rewrite",
    ruleId: "cost.oversized-output",
    ruleGroup: "cost",
    reason: `Result is ${String(result.bytes)} bytes (limit ${String(maxBytes)}); truncated, full output spilled`,
    rewrite: { kind: "truncate", maxBytes, originalBytes: result.bytes },
    call,
  };
};

function isExemptRange(range: LineRange | undefined, rangeExemptLines: number): boolean {
  if (range === undefined || range.endLine < range.startLine) {
    return false;
  }
  return range.endLine - range.startLine + 1 <= rangeExemptLines;
}
