import { describe, expect, it } from "vitest";
import { customizationLocations, describeFile, ok, resolveCustomizations } from "@pica/core";
import type { FrontmatterParser, LocationSpec } from "@pica/core";

// X-02: which file wins, by the same rules as C-02, without touching the file system.

const roots = {
  builtinAgents: "/builtin",
  userAgents: "/home/agents",
  userSkills: "/home/skills",
  userInstructions: "/home/instructions.md",
  workspace: { id: "w1", agentsDir: "/data/w1/agents" },
  repo: { id: "r1", root: "/repo" },
};

// A stand-in for the YAML parser: `key: value` lines and an inline `[a, b]` list.
const parse: FrontmatterParser = (_path, text) => {
  const [, head = "", body = ""] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text) ?? [];
  const fields = Object.fromEntries(
    head.split("\n").map((line) => {
      const [key = "", value = ""] = line.split(": ");
      return [key, value.startsWith("[") ? value.slice(1, -1).split(", ") : value];
    }),
  );
  return ok({ frontmatter: fields, body });
};

const agent = "---\ndescription: An agent\ntools: [view]\n---\nPrompt.\n";

function at(kind: "agent" | "skill" | "instructions", id: string): LocationSpec {
  const spec = customizationLocations(kind, roots, undefined).find((entry) => entry.id === id);
  if (spec === undefined) throw new Error(`no location ${id}`);
  return spec;
}

describe("X-02 resolveCustomizations", () => {
  it("lets the highest location win and points the others at it", () => {
    const items = resolveCustomizations([
      describeFile(at("agent", "user"), "/home/agents/a.md", agent, parse),
      describeFile(at("agent", "workspace"), "/data/w1/agents/a.md", agent, parse),
      describeFile(at("agent", "repo:r1:github-agents"), "/repo/.github/agents/a.agent.md", agent, parse),
    ]);
    expect(items.map((item) => [item.path, item.status, item.overriddenBy])).toEqual([
      ["/repo/.github/agents/a.agent.md", "active", null],
      ["/data/w1/agents/a.md", "overridden", "/repo/.github/agents/a.agent.md"],
      ["/home/agents/a.md", "overridden", "/repo/.github/agents/a.agent.md"],
    ]);
  });

  it("does not let an invalid file win, and marks a second file of one name in a location invalid", () => {
    const items = resolveCustomizations([
      describeFile(at("agent", "user"), "/home/agents/a.agent.md", agent, parse),
      describeFile(at("agent", "user"), "/home/agents/a.md", agent, parse),
      describeFile(at("agent", "workspace"), "/data/w1/agents/a.md", "---\ndescription: No tools\n---\nPrompt.\n", parse),
    ]);
    expect(items.map((item) => [item.path, item.status])).toEqual([
      ["/data/w1/agents/a.md", "invalid"],
      ["/home/agents/a.md", "invalid"],
      ["/home/agents/a.agent.md", "active"],
    ]);
  });

  it("lets every instructions file apply", () => {
    const items = resolveCustomizations([
      describeFile(at("instructions", "user"), "/home/instructions.md", "Be brief.\n", parse),
      describeFile(at("instructions", "repo:r1:agents-md"), "/repo/AGENTS.md", "Use pnpm.\n", parse),
    ]);
    expect(items.every((item) => item.status === "active")).toBe(true);
  });

  it("puts `.github/skills` over `.claude/skills` in one repo", () => {
    const skill = "---\ndescription: Ships\n---\nShip.\n";
    const items = resolveCustomizations([
      describeFile(at("skill", "repo:r1:claude-skills"), "/repo/.claude/skills/ship/SKILL.md", skill, parse),
      describeFile(at("skill", "repo:r1:github-skills"), "/repo/.github/skills/ship/SKILL.md", skill, parse),
    ]);
    expect(items[0]).toMatchObject({ path: "/repo/.github/skills/ship/SKILL.md", status: "active" });
  });

  it("lists a repo with no checkout without its locations", () => {
    const specs = customizationLocations("agent", { ...roots, repo: { id: "r1", root: null } }, "acme");
    expect(specs.map((spec) => [spec.id, spec.lockedBy])).toEqual([
      ["builtin", undefined],
      ["user", "acme"],
      ["workspace", "acme"],
    ]);
  });
});
