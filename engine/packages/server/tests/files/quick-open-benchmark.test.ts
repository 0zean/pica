import { createFilesService, err, filesError, ok } from "@pica/core";
import type { Repo } from "@pica/core";
import { describe, expect, it } from "vitest";
import { silentLogger, startEngine } from "../../src/index.ts";
import { benchmarkTimeoutMs, keystrokeLimitMs, largeIndex, slowest, timeKeystrokes } from "../../../core/tests/files/large-index.ts";
import { recordBudget } from "../../../../tests/support/budget-record.ts";
import { makeSocketDir, TestClient } from "../helpers.ts";

// PLAN.md §9: quick open over 100,000 files answers in under 50 ms per keystroke, measured as a
// client sees it: each keystroke is one `files.quickOpen` over the socket, from request to reply.

describe("files.quickOpen over a 100,000-file workspace", () => {
  it("answers every keystroke in under 50 ms", async () => {
    const paths = largeIndex(100_000);
    // Two repos, as a workspace has several: 60,000 and 40,000 files.
    const repos: Repo[] = ["atlas", "beacon"].map((id) => ({
      id,
      remoteUrl: `https://git.example.com/acme/${id}.git`,
      localPath: `/work/${id}`,
      managed: false,
      defaultBranch: "main",
      cloneState: "ready",
    }));
    const listings: Record<string, readonly string[]> = { "/work/atlas": paths.slice(0, 60_000), "/work/beacon": paths.slice(60_000) };
    const files = createFilesService({
      workspaceRepos: () => ok(repos),
      repo: (id) => {
        const found = repos.find((repo) => repo.id === id);
        return found === undefined ? err(filesError("files.repo_not_found", id)) : ok(found);
      },
      files: {
        listFiles: (root) => Promise.resolve(ok(listings[root] ?? [])),
        readFile: () => Promise.resolve(ok({ kind: "not_a_file" })),
      },
      stat: () => Promise.resolve(null),
      realPath: (path) => Promise.resolve(path),
      now: () => 0,
    });
    const socket = await makeSocketDir();
    const engine = await startEngine({ socketPath: socket.socketPath, log: silentLogger, files });
    const client = await TestClient.connectAndHello(engine.socketPath);
    try {
      // Opening quick open lists the repos (an empty query), as the app does.
      await client.request("files.quickOpen", { workspaceId: "w1", query: "", limit: 50 });
      const timings = await timeKeystrokes(() => async (query) => {
        const response = await client.request("files.quickOpen", { workspaceId: "w1", query, limit: 50 });
        expect("result" in response).toBe(true);
      });
      const worst = slowest(timings);
      const sorted = timings.map((timing) => timing.ms).sort((a, b) => a - b);
      console.log(
        `files.quickOpen over 100,000 files: median ${(sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(1)} ms, ` +
          `slowest ${worst.ms.toFixed(1)} ms for "${worst.query}" over ${String(timings.length)} keystrokes`,
      );
      recordBudget({ id: "quick-open", measured: worst.ms, threshold: keystrokeLimitMs(), unit: "ms" });
      expect(worst.ms).toBeLessThan(keystrokeLimitMs());
    } finally {
      client.close();
      await engine.close();
      await socket.remove();
    }
  }, benchmarkTimeoutMs);
});
