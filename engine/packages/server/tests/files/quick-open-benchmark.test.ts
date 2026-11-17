import { createFilesService, err, filesError, ok } from "@pica/core";
import type { Repo } from "@pica/core";
import { describe, expect, it } from "vitest";
import { silentLogger, startEngine } from "../../src/index.ts";
import { largeIndex, typedQueries } from "../../../core/tests/files/large-index.ts";
import { makeSocketDir, TestClient } from "../helpers.ts";

// PLAN.md §9: quick open over 100,000 files answers in under 50 ms per keystroke, measured as a
// client sees it: each keystroke is one `files.quickOpen` over the socket, from request to reply.
const budgetMs = 50;

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
      const timings: { readonly query: string; readonly ms: number }[] = [];
      for (const typed of typedQueries) {
        for (let length = 1; length <= typed.length; length += 1) {
          const query = typed.slice(0, length);
          const started = performance.now();
          const response = await client.request("files.quickOpen", { workspaceId: "w1", query, limit: 50 });
          timings.push({ query, ms: performance.now() - started });
          expect("result" in response).toBe(true);
        }
      }
      const slowest = timings.reduce((worst, timing) => (timing.ms > worst.ms ? timing : worst));
      const sorted = timings.map((timing) => timing.ms).sort((a, b) => a - b);
      console.log(
        `files.quickOpen over 100,000 files: median ${(sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(1)} ms, ` +
          `slowest ${slowest.ms.toFixed(1)} ms for "${slowest.query}" over ${String(timings.length)} keystrokes`,
      );
      expect(slowest.ms).toBeLessThan(budgetMs);
    } finally {
      client.close();
      await engine.close();
      await socket.remove();
    }
  });
});
