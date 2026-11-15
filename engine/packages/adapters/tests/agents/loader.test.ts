import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MarkdownAgentLoader,
  builtinAgentsDir,
  githubAgentsDir,
  repoAgentsDir,
  userAgentsDir,
} from "@pica/adapters";
import type { AgentSource } from "@pica/adapters";
import { useTempDir, writeFile } from "../config/helpers.ts";

const tempDir = useTempDir();

function agentFile(description: string, tools = "[view]"): string {
  return `---\ndescription: ${description}\ntier: worker\ntools: ${tools}\n---\nPrompt: ${description}\n`;
}

function layers(home: string, repo: string, workspaceText?: string): AgentSource[] {
  return [
    { layer: "builtin", dir: builtinAgentsDir },
    { layer: "user", dir: userAgentsDir(home) },
    { layer: "workspace", files: workspaceText === undefined ? [] : [{ path: "workspace:ws1/bulk-reader.md", text: workspaceText }] },
    { layer: "github_agents", dir: githubAgentsDir(repo) },
    { layer: "repo", dir: repoAgentsDir(repo) },
  ];
}

function load(sources: readonly AgentSource[]) {
  const result = new MarkdownAgentLoader(sources).load();
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return new Map(result.value.map((agent) => [agent.name, agent]));
}

describe("MarkdownAgentLoader", () => {
  it("treats missing layer directories as absent", () => {
    const agents = load(layers(join(tempDir(), "home"), join(tempDir(), "repo")));
    expect([...agents.values()].map((agent) => agent.sourceLayer)).toEqual(["builtin", "builtin", "builtin"]);
  });

  it("lets each layer read from disk override the one below it", () => {
    const home = tempDir();
    const repo = tempDir();
    let workspaceText: string | undefined;
    const steps: [string, () => void][] = [
      ["user", () => writeFile(join(userAgentsDir(home), "bulk-reader.md"), agentFile("user"))],
      [
        "workspace",
        () => {
          workspaceText = agentFile("workspace");
        },
      ],
      ["github_agents", () => writeFile(join(githubAgentsDir(repo), "bulk-reader.agent.md"), agentFile("github"))],
      ["repo", () => writeFile(join(repoAgentsDir(repo), "bulk-reader.md"), agentFile("repo"))],
    ];
    expect(load(layers(home, repo)).get("bulk-reader")?.sourceLayer).toBe("builtin");
    for (const [layer, write] of steps) {
      write();
      const agent = load(layers(home, repo, workspaceText)).get("bulk-reader");
      expect(agent?.sourceLayer).toBe(layer);
    }
    expect(load(layers(home, repo, workspaceText)).get("bulk-reader")).toMatchObject({
      prompt: "Prompt: repo",
      sourcePath: join(repoAgentsDir(repo), "bulk-reader.md"),
    });
  });

  it("reads Copilot-style .github/agents files with aliases", () => {
    const repo = tempDir();
    writeFile(join(githubAgentsDir(repo), "docs.agent.md"), agentFile("docs", "'read, search'"));
    writeFile(join(githubAgentsDir(repo), "notes.txt"), "not an agent");
    const agent = load([{ layer: "github_agents", dir: githubAgentsDir(repo) }]).get("docs");
    expect(agent).toMatchObject({ tools: ["glob", "grep", "rg", "view"], sourceLayer: "github_agents" });
  });

  it("reports a YAML error with its file and line", () => {
    const repo = tempDir();
    const path = writeFile(join(repoAgentsDir(repo), "bad.md"), "---\ndescription: ok\ntools: [view\n---\nPrompt\n");
    const result = new MarkdownAgentLoader([{ layer: "repo", dir: repoAgentsDir(repo) }]).load();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("agents.parse_error");
      expect(result.error.issues[0]?.file).toMatch(new RegExp(`^${path}:\\d+$`));
    }
  });

  it("reports a file without frontmatter", () => {
    const repo = tempDir();
    writeFile(join(repoAgentsDir(repo), "plain.md"), "# Just markdown\n");
    const result = new MarkdownAgentLoader([{ layer: "repo", dir: repoAgentsDir(repo) }]).load();
    expect(result.ok ? undefined : result.error.message).toMatch(/plain\.md: \(file\): missing frontmatter/);
  });

  it("reports an invalid agent with the field named", () => {
    const home = tempDir();
    writeFile(join(userAgentsDir(home), "mine.md"), agentFile("mine", "[view, rm_rf]"));
    const result = new MarkdownAgentLoader([{ layer: "user", dir: userAgentsDir(home) }]).load();
    expect(result.ok ? undefined : result.error.message).toBe(
      `${join(userAgentsDir(home), "mine.md")}: tools[1]: unknown tool "rm_rf"`,
    );
  });

  it("reports a layer path that is not a directory", () => {
    const file = writeFile(join(tempDir(), "file"), "x");
    const result = new MarkdownAgentLoader([{ layer: "user", dir: file }]).load();
    expect(result.ok ? undefined : result.error.code).toBe("agents.read_failed");
  });
});
