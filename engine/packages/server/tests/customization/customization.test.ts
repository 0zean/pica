import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MarkdownAgentLoader, ManagedPolicyLoader, builtinAgentsDir, userAgentsDir, workspaceAgentsDir } from "@pica/adapters";
import type { ManagedPolicyFileSystem } from "@pica/adapters";
import { FakeRuntime, scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { composeEngine, silentLogger, startEngine } from "../../src/index.ts";
import { TestClient } from "../helpers.ts";

// X-02: the production composition answers `customization.*` over the user's, a workspace's and a
// repo's files, and writes only what the C-02 loader (or the skill rules) accept.

interface Item {
  kind: string;
  name: string;
  locationId: string;
  layer: string;
  path: string;
  status: string;
  overriddenBy: string | null;
  problems: { field: string; message: string }[];
  writable: boolean;
  lockedBy?: string;
}

interface Location {
  id: string;
  layer: string;
  label: string;
  path: string;
  writable: boolean;
  lockedBy?: string;
}

interface Started {
  readonly client: TestClient;
  readonly home: string;
  readonly workspaceId: string;
  readonly repoId: string;
  readonly root: string;
}

const policyPath = "/Library/Application Support/Pica/policy.jsonc";
const uiAgentFixture = fileURLToPath(new URL("../../../../../fixtures/customization/ui-agent.md", import.meta.url));

let stop: (() => Promise<void>) | undefined;

afterEach(async () => {
  await stop?.();
  stop = undefined;
});

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function agentText(description: string, tools = "[view, grep]", tier = "worker"): string {
  return `---\ndescription: ${description}\ntier: ${tier}\ntools: ${tools}\n---\n\nAnswer the question.\n`;
}

function policyFiles(text: string): ManagedPolicyFileSystem {
  return {
    realpath: (path) => {
      if (path === policyPath) return path;
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    ownership: () => ({ uid: 0, mode: 0o644 }),
    readText: () => text,
    readPlist: () => ({}),
  };
}

async function start(policy?: string): Promise<Started> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "picad-x02-")));
  const root = join(home, "atlas");
  mkdirSync(root);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", "https://git.example.com/acme/atlas.git"], { cwd: root, stdio: "ignore" });
  const scenario = scenarioSchema.parse({ version: 1, models: [{ id: "model-a", name: "Model A" }], defaultModel: "model-a", turns: [] });
  const composed = composeEngine({
    homeDir: home,
    userName: "tester",
    env: {},
    log: silentLogger,
    runtime: new FakeRuntime({ scenario, clock: steppingClock("2026-11-21T10:00:00.000Z"), ids: sequentialIds() }),
    managedPolicy:
      policy === undefined
        ? new ManagedPolicyLoader([])
        : new ManagedPolicyLoader([{ format: "jsonc", path: policyPath }], policyFiles(policy)),
  });
  const listener = await startEngine({ socketPath: join(home, "s"), log: silentLogger, ...composed.options });
  const client = await TestClient.connectAndHello(listener.socketPath);
  stop = async () => {
    client.close();
    await listener.close();
    await composed.close();
    rmSync(home, { recursive: true, force: true });
  };
  const { workspace } = (await result(client, "workspace.create", { name: "Acme" })) as { workspace: { id: string } };
  const { repo } = (await result(client, "repo.addPath", { path: root })) as { repo: { id: string } };
  await result(client, "workspace.pinRepo", { workspaceId: workspace.id, repoId: repo.id });
  return { client, home, workspaceId: workspace.id, repoId: repo.id, root };
}

async function result(client: TestClient, method: string, params: unknown = {}): Promise<Record<string, unknown>> {
  const response = await client.request(method, params);
  if (!("result" in response)) throw new Error(`${method} failed: ${JSON.stringify(response)}`);
  return response["result"] as Record<string, unknown>;
}

async function failure(client: TestClient, method: string, params: unknown): Promise<{ code: string; message: string; details: Record<string, unknown> }> {
  const response = await client.request(method, params);
  if (!("error" in response)) throw new Error(`${method} succeeded: ${JSON.stringify(response)}`);
  const error = response["error"] as { message: string; data: { code: string; details: Record<string, unknown> } };
  return { code: error.data.code, message: error.message, details: error.data.details };
}

async function list(client: TestClient, params: Record<string, unknown>): Promise<{ items: Item[]; locations: Location[] }> {
  return (await result(client, "customization.list", params)) as { items: Item[]; locations: Location[] };
}

describe("X-02 agents", () => {
  it("writes an agent created from the UI as a file the C-02 loader accepts", async () => {
    const { client, home } = await start();
    const text = readFileSync(uiAgentFixture, "utf8");
    const { item } = (await result(client, "customization.create", { kind: "agent", locationId: "user", name: "changelog-checker", text })) as { item: Item };

    expect(item).toMatchObject({ name: "changelog-checker", layer: "user", status: "active", problems: [] });
    expect(item.path).toBe(join(userAgentsDir(home), "changelog-checker.md"));
    const loaded = new MarkdownAgentLoader([
      { layer: "builtin", dir: builtinAgentsDir },
      { layer: "user", dir: userAgentsDir(home) },
    ]).load();
    if (!loaded.ok) throw new Error(loaded.error.message);
    expect(loaded.value.find((agent) => agent.name === "changelog-checker")).toEqual({
      name: "changelog-checker",
      description: 'Checks changelog entries: one per merged "pull request"',
      tier: "worker",
      tools: ["glob", "grep", "view"],
      prompt: "You check that every merged pull request has a changelog entry.\n\nAnswer with the pull requests that have none.",
      sourceLayer: "user",
      sourcePath: item.path,
    });
  });

  it("refuses an agent the C-02 loader would refuse, naming the field, and writes nothing", async () => {
    const { client, home } = await start();
    const refused = await failure(client, "customization.create", {
      kind: "agent",
      locationId: "user",
      name: "broken",
      text: agentText("Broken", "[view, teleport]", "genius"),
    });

    expect(refused.code).toBe("config_invalid");
    expect(refused.details["problems"]).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "tier" }), expect.objectContaining({ field: "tools[1]" })]),
    );
    expect(existsSync(join(userAgentsDir(home), "broken.md"))).toBe(false);
  });

  it("shows each agent's layer and which one wins, as C-02's precedence decides", async () => {
    const { client, home, workspaceId, repoId, root } = await start();
    write(join(userAgentsDir(home), "bulk-reader.md"), agentText("User's reader"));
    write(join(userAgentsDir(home), "reviewer.md"), agentText("User's reviewer"));
    write(join(workspaceAgentsDir(home, workspaceId), "reviewer.md"), agentText("Workspace reviewer"));
    write(join(root, ".github", "agents", "reviewer.agent.md"), agentText("GitHub reviewer", "read, search"));
    write(join(root, ".pica", "agents", "reviewer.md"), agentText("Pica repo reviewer"));
    write(join(root, ".github", "agents", "scout.agent.md"), agentText("Only in .github"));

    const { items, locations } = await list(client, { kind: "agent", workspaceId, repoId });

    expect(locations.map((location) => [location.layer, location.label])).toEqual([
      ["builtin", "Built-in agents"],
      ["user", "Your agents"],
      ["workspace", "Workspace agents"],
      ["repo", ".github/agents"],
      ["repo", ".pica/agents"],
    ]);
    const reviewers = items.filter((item) => item.name === "reviewer");
    expect(reviewers.map((item) => [item.locationId.replace(repoId, "R"), item.status])).toEqual([
      ["repo:R:pica-agents", "active"],
      ["repo:R:github-agents", "overridden"],
      ["workspace", "overridden"],
      ["user", "overridden"],
    ]);
    expect(reviewers.slice(1).every((item) => item.overriddenBy === join(root, ".pica", "agents", "reviewer.md"))).toBe(true);
    const readers = items.filter((item) => item.name === "bulk-reader");
    expect(readers.map((item) => [item.layer, item.status, item.writable])).toEqual([
      ["user", "active", true],
      ["builtin", "overridden", false],
    ]);
    expect(items.find((item) => item.name === "scout")).toMatchObject({ layer: "repo", status: "active" });

    // The winners are exactly the agents C-02's loader resolves for the same layers.
    const loaded = new MarkdownAgentLoader([
      { layer: "builtin", dir: builtinAgentsDir },
      { layer: "user", dir: userAgentsDir(home) },
      { layer: "workspace", dir: workspaceAgentsDir(home, workspaceId) },
      { layer: "github_agents", dir: join(root, ".github", "agents") },
      { layer: "repo", dir: join(root, ".pica", "agents") },
    ]).load();
    if (!loaded.ok) throw new Error(loaded.error.message);
    const winners = items.filter((item) => item.status === "active").map((item) => [item.name, item.path]);
    expect(winners).toEqual(loaded.value.map((agent) => [agent.name, agent.sourcePath ?? join(builtinAgentsDir, `${agent.name}.md`)]));
  });

  it("lists an invalid file with its problems instead of failing the listing", async () => {
    const { client, home } = await start();
    write(join(userAgentsDir(home), "half.md"), "---\ndescription: Half\n---\n\nPrompt.\n");

    const { items } = await list(client, { kind: "agent" });

    expect(items.find((item) => item.name === "half")).toMatchObject({
      status: "invalid",
      problems: [expect.objectContaining({ field: "tools" })],
    });
  });

  it("saves and deletes a listed agent, and refuses a built-in one", async () => {
    const { client, home } = await start();
    const path = join(userAgentsDir(home), "helper.md");
    write(path, agentText("Helper"));

    const { item } = (await result(client, "customization.save", { kind: "agent", path, text: agentText("Better helper") })) as { item: Item };
    expect(item).toMatchObject({ status: "active" });
    expect(readFileSync(path, "utf8")).toContain("Better helper");

    const builtin = join(builtinAgentsDir, "bulk-reader.md");
    expect((await failure(client, "customization.save", { kind: "agent", path: builtin, text: agentText("Mine") })).code).toBe("invalid_params");
    expect((await failure(client, "customization.save", { kind: "agent", path: "/etc/hosts", text: agentText("Mine") })).code).toBe("not_found");

    await result(client, "customization.delete", { kind: "agent", path });
    expect(existsSync(path)).toBe(false);
  });

  it("refuses a name another file in the location already has", async () => {
    const { client, workspaceId, repoId, root } = await start();
    write(join(root, ".github", "agents", "helper.md"), agentText("Helper"));

    const refused = await failure(client, "customization.create", {
      kind: "agent",
      locationId: `repo:${repoId}:github-agents`,
      name: "helper",
      text: agentText("Another"),
      workspaceId,
      repoId,
    });
    expect(refused.code).toBe("already_exists");
  });
});

describe("X-02 skills and instructions", () => {
  it("creates a skill folder in the repo and shows that it overrides the user's skill", async () => {
    const { client, home, workspaceId, repoId, root } = await start();
    write(join(home, ".copilot", "skills", "release", "SKILL.md"), "---\nname: release\ndescription: User's release steps\n---\n\nSteps.\n");

    const created = (await result(client, "customization.create", {
      kind: "skill",
      locationId: `repo:${repoId}:github-skills`,
      name: "release",
      text: "---\nname: release\ndescription: The repo's release steps\n---\n\nRun the release script.\n",
      workspaceId,
      repoId,
    })) as { item: Item };

    expect(created.item.path).toBe(join(root, ".github", "skills", "release", "SKILL.md"));
    const { items } = await list(client, { kind: "skill", workspaceId, repoId });
    expect(items.map((item) => [item.layer, item.status])).toEqual([
      ["repo", "active"],
      ["user", "overridden"],
    ]);

    const misnamed = await failure(client, "customization.create", {
      kind: "skill",
      locationId: "user",
      name: "deploy",
      text: "---\nname: ship\ndescription: Ships\n---\n\nShip.\n",
    });
    expect(misnamed.details["problems"]).toEqual([expect.objectContaining({ field: "name" })]);

    await result(client, "customization.delete", { kind: "skill", path: created.item.path, workspaceId, repoId });
    expect(existsSync(join(root, ".github", "skills", "release"))).toBe(false);
  });

  it("lists every instructions file as applying, and creates a single-file location without a name", async () => {
    const { client, home, workspaceId, repoId, root } = await start();
    write(join(root, "AGENTS.md"), "# Atlas\n\nUse pnpm.\n");
    write(join(root, ".github", "instructions", "swift.instructions.md"), "---\napplyTo: \"**/*.swift\"\n---\n\nSwift 6.\n");

    await result(client, "customization.create", { kind: "instructions", locationId: "user", text: "Answer briefly.\n", workspaceId, repoId });

    expect(readFileSync(join(home, ".copilot", "copilot-instructions.md"), "utf8")).toBe("Answer briefly.\n");
    const { items } = await list(client, { kind: "instructions", workspaceId, repoId });
    expect(items.map((item) => [item.name, item.status])).toEqual([
      ["~/.copilot/copilot-instructions.md", "active"],
      ["AGENTS.md", "active"],
      ["swift", "active"],
    ]);
  });
});

describe("X-02 managed policy", () => {
  it("locks a kind in every layer and names the policy", async () => {
    const { client, home } = await start('{ "id": "acme", "customization": { "locked": ["agent"] } }');
    write(join(userAgentsDir(home), "helper.md"), agentText("Helper"));

    const { items, locations } = await list(client, { kind: "agent" });
    expect(locations.find((location) => location.id === "user")).toMatchObject({ writable: true, lockedBy: "acme" });
    expect(locations.find((location) => location.id === "builtin")?.lockedBy).toBeUndefined();
    expect(items.find((item) => item.name === "helper")?.lockedBy).toBe("acme");

    const refused = await failure(client, "customization.create", { kind: "agent", locationId: "user", name: "other", text: agentText("Other") });
    expect(refused).toMatchObject({ code: "policy_denied", details: { policy: "acme" } });
    expect(refused.message).toContain("acme");
    expect((await failure(client, "customization.delete", { kind: "agent", path: join(userAgentsDir(home), "helper.md") })).code).toBe("policy_denied");

    const skills = await list(client, { kind: "skill" });
    expect(skills.locations.every((location) => location.lockedBy === undefined)).toBe(true);
  });
});
