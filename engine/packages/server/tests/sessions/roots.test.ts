import { afterEach, describe, expect, it } from "vitest";
import { FakeRuntime } from "@pica/testkit";
import { call, createSession, repoId, repoPath, scenario, startSessionEngine } from "./helpers.ts";
import type { SessionEngine } from "./helpers.ts";

// A-10: the terminal asks where a session works.

let engine: SessionEngine | undefined;

afterEach(async () => {
  await engine?.stop();
  engine = undefined;
});

describe("session.roots", () => {
  it("answers the session's write root, the checkout of the repo it writes", async () => {
    engine = await startSessionEngine(new FakeRuntime({ scenario: scenario([]) }));
    const client = await engine.connect();
    const sessionId = await createSession(client);

    const result = await call(client, "session.roots", { sessionId });

    expect(result).toEqual({ roots: [{ path: repoPath, access: "write", repoId }] });
  });

  it("answers not_found for a session that does not exist", async () => {
    engine = await startSessionEngine(new FakeRuntime({ scenario: scenario([]) }));
    const client = await engine.connect();

    const response = await client.request("session.roots", { sessionId: "session-missing" });

    expect((response["error"] as { data: { code: string } }).data.code).toBe("not_found");
  });
});
