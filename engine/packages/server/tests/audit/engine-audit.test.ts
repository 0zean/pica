import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createJsonlAuditStore, createSessionArtifacts, sha256Hex } from "@pica/adapters";
import { defaultCommandDenyList, openAuditLog, verifyAuditLines } from "@pica/core";
import type { AuditEntry, PolicyContext } from "@pica/core";
import { PicaConfig } from "@pica/protocol";
import { FakeRuntime, sequentialIds, steppingClock } from "@pica/testkit";
import { silentLogger, startEngine } from "../../src/index.ts";
import { TestClient } from "../helpers.ts";
import { call, createSession, isState, openSeededStore, received, repoPath, scenario, subscribe, waitForEvent } from "../sessions/helpers.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

function policyContext(): PolicyContext {
  return {
    cwd: repoPath,
    writeRoots: [repoPath],
    referenceRoots: [],
    config: PicaConfig.parse({ routing: { delegation: { output: { maxBytes: 1024 } } } }),
    managed: [],
    commandDenyList: defaultCommandDenyList,
  };
}

describe("engine audit wiring", () => {
  it("emits the output guard's decision as an event and audits it with the tool call", async () => {
    const dir = await mkdtemp(join(tmpdir(), "picad-audit-"));
    const auditPath = join(dir, "audit.jsonl");
    const audit = openAuditLog({ store: createJsonlAuditStore(auditPath), hash: sha256Hex });
    if (!audit.ok) {
      throw new Error(audit.error.message);
    }
    const store = openSeededStore(join(dir, "pica.db"));
    const ids = sequentialIds();
    const runtime = new FakeRuntime({
      scenario: scenario([{ steps: [{ type: "toolCall", name: "bash", arguments: { command: "cat big.log" }, result: "x".repeat(4096) }] }]),
    });
    const engine = await startEngine({
      socketPath: join(dir, "run", "picad.sock"),
      log: silentLogger,
      sessions: {
        store,
        runtime,
        clock: steppingClock("2026-11-14T09:00:00.000Z"),
        newSessionId: () => ids("session"),
        outputGuard: { artifacts: createSessionArtifacts(join(dir, "sessions")), policyContext },
        audit: audit.value,
      },
    });
    const client = await TestClient.connectAndHello(join(dir, "run", "picad.sock"));
    cleanups.push(async () => {
      client.close();
      await engine.close();
      store.close();
      await rm(dir, { recursive: true, force: true });
    });
    const sessionId = await createSession(client);
    const subscriptionId = await subscribe(client, sessionId);

    await call(client, "session.send", { sessionId, text: "show the log", mode: "send" });
    await waitForEvent(client, subscriptionId, (event) => event.type === "tool.completed");
    await waitForEvent(client, subscriptionId, isState("idle"));

    const decisions = received(client, subscriptionId).filter((event) => event.type === "policy.decision");
    expect(decisions.map((event) => event.payload)).toMatchObject([{ ruleId: "cost.oversized-output", outcome: "rewrite", toolName: "bash" }]);
    const lines = (await readFile(auditPath, "utf8")).trimEnd().split("\n");
    expect(verifyAuditLines(lines, sha256Hex).ok).toBe(true);
    const entries = lines.map((line) => JSON.parse(line) as AuditEntry);
    expect(entries.map((entry) => entry.kind)).toEqual(["tool.started", "policy.decision", "tool.completed"]);
    expect(entries[1]?.eventSeq).toBe(decisions[0]?.seq);
  });
});
