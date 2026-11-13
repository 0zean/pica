import type { SwiftType } from "./model.ts";

export const conformances = "Codable, Hashable, Sendable";

export function indent(lines: readonly string[], levels = 1): string[] {
  const prefix = "    ".repeat(levels);
  return lines.map((line) => (line.length === 0 ? line : `${prefix}${line}`));
}

// Joins blocks with one blank line between them.
export function joinBlocks(blocks: readonly (readonly string[])[]): string[] {
  return blocks.filter((block) => block.length > 0).flatMap((block, index) => (index === 0 ? [...block] : ["", ...block]));
}

export function renderType(type: SwiftType): string {
  switch (type.kind) {
    case "named":
      return type.name;
    case "array":
      return `[${renderType(type.items)}]`;
    case "dictionary":
      return `[String: ${renderType(type.values)}]`;
    case "optional":
      return `${renderType(type.wrapped)}?`;
  }
}
