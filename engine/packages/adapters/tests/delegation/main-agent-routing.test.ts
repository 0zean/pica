import { afterEach, describe, expect, it } from "vitest";
import { delegationGuide } from "@pica/core";
import type { RoutingProfileName } from "@pica/core";
import { builtinAgents, builtinDelegator, fakeRuntime, openHarness, payload, repoId, runTurn, sessionEvents, sessionService, workspaceId } from "./helpers.ts";
import type { Harness } from "./helpers.ts";

// C-07 follow-up: the routing profile reaches the main agent. Under `balanced` it loses the tools
// that create files and gets the profile's delegation guide; under `off` it gets neither (C-05).

// One harness per session: each session service numbers its sessions from the start.
const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

function guide(profile: RoutingProfileName): string {
  const loaded = builtinAgents().load();
  if (!loaded.ok) throw new Error(loaded.error.message);
  return delegationGuide(profile, loaded.value);
}

async function setup(routingProfile: RoutingProfileName) {
  const result = await builtinDelegator().setup({ sessionId: "s", routingProfile });
  if (!result.ok) throw new Error(result.error.message);
  return result.value.sessionOptions;
}

const createCall = { type: "toolCall", name: "create", arguments: { path: "new.txt", file_text: "hi" }, result: "Created new.txt" };

async function createSession(routingProfile: RoutingProfileName, turns: unknown[] = []) {
  const harness = openHarness();
  harnesses.push(harness);
  const runtime = fakeRuntime(turns);
  const sessions = sessionService(harness, runtime, builtinDelegator());
  const created = await sessions.create({ workspaceId, writeRepoIds: [repoId], referenceRepoIds: [], routingProfile });
  if (!created.ok) throw new Error(created.error.message);
  return { harness, runtime, sessions, sessionId: created.value.id };
}

describe("C-07 main-agent routing", () => {
  it("balanced: hides the file-creating tools from the main agent and passes the guide", async () => {
    expect(await setup("balanced")).toMatchObject({ excludedTools: ["apply_patch", "create"], systemMessage: guide("balanced") });
  });

  it("strict: hides every write tool", async () => {
    expect(await setup("strict")).toMatchObject({ excludedTools: ["apply_patch", "create", "edit"], systemMessage: guide("strict") });
  });

  it("off: hides nothing and passes no guide", async () => {
    const options = await setup("off");
    expect(options).not.toHaveProperty("excludedTools");
    expect(options).not.toHaveProperty("systemMessage");
    expect(options.customAgents?.length).toBeGreaterThan(0);
  });

  it("passes both through the session service to the runtime", async () => {
    const balanced = await createSession("balanced");
    expect(balanced.runtime.sessionOptions(balanced.sessionId)).toMatchObject({
      excludedTools: ["apply_patch", "create"],
      systemMessage: guide("balanced"),
    });
    expect(guide("balanced")).toContain("code-writer");

    const off = await createSession("off");
    expect(off.runtime.sessionOptions(off.sessionId)).not.toHaveProperty("excludedTools");
    expect(off.runtime.sessionOptions(off.sessionId)).not.toHaveProperty("systemMessage");
  });

  it("a main-agent create call fails under balanced and runs under off", async () => {
    const outcomes = [];
    for (const profile of ["balanced", "off"] as const) {
      const { harness, sessions, sessionId } = await createSession(profile, [{ steps: [createCall] }]);
      await runTurn(harness, sessions, sessionId, "make a file");
      const done = sessionEvents(harness, sessionId).find((event) => event.type === "tool.completed" || event.type === "tool.failed");
      outcomes.push([profile, done?.type, payload(done).toolName]);
    }
    expect(outcomes).toEqual([
      ["balanced", "tool.failed", "create"],
      ["off", "tool.completed", "create"],
    ]);
  });
});
