import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRuntimeNativeDelegator } from "@pica/core";
import { builtinAgents, builtinDelegator, fakeRuntime, openHarness, payload, runTurn, sessionEvents, sessionService, startSession, tierResolver } from "./helpers.ts";
import type { Harness } from "./helpers.ts";
import { MarkdownAgentLoader } from "../../src/index.ts";

// C-07 check 3: each child runs with exactly the tools in its agent definition.

let harness: Harness;
beforeEach(() => {
  harness = openHarness();
});
afterEach(() => {
  harness.close();
});

function definitions() {
  const loaded = builtinAgents().load();
  if (!loaded.ok) {
    throw new Error(loaded.error.message);
  }
  return loaded.value;
}

describe("C-07 child tools", () => {
  it("passes each built-in agent to the runtime with exactly its definition's tools", async () => {
    const runtime = fakeRuntime([]);
    const sessions = sessionService(harness, runtime, builtinDelegator());
    const sessionId = await startSession(sessions);

    const customAgents = runtime.sessionOptions(sessionId)?.customAgents ?? [];
    const defs = definitions();
    expect(customAgents.map((agent) => agent.name)).toEqual(defs.map((agent) => agent.name).sort());
    for (const def of defs) {
      const passed = customAgents.find((agent) => agent.name === def.name);
      expect(passed?.tools).toEqual(def.tools);
      expect(passed).toMatchObject({ description: def.description, prompt: def.prompt });
    }
  });

  it("gives the same tools in every routing profile", async () => {
    const delegator = builtinDelegator();
    const tools = await Promise.all(
      (["off", "balanced", "strict"] as const).map(async (routingProfile) => {
        const setup = await delegator.setup({ sessionId: "s", routingProfile });
        if (!setup.ok) throw new Error(setup.error.message);
        return setup.value.agents.map((agent) => [agent.name, agent.tools]);
      }),
    );
    expect(tools[1]).toEqual(tools[0]);
    expect(tools[2]).toEqual(tools[0]);
  });

  it("refuses a child's call to a tool outside its definition", async () => {
    const turns = [
      {
        steps: [
          {
            type: "subagent",
            agentName: "bulk-reader",
            model: "model-a",
            viaTask: true,
            steps: [
              { type: "toolCall", name: "view", arguments: { path: "a.txt" }, result: "a" },
              { type: "toolCall", name: "edit", arguments: { path: "a.txt" }, result: "edited" },
              { type: "text", content: "done" },
            ],
          },
        ],
      },
    ];
    const sessions = sessionService(harness, fakeRuntime(turns), builtinDelegator());
    const sessionId = await startSession(sessions);
    await runTurn(harness, sessions, sessionId, "go");

    const outcomes = sessionEvents(harness, sessionId)
      .filter((event) => (event.type === "tool.completed" || event.type === "tool.failed") && payload(event).agent === "bulk-reader")
      .map((event) => [payload(event).toolName, event.type]);
    expect(outcomes).toEqual([
      ["view", "tool.completed"],
      ["edit", "tool.failed"],
    ]);
  });

  it("takes a custom agent's tools from its file, not from any default", async () => {
    const loader = new MarkdownAgentLoader([
      {
        layer: "workspace",
        files: [{ path: "/agents/schema-reader.md", text: "---\ndescription: Reads schemas.\ntools: [grep, view]\n---\nRead schemas.\n" }],
      },
    ]);
    const setup = await createRuntimeNativeDelegator({ agents: loader, resolveTier: tierResolver() }).setup({ sessionId: "s", routingProfile: "strict" });
    if (!setup.ok) throw new Error(setup.error.message);
    expect(setup.value.sessionOptions.customAgents).toEqual([
      { name: "schema-reader", description: "Reads schemas.", prompt: "Read schemas.", tools: ["grep", "view"] },
    ]);
  });
});

describe("C-07 child models (D-16)", () => {
  it("requests no model when the worker tier resolves to none", async () => {
    const setup = await builtinDelegator().setup({ sessionId: "s", routingProfile: "balanced" });
    if (!setup.ok) throw new Error(setup.error.message);
    for (const agent of setup.value.sessionOptions.customAgents ?? []) {
      expect(agent).not.toHaveProperty("model");
    }
    expect(setup.value.agents.find((agent) => agent.name === "bulk-reader")).toMatchObject({ model: null, modelReason: "unresolved" });
  });

  it("requests each agent's tier model when its tier resolves", async () => {
    const setup = await builtinDelegator({ worker: "cheap-1", reasoning: "deep-1" }).setup({ sessionId: "s", routingProfile: "balanced" });
    if (!setup.ok) throw new Error(setup.error.message);
    const defs = definitions();
    for (const agent of setup.value.sessionOptions.customAgents ?? []) {
      const tier = defs.find((def) => def.name === agent.name)?.tier;
      expect(agent.model).toBe(tier === "worker" ? "cheap-1" : "deep-1");
    }
    expect(setup.value.sessionOptions.customAgents?.find((agent) => agent.name === "bulk-reader")?.model).toBe("cheap-1");
  });

  it("fails the session when agent definitions do not load", async () => {
    const broken = new MarkdownAgentLoader([{ layer: "workspace", files: [{ path: "/agents/bad.md", text: "---\ntools: [view]\n---\nno description\n" }] }]);
    const runtime = fakeRuntime([]);
    const sessions = sessionService(harness, runtime, createRuntimeNativeDelegator({ agents: broken, resolveTier: tierResolver() }));
    const created = await sessions.create({ workspaceId: "ws-1", writeRepoIds: ["repo-1"], referenceRepoIds: [] });
    expect(created).toMatchObject({ ok: false, error: { code: "session.invalid_request" } });
    expect(runtime.eventLog()).toEqual([]);
  });
});
