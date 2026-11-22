import { afterEach, describe, expect, it } from "vitest";
import { builtinAgentsDir, MarkdownAgentLoader } from "@pica/adapters";
import { createRuntimeNativeDelegator } from "@pica/core";
import type { SessionRoutingLocks, TierResolution } from "@pica/core";
import type { Tier } from "@pica/protocol";
import { FakeRuntime, scenarioSchema } from "@pica/testkit";
import type { TestClient } from "../helpers.ts";
import type { JsonObject } from "../helpers.ts";
import { call, isState, openSeededStore, repoId, startSessionEngine, subscribe, waitForEvent, workspaceId } from "./helpers.ts";
import type { SessionEngine } from "./helpers.ts";

let engine: SessionEngine | undefined;

afterEach(async () => {
  await engine?.stop();
  engine = undefined;
});

// The config's `routing.tiers`, as resolved: what a session without its own tiers runs on.
const configured: Readonly<Record<Tier, string>> = { reasoning: "model-a", worker: "model-b" };

function resolveTier(tier: Tier, setting?: string): Promise<TierResolution> {
  const chosen = setting === undefined || setting === "auto" ? configured[tier] : setting;
  return Promise.resolve({ tier, setting: setting ?? configured[tier], resolvedModelId: chosen, reason: "configured" });
}

const hangingTurn = {
  steps: [{ type: "toolCall", name: "shell", arguments: { command: "make test" }, result: "", hangs: true }],
};

interface Started {
  readonly client: TestClient;
  readonly runtime: FakeRuntime;
}

async function start(locks?: SessionRoutingLocks, turns: unknown[] = []): Promise<Started> {
  const runtime = new FakeRuntime({
    scenario: scenarioSchema.parse({
      version: 1,
      models: [
        { id: "model-a", name: "Model A" },
        { id: "model-b", name: "Model B" },
        { id: "model-c", name: "Model C" },
      ],
      defaultModel: "model-a",
      turns,
    }),
  });
  engine = await startSessionEngine(runtime, undefined, undefined, () => ({
    delegator: createRuntimeNativeDelegator({
      agents: new MarkdownAgentLoader([{ layer: "builtin", dir: builtinAgentsDir }]),
      resolveTier,
    }),
    ...(locks === undefined ? {} : { routingLocks: () => locks }),
  }));
  return { client: await engine.connect(), runtime };
}

async function createIdle(client: TestClient, params: JsonObject = {}): Promise<JsonObject> {
  const created = sessionOf(
    await call(client, "session.create", { workspaceId, writeRepoIds: [repoId], referenceRepoIds: [], ...params }),
  );
  const subscriptionId = await subscribe(client, created["id"] as string);
  await waitForEvent(client, subscriptionId, isState("idle"));
  return created;
}

function sessionOf(result: JsonObject): JsonObject {
  return result["session"] as JsonObject;
}

async function errorCode(client: TestClient, method: string, params: unknown): Promise<unknown> {
  const response = await client.request(method, params);
  if (!("error" in response)) return "no error";
  const error = response["error"] as JsonObject;
  return (error["data"] as JsonObject | undefined)?.["code"] ?? error["code"];
}

function workerModels(runtime: FakeRuntime, sessionId: string): (string | undefined)[] {
  return [...new Set(runtime.sessionOptions(sessionId)?.customAgents?.map((agent) => agent.model))];
}

describe("session.create with per-session models", () => {
  it("runs the session on its own tier models and reports them", async () => {
    const { client, runtime } = await start();
    const session = await createIdle(client, { routingProfile: "strict", modelTiers: { reasoning: "model-c", worker: "auto" } });
    expect(session["routingProfile"]).toBe("strict");
    expect(session["modelTiers"]).toEqual({ reasoning: "model-c", worker: "auto" });
    const id = session["id"] as string;
    expect(runtime.sessionOptions(id)?.model).toBe("model-c");
    // `auto` resolves as the config's setting would.
    expect(workerModels(runtime, id)).toContain("model-b");
    expect(runtime.sessionOptions(id)?.excludedTools).toContain("edit");
  });

  it("follows the config's tiers without overrides and reports none", async () => {
    const { client, runtime } = await start();
    const session = await createIdle(client, { modelTiers: {} });
    expect("modelTiers" in session).toBe(false);
    expect(runtime.sessionOptions(session["id"] as string)?.model).toBe("model-a");
  });
});

describe("session.setRouting", () => {
  it("switches an idle session's mode and models, reopening its runtime, and announces it", async () => {
    const { client, runtime } = await start();
    const id = (await createIdle(client))["id"] as string;
    expect(runtime.sessionOptions(id)?.excludedTools).toBeUndefined();

    const changed = sessionOf(
      await call(client, "session.setRouting", { sessionId: id, routingProfile: "strict", modelTiers: { worker: "model-c" } }),
    );
    expect(changed["routingProfile"]).toBe("strict");
    expect(changed["modelTiers"]).toEqual({ worker: "model-c" });
    expect(changed["state"]).toBe("idle");
    expect(runtime.sessionOptions(id)?.excludedTools).toContain("edit");
    expect(runtime.sessionOptions(id)?.model).toBe("model-a");
    expect(workerModels(runtime, id)).toEqual(["model-c"]);
    await client.waitFor(() =>
      client
        .notifications()
        .some(
          (message) =>
            message["method"] === "session.changed" &&
            ((message["params"] as JsonObject)["session"] as JsonObject)["routingProfile"] === "strict",
        ),
    );

    // Changing only the mode keeps the models; `{}` returns them to the config.
    const offAgain = sessionOf(await call(client, "session.setRouting", { sessionId: id, routingProfile: "off" }));
    expect(offAgain["modelTiers"]).toEqual({ worker: "model-c" });
    const cleared = sessionOf(await call(client, "session.setRouting", { sessionId: id, modelTiers: {} }));
    expect(cleared["routingProfile"]).toBe("off");
    expect("modelTiers" in cleared).toBe(false);
    expect(workerModels(runtime, id)).toEqual(["model-b"]);
  });

  it("persists the change across an engine restart", async () => {
    const { client } = await start();
    const id = (await createIdle(client))["id"] as string;
    await call(client, "session.setRouting", { sessionId: id, routingProfile: "balanced", modelTiers: { reasoning: "model-c" } });
    if (engine === undefined) throw new Error("no engine");
    const reopened = openSeededStore(engine.dbPath);
    try {
      const stored = reopened.sessions.get(id);
      expect(stored.ok && stored.value.routingProfile).toBe("balanced");
      expect(stored.ok && stored.value.modelTiers).toEqual({ reasoning: "model-c" });
    } finally {
      reopened.close();
    }
  });

  it("refuses while a turn runs, after the session ended, and for unknown sessions", async () => {
    const { client } = await start(undefined, [hangingTurn]);
    const id = (await createIdle(client))["id"] as string;
    const subscriptionId = await subscribe(client, id);
    await call(client, "session.send", { sessionId: id, text: "run the tests", mode: "send" });
    await waitForEvent(client, subscriptionId, isState("running"));
    expect(await errorCode(client, "session.setRouting", { sessionId: id, routingProfile: "strict" })).toBe("invalid_state");
    expect(sessionOf(await call(client, "session.get", { sessionId: id }))["routingProfile"]).toBe("off");

    await call(client, "session.end", { sessionId: id });
    expect(await errorCode(client, "session.setRouting", { sessionId: id, routingProfile: "strict" })).toBe("invalid_state");
    expect(await errorCode(client, "session.setRouting", { sessionId: "nope", routingProfile: "strict" })).toBe("not_found");
  });

  it("honours managed policy locks on the profile and on a tier", async () => {
    const { client } = await start({ profile: "balanced", tiers: { reasoning: "model-a" }, policyId: "acme" });
    expect(
      await errorCode(client, "session.create", { workspaceId, writeRepoIds: [repoId], referenceRepoIds: [], routingProfile: "strict" }),
    ).toBe("policy_denied");
    expect(
      await errorCode(client, "session.create", {
        workspaceId,
        writeRepoIds: [repoId],
        referenceRepoIds: [],
        routingProfile: "balanced",
        modelTiers: { reasoning: "model-c" },
      }),
    ).toBe("policy_denied");

    const id = (await createIdle(client, { routingProfile: "balanced", modelTiers: { reasoning: "model-a", worker: "model-c" } }))[
      "id"
    ] as string;
    expect(await errorCode(client, "session.setRouting", { sessionId: id, routingProfile: "off" })).toBe("policy_denied");
    expect(await errorCode(client, "session.setRouting", { sessionId: id, modelTiers: { reasoning: "model-b" } })).toBe(
      "policy_denied",
    );
    // The unlocked tier may change.
    const changed = sessionOf(await call(client, "session.setRouting", { sessionId: id, modelTiers: { worker: "model-a" } }));
    expect(changed["modelTiers"]).toEqual({ worker: "model-a" });
  });
});
