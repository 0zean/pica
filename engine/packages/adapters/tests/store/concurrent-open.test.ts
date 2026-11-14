import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nextLine, startNodeProcess, withTempDir } from "./helpers.ts";

const temp: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of temp.splice(0)) {
    cleanup();
  }
});

async function openTogether(path: string, count: number): Promise<{ code: number | null; stderr: string }[]> {
  const workers = Array.from({ length: count }, () => startNodeProcess("open-worker.ts", [path]));
  for (const worker of workers) {
    expect(await nextLine(worker)).toBe("ready");
  }
  for (const worker of workers) {
    worker.child.stdin.end("go\n");
  }
  return Promise.all(workers.map((worker) => worker.exited));
}

describe("concurrent open", { timeout: 60_000 }, () => {
  // Two engines can start at once (the app and `pica`, or two `pica` commands); both must open the
  // same new database. Several rounds, because the lock collision only happens on some of them.
  it("every process opening a new database at the same moment succeeds", async () => {
    for (let round = 0; round < 15; round++) {
      const { dir, cleanup } = withTempDir();
      temp.push(cleanup);
      const exits = await openTogether(join(dir, "pica.db"), 4);
      expect(exits).toEqual(Array.from({ length: 4 }, () => ({ code: 0, signal: null, stderr: "" })));
    }
  });
});
