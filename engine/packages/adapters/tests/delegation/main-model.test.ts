import { afterEach, describe, expect, it } from "vitest";
import { scenarioSchema, FakeRuntime } from "@pica/testkit";
import { builtinDelegator, openHarness, repoId, sessionService, workspaceId } from "./helpers.ts";
import type { Harness } from "./helpers.ts";

// C-01 follow-up: the main agent runs on the reasoning tier's model. Before, only the sub-agents got
// a tier's model, and the main agent ran on whatever the runtime defaults to.

let harness: Harness | undefined;
afterEach(() => {
  harness?.close();
  harness = undefined;
});

function runtime(): FakeRuntime {
  const scenario = scenarioSchema.parse({
    version: 1,
    models: [
      { id: "model-default", name: "Default" },
      { id: "model-r", name: "Reasoning" },
      { id: "model-w", name: "Worker" },
    ],
    defaultModel: "model-default",
    turns: [],
  });
  return new FakeRuntime({ scenario });
}

describe("C-01 main-agent model", () => {
  it("passes the reasoning tier's model for the main agent and the worker tier's for workers", async () => {
    const setup = await builtinDelegator({ reasoning: "model-r", worker: "model-w" }).setup({ sessionId: "s", routingProfile: "off" });
    if (!setup.ok) throw new Error(setup.error.message);
    expect(setup.value.sessionOptions.model).toBe("model-r");
    expect(setup.value.sessionOptions.customAgents?.find((agent) => agent.name === "bulk-reader")?.model).toBe("model-w");
  });

  it("leaves the main agent on the runtime's default when the reasoning tier resolves to none (D-16)", async () => {
    const setup = await builtinDelegator().setup({ sessionId: "s", routingProfile: "balanced" });
    if (!setup.ok) throw new Error(setup.error.message);
    expect(setup.value.sessionOptions).not.toHaveProperty("model");
  });

  it("reaches the runtime through the session service under every profile", async () => {
    const opened = openHarness();
    harness = opened;
    const fake = runtime();
    const sessions = sessionService(opened, fake, builtinDelegator({ reasoning: "model-r", worker: "model-w" }));
    const models = [];
    for (const routingProfile of ["off", "balanced", "strict"] as const) {
      const created = await sessions.create({ workspaceId, writeRepoIds: [repoId], referenceRepoIds: [], routingProfile });
      if (!created.ok) throw new Error(created.error.message);
      models.push(fake.sessionOptions(created.value.id)?.model);
    }
    expect(models).toEqual(["model-r", "model-r", "model-r"]);
  });
});
