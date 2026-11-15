import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  catalogTierResolver,
  createEventLog,
  createModelCatalog,
  createReadGate,
  createRuntimeNativeDelegator,
  createSessionService,
  fallbackPriceTable,
} from "@pica/core";
import type { DelegationSetup, PolicyConfig, SessionService } from "@pica/core";
import { CopilotRuntime, fileSize, JsoncConfigLoader } from "../../src/index.ts";
import { builtinAgents, openHarness, payload, repoId, sessionEvents, workspaceId } from "./helpers.ts";
import type { Harness } from "./helpers.ts";

// C-07 check 4 (live; PICA_LIVE=1 and a Copilot login): a `bulk-reader` delegation runs on the
// worker-tier model. Per D-16 it holds on whatever plan is signed in:
// - the worker tier resolves to a model: that model is requested, and every bulk-reader
//   `assistant.usage` ran on it;
// - the worker tier resolves to none (a default-model-only plan, such as Copilot Free): no model is
//   requested, and the model `assistant.usage` reports is recorded, not compared.
const live = process.env.PICA_LIVE === "1";
const fixtureName = "services-registry.txt";

function writeFixture(dir: string): { readonly target: string; readonly answer: string } {
  const target = "kestrel-ledger-prod-77";
  const answer = "613";
  const lines = ["# Service registry export. One record per line: name | owner | region | retention_days | tier"];
  for (let i = 0; i < 2300; i += 1) {
    lines.push(
      i === 1207
        ? `${target} | team-ledger | eu-west-2 | ${answer} | gold`
        : `svc-${String(i)}-${["prod", "stage", "dev"][i % 3] ?? "dev"} | team-${String(i % 17)} | us-east-1 | ${String(30 + ((i * 13) % 400))} | silver | record ${String(i)} checksum ${String((i * 2654435761) % 4294967296)}`,
    );
  }
  writeFileSync(join(dir, fixtureName), `${lines.join("\n")}\n`);
  return { target, answer };
}

describe.skipIf(!live)("C-07 live: bulk-reader runs on the worker-tier model", () => {
  const runtime = new CopilotRuntime();
  let harness: Harness;
  let sessions: SessionService;
  let setup: DelegationSetup | undefined;

  beforeAll(() => {
    harness = openHarness();
    const loader = new JsoncConfigLoader([{ layer: "workspace", file: join(harness.dir, "workspace.jsonc") }]);
    const config = (): PolicyConfig => {
      const loaded = loader.load();
      if (!loaded.ok) throw new Error(loaded.error.message);
      return loaded.value.config;
    };
    const catalog = createModelCatalog({
      runtime,
      priceTable: fallbackPriceTable,
      now: () => Date.now(),
      maxAgeMs: 60_000,
      retryAfterMs: 1_000,
      onWarning: () => undefined,
    });
    const delegator = createRuntimeNativeDelegator({
      agents: builtinAgents(),
      resolveTier: catalogTierResolver(catalog, () => ({ reasoning: "auto", worker: "auto" }), () => ({})),
    });
    let sessionCount = 0;
    sessions = createSessionService({
      store: harness.store,
      events: createEventLog(harness.store.events),
      runtime,
      clock: () => new Date().toISOString(),
      newSessionId: () => `c07-live-${String(Date.now())}-${String((sessionCount += 1))}`,
      hooks: createReadGate({ sessions: harness.store.sessions, config, fileSize }),
      delegator: {
        setup: async (request) => {
          const result = await delegator.setup(request);
          if (result.ok) setup = result.value;
          return result;
        },
      },
    });
  });

  afterAll(async () => {
    await runtime.stop();
    harness.close();
  });

  it("delegates to bulk-reader and runs it on the worker tier's model, or reports the routed model", { timeout: 300_000 }, async () => {
    const fixture = writeFixture(harness.dir);
    const created = await sessions.create({ workspaceId, writeRepoIds: [repoId], referenceRepoIds: [], routingProfile: "balanced" });
    if (!created.ok) throw new Error(`${created.error.code}: ${created.error.message}`);
    const sessionId = created.value.id;
    const sent = await sessions.send(
      sessionId,
      // The read gate allows a targeted search by the main agent (C-04), so the delegation is asked
      // for: this check is about the model a delegation runs on, not about when the model delegates.
      `Use the task tool to delegate this to the bulk-reader agent and do not read the file yourself: ` +
        `in ${fixtureName} in the current directory, what is the retention_days value for ${fixture.target}? ` +
        `Reply with just the number.`,
      "send",
    );
    expect(sent.ok).toBe(true);
    await settle(sessions, sessionId);

    const events = sessionEvents(harness, sessionId);
    const started = events.find((event) => event.type === "subagent.started" && payload(event).agent === "bulk-reader");
    const workerUsage = events.filter((event) => event.type === "usage.recorded" && payload(event).agent === "bulk-reader");
    const requested = setup?.agents.find((agent) => agent.name === "bulk-reader");
    const passed = setup?.sessionOptions.customAgents?.find((agent) => agent.name === "bulk-reader");
    const ranOn = [...new Set(workerUsage.map((event) => String(payload(event).model)))];
    const answer = events.filter((event) => event.type === "assistant.message" && payload(event).agent === "main").at(-1);
    console.log(
      JSON.stringify(
        {
          workerTier: requested === undefined ? null : { model: requested.model, reason: requested.modelReason },
          modelRequested: passed?.model ?? null,
          toolsPassed: passed?.tools ?? null,
          subagentStartedModel: started === undefined ? null : payload(started).model,
          bulkReaderUsageModels: ranOn,
          bulkReaderUsageCalls: workerUsage.length,
          toolCalls: events
            .filter((event) => event.type.startsWith("tool.") || event.type === "policy.decision")
            .map((event) => `${event.type} ${String(payload(event).agent)} ${String(payload(event).toolName)}`),
          correctAnswer: JSON.stringify(payload(answer).text ?? "").includes(fixture.answer),
        },
        null,
        1,
      ),
    );

    expect(events.some((event) => event.type === "session.error")).toBe(false);
    expect(started).toBeDefined();
    expect(workerUsage.length).toBeGreaterThan(0);
    expect(passed?.tools).toEqual(["glob", "grep", "view"]);
    if (requested?.model === null) {
      // Default-model-only plan: no worker model was requested; the routed model is reported above.
      expect(passed).not.toHaveProperty("model");
      expect(ranOn.every((model) => model.length > 0)).toBe(true);
    } else {
      // A plan that lists models: the override must be honored, or C-07's child-session fallback is needed.
      expect(passed?.model).toBe(requested?.model);
      expect(ranOn).toEqual([requested?.model]);
    }
  });
});

// Waits for the turn to end, approving the read permission prompts the runtime raises.
async function settle(sessions: SessionService, sessionId: string): Promise<void> {
  const deadline = Date.now() + 280_000;
  for (;;) {
    const approvals = sessions.listApprovals(sessionId);
    for (const approval of approvals.ok ? approvals.value : []) {
      await sessions.resolveApproval(approval.id, approval.kind === "tool_call" ? "allow_once" : "deny");
    }
    const info = sessions.get(sessionId);
    if (!info.ok) throw new Error(info.error.message);
    if (["idle", "failed", "ended"].includes(info.value.state)) return;
    if (Date.now() > deadline) throw new Error(`session still ${info.value.state}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
