import { describe, expect, it } from "vitest";
import { createFanOutService, err, ok } from "../../src/index.ts";
import type { FanOutInfo, FanOutServiceDeps, Repo, SessionInfo, WorkspaceService } from "../../src/index.ts";

function repo(id: string): Repo {
  return { id, remoteUrl: `github.com/acme/${id}`, localPath: `/src/${id}`, managed: true, defaultBranch: "main", cloneState: "ready" };
}

type Deps = { -readonly [K in keyof FanOutServiceDeps]: FanOutServiceDeps[K] } & { created: string[] };

function deps(workspaces: Pick<WorkspaceService, "repos" | "ensureCloned">): Deps {
  const created: string[] = [];
  return {
    created,
    workspaces,
    sessions: {
      create: (request) => {
        created.push(request.writeRepoIds[0] ?? "");
        return Promise.resolve(ok({ id: `s-${String(created.length)}`, lastSeq: 1 } as SessionInfo));
      },
      send: () => Promise.resolve(ok({ accepted: true })),
      abort: () => Promise.resolve(ok(undefined)),
    },
    events: { subscribe: () => ({ close: () => undefined }) },
    clock: () => "2026-11-14T09:00:00.000Z",
    newFanOutId: () => "f1",
  };
}

const members: Pick<WorkspaceService, "repos" | "ensureCloned"> = {
  repos: (workspaceId) =>
    workspaceId === "ws-1"
      ? ok([repo("r1"), repo("r2")])
      : err({ code: "workspace.not_found", message: `workspace ${String(workspaceId)} not found` }),
  ensureCloned: (repoId) =>
    Promise.resolve(
      repoId === "r2" ? err({ code: "workspace.clone_failed", message: "clone of r2 failed" }) : ok(repo(repoId)),
    ),
};

describe("fan-out over workspace repos (R-06)", () => {
  it("rejects repos outside the workspace and an unknown workspace", () => {
    const service = createFanOutService(deps(members));
    const outside = service.start({ workspaceId: "ws-1", repoIds: ["r1", "r9"], prompt: "go" });
    expect(outside).toMatchObject({ ok: false, error: { code: "fanout.invalid_request", message: "not in workspace ws-1: r9" } });
    const unknown = service.start({ workspaceId: "ws-2", repoIds: ["r1"], prompt: "go" });
    expect(unknown).toMatchObject({ ok: false, error: { code: "fanout.not_found" } });
  });

  it("clones each repo before its session starts and reports a failed clone as that run's result", async () => {
    const service = deps(members);
    const cloneFailed = new Promise<FanOutInfo>((resolve) => {
      service.onChanged = (info) => {
        if (info.runs[0]?.status === "failed" && info.runs[1]?.sessionId !== null) {
          resolve(info);
        }
      };
    });
    const fanOuts = createFanOutService(service);
    const started = fanOuts.start({ workspaceId: "ws-1", repoIds: ["r2", "r1"], prompt: "go", concurrency: 2 });
    expect(started.ok).toBe(true);
    const info = await cloneFailed;
    expect(info.runs[0]).toEqual({
      repoId: "r2",
      sessionId: null,
      status: "failed",
      error: { code: "workspace.clone_failed", message: "clone of r2 failed" },
    });
    expect(service.created).toEqual(["r1"]);
  });
});
