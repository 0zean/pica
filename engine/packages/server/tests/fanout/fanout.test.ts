import { afterEach, describe, expect, it } from "vitest";
import { FakeRuntime } from "@pica/testkit";
import {
  call,
  failSendsIn,
  getFanOut,
  peakConcurrentTurns,
  repoIds,
  repoPath,
  scenario,
  startFanOut,
  startFanOutEngine,
  toolGate,
  waitForFanOut,
} from "./helpers.ts";
import type { FanOutEngine, WireFanOut } from "./helpers.ts";

let engine: FanOutEngine | undefined;

afterEach(async () => {
  await engine?.stop();
  engine = undefined;
});

const prompt = "bump the logging library";

function oneToolTurn(hangs = false): FakeRuntime {
  return new FakeRuntime({
    scenario: scenario([
      {
        steps: [
          { type: "toolCall", name: "shell", arguments: { command: "make test" }, result: "ok", hangs },
          { type: "text", content: "Done." },
        ],
      },
    ]),
  });
}

function settled(fanOut: WireFanOut): boolean {
  return fanOut.state === "completed" || fanOut.state === "cancelled";
}

async function sessionsRunning(engineUnderTest: FanOutEngine): Promise<number> {
  return (await call(engineUnderTest.client, "engine.health", {}))["sessionsRunning"] as number;
}

describe("fan-out concurrency cap", () => {
  it("with 6 repos and a cap of 3, no more than 3 sessions run at once", async () => {
    const runtime = oneToolTurn();
    const gate = toolGate();
    engine = await startFanOutEngine(runtime, { hooks: gate.hooks });
    const { client } = engine;

    const started = await startFanOut(client, { prompt, concurrency: 3 });
    expect(started.concurrency).toBe(3);
    expect(started.counts).toMatchObject({ queued: 3, active: 3 });

    const released: string[] = [];
    while (released.length < repoIds.length) {
      // A request round trip lets every session started so far reach its held tool call.
      const current = await getFanOut(client, started.id);
      const held = gate.waiting();
      expect(held.length).toBeLessThanOrEqual(3);
      expect(current.counts.active).toBeLessThanOrEqual(3);
      expect(await sessionsRunning(engine)).toBeLessThanOrEqual(3);
      expect(held.length).toBe(Math.min(3, repoIds.length - released.length));
      const next = held[0] as string;
      released.push(next);
      gate.release(next);
      await waitForFanOut(client, started.id, (fanOut) => fanOut.counts.succeeded === released.length);
    }

    const done = await waitForFanOut(client, started.id, settled);
    expect(done.state).toBe("completed");
    expect(done.counts).toEqual({ queued: 0, active: 0, succeeded: 6, failed: 0, cancelled: 0 });
    expect(peakConcurrentTurns(runtime.eventLog())).toBe(3);
    expect(runtime.eventLog().filter((event) => event.type === "session.start")).toHaveLength(6);
  });

  it("rejects a cap outside 1–16 and a repeated repo", async () => {
    engine = await startFanOutEngine(oneToolTurn());
    const tooMany = await engine.client.request("fanout.start", {
      workspaceId: "ws-1",
      repoIds: ["r1"],
      prompt,
      concurrency: 17,
    });
    expect(tooMany).toHaveProperty("error.data.code", "invalid_params");
    const repeated = await engine.client.request("fanout.start", { workspaceId: "ws-1", repoIds: ["r1", "r1"], prompt });
    expect(repeated).toHaveProperty("error.data.code", "invalid_params");
  });
});

describe("fan-out failures", () => {
  it("one failing session does not cancel the others; the aggregate reports each result", async () => {
    const runtime = failSendsIn(oneToolTurn(), repoPath("r5"));
    engine = await startFanOutEngine(runtime, { uncloned: ["r3"] });
    const { client } = engine;

    const started = await startFanOut(client, { prompt, concurrency: 2 });
    const done = await waitForFanOut(client, started.id, settled);

    expect(done.state).toBe("completed");
    expect(done.counts).toEqual({ queued: 0, active: 0, succeeded: 4, failed: 2, cancelled: 0 });
    const byRepo = new Map(done.runs.map((run) => [run.repoId, run]));
    for (const repoId of ["r1", "r2", "r4", "r6"]) {
      expect(byRepo.get(repoId)).toMatchObject({ status: "succeeded", error: null });
      expect(byRepo.get(repoId)?.sessionId).not.toBeNull();
    }
    expect(byRepo.get("r3")).toEqual({
      repoId: "r3",
      sessionId: null,
      status: "failed",
      error: { code: "session.invalid_request", message: "repo r3 is not cloned" },
    });
    expect(byRepo.get("r5")).toMatchObject({
      status: "failed",
      error: { code: "runtime.failed", message: "the model provider is down" },
    });

    // The failed session is left idle for follow-up; the others answered the prompt.
    const failedSession = byRepo.get("r5")?.sessionId as string;
    const session = await call(client, "session.get", { sessionId: failedSession });
    expect((session["session"] as { state: string }).state).toBe("idle");
    expect(await getFanOut(client, started.id)).toEqual(done);
  });
});

describe("fan-out cancel", () => {
  it("cancelling the fan-out aborts every running session", async () => {
    const runtime = oneToolTurn(true);
    engine = await startFanOutEngine(runtime);
    const { client } = engine;

    const started = await startFanOut(client, { prompt, concurrency: 3 });
    await waitForFanOut(
      client,
      started.id,
      (fanOut) => fanOut.runs.filter((run) => run.status === "running").length === 3,
    );
    expect(await sessionsRunning(engine)).toBe(3);

    const cancelling = (await call(client, "fanout.cancel", { fanOutId: started.id }))["fanOut"] as WireFanOut;
    expect(["cancelling", "cancelled"]).toContain(cancelling.state);
    const done = await waitForFanOut(client, started.id, settled);

    expect(done.state).toBe("cancelled");
    expect(done.counts).toEqual({ queued: 0, active: 0, succeeded: 0, failed: 0, cancelled: 6 });
    const aborted = done.runs.filter((run) => run.sessionId !== null);
    expect(aborted.map((run) => run.repoId)).toEqual(["r1", "r2", "r3"]);
    expect(done.runs.slice(3).every((run) => run.sessionId === null)).toBe(true);

    const log = runtime.eventLog();
    expect(log.filter((event) => event.type === "abort")).toHaveLength(3);
    expect(log.filter((event) => event.type === "session.start")).toHaveLength(3);
    expect(await sessionsRunning(engine)).toBe(0);
    for (const run of aborted) {
      const session = await call(client, "session.get", { sessionId: run.sessionId });
      expect((session["session"] as { state: string }).state).toBe("idle");
    }

    // Cancelling again, or a settled fan-out, is a no-op.
    const again = (await call(client, "fanout.cancel", { fanOutId: started.id }))["fanOut"] as WireFanOut;
    expect(again.state).toBe("cancelled");
  });

  it("answers an unknown fan-out with not_found", async () => {
    engine = await startFanOutEngine(oneToolTurn());
    const response = await engine.client.request("fanout.cancel", { fanOutId: "nope" });
    expect(response).toHaveProperty("error.data.code", "not_found");
  });
});
