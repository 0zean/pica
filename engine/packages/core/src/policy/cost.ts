import { isExcludedRead } from "./read-exclusions.ts";
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
    isExemptRange(target.range, rangeExemptLines) ||
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
