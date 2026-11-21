import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openSqliteStore } from "@pica/adapters";
import type { Store, StoreError } from "@pica/core";
import { FakeRuntime, sequentialIds, steppingClock } from "@pica/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { silentLogger, startEngine } from "../../src/index.ts";
import { TestClient } from "../helpers.ts";
import type { JsonObject } from "../helpers.ts";
import { call, createSession, isState, openSeededStore, received, scenario, subscribe, waitForEvent } from "../sessions/helpers.ts";
import type { WireEvent } from "../sessions/helpers.ts";

// H-05: the disk fills while a session appends events. SQLite's page limit makes its writes fail
// with SQLITE_FULL, the error a full disk gives.

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

// About 200 KB of room: enough for the session's first events, not for the long reply.
const headroomPages = 50;
const longReply = "x".repeat(2 * 1024 * 1024);

const turns = [
  {
    steps: [
      { type: "text", content: "Reading the migration." },
      { type: "text", content: longReply },
      { type: "text", content: "Done." },
    ],
  },
];

function pageCount(path: string): number {
  const db = new DatabaseSync(path);
  const row = db.prepare("PRAGMA page_count").get() as { page_count: number };
  db.close();
  return row.page_count;
}

async function startEngineOver(store: Store, dir: string): Promise<TestClient> {
  const ids = sequentialIds();
  const engine = await startEngine({
    socketPath: join(dir, "s"),
    log: silentLogger,
    sessions: {
      store,
      runtime: new FakeRuntime({ scenario: scenario(turns) }),
      clock: steppingClock("2026-11-21T09:00:00.000Z"),
      newSessionId: () => ids("session"),
    },
  });
  const client = await TestClient.connectAndHello(engine.socketPath);
  cleanups.push(async () => {
    client.close();
    await engine.close();
    store.close();
  });
  return client;
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "picad-h05-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function seqs(events: readonly WireEvent[]): number[] {
  return events.map((event) => event.seq);
}

async function wholeLog(client: TestClient, sessionId: string, lastSeq: number): Promise<WireEvent[]> {
  const subscription = await subscribe(client, sessionId, 0);
  await client.waitFor(() => received(client, subscription).length === lastSeq);
  return received(client, subscription);
}

describe("disk full during event append (H-05)", () => {
  it("fails the session with storage_full and leaves the log readable", async () => {
    const dir = await tempDir();
    const dbPath = join(dir, "pica.db");
    openSeededStore(dbPath).close();
    const store = openSqliteStore(dbPath, { maxPageCount: pageCount(dbPath) + headroomPages });
    if (!store.ok) throw new Error(store.error.message);
    const client = await startEngineOver(store.value, dir);

    const sessionId = await createSession(client);
    const live = await subscribe(client, sessionId);
    await call(client, "session.send", { sessionId, text: "migrate the database", mode: "send" });
    await waitForEvent(client, live, isState("failed"));

    const session = (await call(client, "session.get", { sessionId }))["session"] as JsonObject;
    expect(session["state"]).toBe("failed");
    const send = await client.request("session.send", { sessionId, text: "again", mode: "send" });
    expect((send["error"] as JsonObject)["data"]).toMatchObject({ code: "storage_full", details: { reason: "session.storage_full" } });

    const delivered = received(client, live);
    const types = delivered.map((event) => event.type);
    expect(types).toContain("assistant.message");
    expect(delivered.find((event) => event.type === "session.error")?.payload).toMatchObject({ code: "storage_full" });
    expect(delivered.some((event) => event.payload["text"] === longReply)).toBe(false);

    // The log is readable over the protocol, and as a database, with every event written before the failure.
    const replayed = await wholeLog(client, sessionId, session["lastSeq"] as number);
    expect(replayed).toEqual(delivered);
    expect(seqs(replayed)).toEqual(replayed.map((_, index) => index + 1));
    const db = new DatabaseSync(dbPath);
    expect(db.prepare("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }]);
    db.close();
  });

  it("reports the session failed even when the store cannot record it", async () => {
    const dir = await tempDir();
    const dbPath = join(dir, "pica.db");
    const real = openSeededStore(dbPath);
    let full = false;
    const store = refusingWritesWhen(real, () => full);
    const client = await startEngineOver(store, dir);
    const sessionId = await createSession(client);
    const live = await subscribe(client, sessionId);
    const before = received(client, live).length;

    full = true;
    await call(client, "session.send", { sessionId, text: "migrate the database", mode: "send" }).catch(() => undefined);
    await client.waitFor(() =>
      client.notifications().some((message) => message["method"] === "session.changed" && ((message["params"] as JsonObject)["session"] as JsonObject)["state"] === "failed"),
    );

    const session = (await call(client, "session.get", { sessionId }))["session"] as JsonObject;
    expect(session["state"]).toBe("failed");
    const send = await client.request("session.send", { sessionId, text: "again", mode: "send" });
    expect((send["error"] as JsonObject)["data"]).toMatchObject({ code: "storage_full" });
    const replayed = await wholeLog(client, sessionId, session["lastSeq"] as number);
    expect(replayed).toHaveLength(before);
    expect(seqs(replayed)).toEqual(replayed.map((_, index) => index + 1));
  });
});

const fullError: StoreError = { code: "store.full", message: "database or disk is full" };

function refusingWritesWhen(store: Store, full: () => boolean): Store {
  return {
    ...store,
    events: {
      ...store.events,
      append: (sessionId, event) => (full() ? { ok: false, error: fullError } : store.events.append(sessionId, event)),
    },
    sessions: {
      ...store.sessions,
      updateState: (sessionId, state, at) => (full() ? { ok: false, error: fullError } : store.sessions.updateState(sessionId, state, at)),
    },
  };
}
