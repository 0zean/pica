// `picad` as `main.ts` composes it, for H-07's event delivery budget (PLAN.md §9: engine → view, p99
// under 5 ms). It runs like `fake-picad.ts` (`--socket <path>`, PICA_TEST_HOME, the ready line on
// stdout), with a FakeRuntime whose first turn stays running. Sending `stream <count> <ratePerSecond>`
// to a session also emits `count` assistant deltas from the runtime at that rate, each carrying
// `process.hrtime` at the moment the runtime emitted it. On macOS that clock and the app's
// `CLOCK_MONOTONIC_RAW` both read `mach_continuous_time`, so the app subtracts it from its own
// reading to get the delay through the engine (normalizing, storing, notifying), the socket and its
// decoding. `AppShellTests/EventDeliveryLatencyTests.swift` reads them.
import { parseArgs } from "node:util";
import { ManagedPolicyLoader } from "@pica/adapters";
import { createSecretScrubber, createStructuredLog } from "@pica/core";
import type { AgentRuntime, RuntimeSession } from "@pica/core";
import { FakeRuntime, FakeSession, scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import { composeEngine, startEngine } from "../../src/index.ts";

const log = createStructuredLog({
  write: (line) => {
    process.stderr.write(`${line}\n`);
  },
  clock: () => new Date().toISOString(),
  redactor: createSecretScrubber(),
}).logger("picad");

const scenario = scenarioSchema.parse({
  version: 1,
  models: [{ id: "model-a", name: "Model A" }],
  defaultModel: "model-a",
  quota: { usedCredits: 0, entitlementCredits: null, resetDate: null },
  turns: [
    {
      steps: [
        { type: "text", content: "Streaming.", deltas: ["Streaming."] },
        { type: "toolCall", name: "view", arguments: { path: "src/a.ts" }, result: "a", success: true, hangs: true },
      ],
    },
  ],
});

// Sessions are FakeRuntime's; `send` also starts the paced deltas when the prompt asks for them.
function streamingRuntime(inner: FakeRuntime): AgentRuntime {
  const wrap = (session: RuntimeSession): RuntimeSession => {
    if (!(session instanceof FakeSession)) return session;
    const send = session.send.bind(session);
    session.send = async (prompt) => {
      const sent = await send(prompt);
      const asked = /^stream (\d+) (\d+)$/.exec(prompt);
      if (sent.ok && asked !== null) streamDeltas(session, Number(asked[1]), Number(asked[2]));
      return sent;
    };
    return session;
  };
  return {
    listModels: () => inner.listModels(),
    quota: () => inner.quota(),
    createSession: async (options) => {
      const created = await inner.createSession(options);
      return created.ok ? { ok: true, value: wrap(created.value) } : created;
    },
    resumeSession: async (options) => {
      const resumed = await inner.resumeSession(options);
      return resumed.ok ? { ok: true, value: wrap(resumed.value) } : resumed;
    },
  };
}

// Emits on a timer rather than in a burst, so each delta measures one event's way to the app and not
// the queue behind a thousand others.
function streamDeltas(session: FakeSession, count: number, ratePerSecond: number): void {
  const intervalNs = BigInt(Math.round(1e9 / ratePerSecond));
  const started = process.hrtime.bigint();
  let sent = 0;
  const tick = (): void => {
    const now = process.hrtime.bigint();
    while (sent < count && now - started >= BigInt(sent) * intervalNs) {
      session.emit("assistant.message_delta", { messageId: "stream", deltaContent: process.hrtime.bigint().toString() });
      sent += 1;
    }
    if (sent < count) setTimeout(tick, 1);
  };
  setTimeout(tick, 1);
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { socket: { type: "string" } } });
  const socketPath = values.socket;
  const homeDir = process.env["PICA_TEST_HOME"];
  if (socketPath === undefined || homeDir === undefined) {
    throw new Error("event-latency-picad needs --socket and PICA_TEST_HOME");
  }
  const runtime = streamingRuntime(
    new FakeRuntime({ scenario, clock: steppingClock("2026-11-21T10:00:00.000Z"), ids: sequentialIds() }),
  );
  const composed = composeEngine({ homeDir, userName: "tester", env: {}, log, runtime, managedPolicy: new ManagedPolicyLoader([]) });
  const listener = await startEngine({ socketPath, log, ...composed.options });
  const stop = (): void => {
    void listener
      .close()
      .then(() => composed.close())
      .then(() => process.exit(0));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  process.stdout.write(`${JSON.stringify({ ready: true, socket: listener.socketPath })}\n`);
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
