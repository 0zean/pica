import type { McpServerDef, PicaMcpServerEntry } from "@pica/protocol";
import { describe, expect, it } from "vitest";
import {
  checkedMcpServerEntry,
  createMcpManager,
  createMcpSecretRedactor,
  ok,
  runtimeMcpOptions,
  withMcpServers,
} from "../../src/index.ts";
import type { McpAttachmentState, McpManagerDeps, McpSecretSource, SessionOptions, SessionState } from "../../src/index.ts";

const github: McpServerDef = {
  id: "github",
  name: "GitHub",
  scope: "global",
  toolAllowlist: null,
  transport: { type: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: { secretRef: "keychain:github/pat" } } },
};

const scripts: McpServerDef = {
  id: "scripts",
  name: "Scripts",
  scope: "global",
  toolAllowlist: ["run"],
  transport: { type: "stdio", command: "scripts-mcp", args: ["--token", "${secret:env:SCRIPTS_TOKEN}"], env: {}, cwd: "/tmp" },
};

function source(values: Record<string, string>): McpSecretSource {
  return { read: (reference) => Promise.resolve(ok(values[reference.name] ?? null)) };
}

function harness(sessionState: SessionState = "idle"): { deps: McpManagerDeps; state: () => McpAttachmentState; reopened: string[]; written: Map<string, PicaMcpServerEntry> } {
  let state: McpAttachmentState = { workspaces: {}, sessions: {} };
  const written = new Map<string, PicaMcpServerEntry>();
  const reopened: string[] = [];
  const deps: McpManagerDeps = {
    files: {
      path: () => ok("/home/mcp.jsonc"),
      ids: () => ok([...written.keys()]),
      write: (_target, id, entry) => {
        if (entry === undefined) written.delete(id);
        else written.set(id, entry);
        return ok(undefined);
      },
    },
    definitions: () => ok([github, scripts]),
    attachments: {
      read: () => ok(state),
      write: (next) => {
        state = next;
        return ok(undefined);
      },
    },
    sessions: {
      get: () => ok({ workspaceId: "ws", state: sessionState }),
      reconfigure: (sessionId) => {
        reopened.push(sessionId);
        return Promise.resolve(ok(undefined));
      },
    },
    catalog: () => ({ github: [{ name: "search", inputSchema: { type: "object" } }] }),
    agents: () => ["code-writer"],
  };
  return { deps, state: () => state, reopened, written };
}

describe("mcp.jsonc entries", () => {
  it("reads back as the definition it was written from", () => {
    for (const definition of [github, scripts]) {
      const checked = checkedMcpServerEntry(definition, "/home/mcp.jsonc");
      expect(checked.ok && checked.value.definition).toEqual(definition);
    }
  });

  it("refuses an inline secret without echoing it", () => {
    const inline: McpServerDef = { ...github, transport: { type: "http", url: "https://x.test/mcp", headers: { Authorization: "Bearer hunter2-hunter2" } } };
    const checked = checkedMcpServerEntry(inline, "/home/mcp.jsonc");
    expect(checked.ok).toBe(false);
    expect(checked.ok ? "" : checked.error.message).not.toContain("hunter2");
  });
});

describe("attaching", () => {
  it("copies a workspace's servers into a new session, once", async () => {
    const { deps, state } = harness("ended");
    const manager = createMcpManager(deps);
    await manager.attach({ serverId: "github", target: { kind: "workspace", workspaceId: "ws" }, agent: null, acknowledgeCacheReset: false });
    manager.seedSession("s1", "ws");
    await manager.attach({ serverId: "scripts", target: { kind: "workspace", workspaceId: "ws" }, agent: null, acknowledgeCacheReset: false });
    manager.seedSession("s1", "ws");
    expect(state().sessions["s1"]).toEqual([{ serverId: "github", agent: null }]);
  });

  it("refuses a change while a turn runs, even when acknowledged", async () => {
    const { deps, reopened } = harness("running");
    const changed = await createMcpManager(deps).attach({ serverId: "github", target: { kind: "session", sessionId: "s1" }, agent: null, acknowledgeCacheReset: true });
    expect(!changed.ok && changed.error.code).toBe("mcp_manage.session_busy");
    expect(reopened).toEqual([]);
  });

  it("names the token cost when it asks, and reopens the runtime once acknowledged", async () => {
    const { deps, reopened } = harness("idle");
    const manager = createMcpManager(deps);
    const target = { kind: "session", sessionId: "s1" } as const;
    const asked = await manager.attach({ serverId: "github", target, agent: null, acknowledgeCacheReset: false });
    expect(!asked.ok && asked.error).toMatchObject({ code: "mcp_manage.cache_reset_unconfirmed", details: { toolDefinitionTokens: expect.any(Number) as number } });
    const done = await manager.attach({ serverId: "github", target, agent: null, acknowledgeCacheReset: true });
    expect(done.ok && done.value.toolDefinitionTokens).toBeGreaterThan(0);
    expect(reopened).toEqual(["s1"]);
  });

  it("reports unknown token cost while a server's tools are unknown", async () => {
    const { deps } = harness("ended");
    const manager = createMcpManager(deps);
    await manager.attach({ serverId: "scripts", target: { kind: "workspace", workspaceId: "ws" }, agent: "code-writer", acknowledgeCacheReset: false });
    const view = manager.attachments({ kind: "workspace", workspaceId: "ws" });
    expect(view.ok && view.value).toEqual({ attachments: [{ serverId: "scripts", agent: "code-writer" }], toolDefinitionTokens: null });
  });
});

describe("removing", () => {
  it("detaches a server only where it no longer resolves", async () => {
    const { deps, state } = harness("ended");
    const own: McpServerDef = { ...scripts, id: "x", scope: "workspace" };
    let inA = true;
    const manager = createMcpManager({
      ...deps,
      definitions: (workspaceId) => ok(workspaceId === "A" ? (inA ? [own] : []) : workspaceId === "B" ? [own] : []),
      sessions: { ...deps.sessions, get: (sessionId) => ok({ workspaceId: sessionId === "sA" ? "A" : "B", state: "ended" }) },
      files: {
        ...deps.files,
        ids: () => ok(["x"]),
        write: () => {
          inA = false;
          return ok(undefined);
        },
      },
    });
    for (const workspaceId of ["A", "B"]) {
      await manager.attach({ serverId: "x", target: { kind: "workspace", workspaceId }, agent: null, acknowledgeCacheReset: false });
    }
    manager.seedSession("sA", "A");
    manager.seedSession("sB", "B");
    expect(manager.remove("x", "A").ok).toBe(true);
    expect(state()).toEqual({
      workspaces: { A: [], B: [{ serverId: "x", agent: null }] },
      sessions: { sA: [], sB: [{ serverId: "x", agent: null }] },
    });
  });
});

describe("agents", () => {
  it("refuses an attachment to an agent the session does not have", async () => {
    const { deps, state } = harness("ended");
    const attached = await createMcpManager(deps).attach({ serverId: "github", target: { kind: "workspace", workspaceId: "ws" }, agent: "nope", acknowledgeCacheReset: false });
    expect(!attached.ok && attached.error.code).toBe("mcp_manage.not_attachable");
    expect(state().workspaces).toEqual({});
  });
});

describe("runtime servers", () => {
  it("substitutes secrets, joins agent servers to their agent, and leaves out one whose secret is missing", async () => {
    const { deps } = harness("ended");
    const manager = createMcpManager(deps);
    const state: McpAttachmentState = {
      workspaces: {},
      sessions: { s1: [{ serverId: "github", agent: null }, { serverId: "scripts", agent: "code-writer" }] },
    };
    deps.attachments.write(state);
    const plan = manager.sessionPlan("s1", "ws");
    if (!plan.ok) throw new Error(plan.error.message);
    const skipped: string[] = [];
    const options = await runtimeMcpOptions(plan.value, {
      sources: { keychain: source({ "github/pat": "pat-value" }), env: source({}) },
      redactor: createMcpSecretRedactor(),
      onSkipped: (serverId) => skipped.push(serverId),
    });
    expect(options).toEqual({
      mcpServers: { github: { type: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "pat-value" }, tools: ["*"] } },
      agents: {},
    });
    expect(skipped).toEqual(["scripts"]);
  });

  it("puts agent-scoped servers on the delegator's agent of that name only", () => {
    const local = { type: "local", command: "x", args: [], env: {}, tools: ["*"] } as const;
    const options: Pick<SessionOptions, "customAgents"> = {
      customAgents: [{ name: "code-writer", description: "", prompt: "" }, { name: "repo-scout", description: "", prompt: "" }],
    };
    const merged = withMcpServers(options, { agents: { "code-writer": { scripts: local } } });
    expect((merged.customAgents ?? []).map((agent) => agent.mcpServers)).toEqual([{ scripts: local }, undefined]);
    expect("mcpServers" in merged).toBe(false);
  });
});
