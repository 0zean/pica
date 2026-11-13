import fc from "fast-check";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nextLine, seedStore, startNodeProcess, value, withTempDir } from "./helpers.ts";

interface Appended {
  readonly sessionId: string;
  readonly seq: number;
  readonly index: number;
}

const sessionIds = ["session-a", "session-b", "session-c"];

// One plan per worker: the sessions it appends to, in order.
const plansArbitrary = fc.array(
  fc.array(fc.constantFrom(...sessionIds), { minLength: 1, maxLength: 40 }),
  { minLength: 2, maxLength: 5 },
);

async function runWorkers(path: string, plans: readonly (readonly string[])[]): Promise<Appended[][]> {
  const workers = plans.map((plan, worker) =>
    startNodeProcess("append-worker.ts", [path, String(worker), JSON.stringify(plan)]),
  );
  for (const worker of workers) {
    expect(await nextLine(worker)).toBe("ready");
  }
  for (const worker of workers) {
    worker.child.stdin.end("go\n");
  }
  const results = await Promise.all(workers.map((worker) => nextLine(worker)));
  for (const worker of workers) {
    const { code, stderr } = await worker.exited;
    expect(stderr).toBe("");
    expect(code).toBe(0);
  }
  return results.map((line) => JSON.parse(line) as Appended[]);
}

describe("event sequence numbers", () => {
  let cleanup = (): void => undefined;
  afterEach(() => {
    cleanup();
  });

  it("read back strictly increasing and gap-free per session under concurrent appends from separate processes", async () => {
    await fc.assert(
      fc.asyncProperty(plansArbitrary, async (plans) => {
        const temp = withTempDir();
        cleanup = temp.cleanup;
        const path = join(temp.dir, "pica.db");
        const store = seedStore(path, sessionIds);

        const appendedByWorker = await runWorkers(path, plans);

        for (const sessionId of sessionIds) {
          const planned = plans.flat().filter((id) => id === sessionId).length;
          const events = value(store.events.readAfter(sessionId, 0, planned + 1));
          const seqs = events.map((event) => event.seq);
          expect(seqs).toEqual(Array.from({ length: planned }, (_, i) => i + 1));
          expect(value(store.events.lastSeq(sessionId))).toBe(planned);

          const writerBySeq = new Map(events.map((event) => [event.seq, event.payload]));
          appendedByWorker.forEach((appended, worker) => {
            const own = appended.filter((entry) => entry.sessionId === sessionId);
            for (const entry of own) {
              expect(writerBySeq.get(entry.seq)).toEqual({ worker: String(worker), index: entry.index });
            }
            const ownSeqs = own.map((entry) => entry.seq);
            expect(ownSeqs).toEqual([...ownSeqs].sort((a, b) => a - b));
          });
        }
        store.close();
        temp.cleanup();
      }),
      { numRuns: 15 },
    );
  }, 120_000);

  it("page through readAfter without skipping or repeating", () => {
    const temp = withTempDir();
    cleanup = temp.cleanup;
    const store = seedStore(join(temp.dir, "pica.db"), ["session-a"]);
    for (let i = 0; i < 25; i += 1) {
      value(store.events.append("session-a", { type: "t", payload: i, timestamp: "t" }));
    }
    const seen: number[] = [];
    for (let page = value(store.events.readAfter("session-a", 0, 7)); page.length > 0; ) {
      seen.push(...page.map((event) => event.seq));
      page = value(store.events.readAfter("session-a", seen.at(-1) ?? 0, 7));
    }
    expect(seen).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    store.close();
  });
});
