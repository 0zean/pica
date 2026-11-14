import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEventLog, createRepoTools, createSessionService, ok, repoEngineTools, repoToolNames } from "@pica/core";
import type { AgentRuntime, SessionOptions, Store } from "@pica/core";
import { FakeRuntime, scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import { createGitRepoFiles, openSqliteStore, realPath } from "../../src/index.ts";
import { toSdkTools } from "../../src/copilot/engine-tools.ts";
import { makeRepoToolsFixture, type RepoToolsFixture } from "./fixture.ts";

let fixture: RepoToolsFixture;
let store: Store;
beforeAll(() => {
  fixture = makeRepoToolsFixture();
  const opened = openSqliteStore(join(fixture.root, "pica.db"));
  if (!opened.ok) throw new Error(opened.error.message);
  store = opened.value;
  for (const repo of fixture.repos) store.repos.save(repo);
  store.workspaces.save({ id: "ws-1", name: "Acme", sources: [], pinnedRepoIds: fixture.repos.map((repo) => repo.id), settingsOverrides: {} });
});
afterAll(() => {
  store.close();
  fixture.cleanup();
});

describe("repo tools in a session (R-08)", () => {
  it("are handed to the runtime for the session's workspace", async () => {
    const scenario = scenarioSchema.parse({ version: 1, models: [{ id: "m", name: "M" }], defaultModel: "m", turns: [] });
    const fake = new FakeRuntime({ scenario });
    const seen: SessionOptions[] = [];
    const runtime: AgentRuntime = {
      listModels: () => fake.listModels(),
      quota: () => fake.quota(),
      createSession: (options) => {
        seen.push(options);
        return fake.createSession(options);
      },
      resumeSession: (options) => fake.resumeSession(options),
    };
    const ids = sequentialIds();
    const sessions = createSessionService({
      store,
      events: createEventLog(store.events),
      runtime,
      clock: steppingClock("2026-11-14T09:00:00.000Z"),
      newSessionId: () => ids("session"),
      tools: (session) =>
        repoEngineTools(
          createRepoTools({
            repos: () => {
              const workspace = store.workspaces.get(session.workspaceId);
              return Promise.resolve(ok(workspace.ok ? fixture.repos.filter((repo) => workspace.value.pinnedRepoIds.includes(repo.id)) : []));
            },
            files: createGitRepoFiles(),
            realPath,
          }),
        ),
    });
    const [api] = fixture.repos.filter((repo) => repo.id === "repo-api");
    const created = await sessions.create({ workspaceId: "ws-1", writeRepoIds: [api?.id ?? ""], referenceRepoIds: [] });
    expect(created.ok).toBe(true);
    const tools = seen[0]?.tools ?? [];
    expect(tools.map((tool) => tool.name)).toEqual([...repoToolNames]);
    const list = await tools[0]?.invoke({});
    expect(list).toEqual({ ok: true, text: "api (acme/api)\ndocs (acme/docs)\nweb (acme/web)" });
    await sessions.end(created.ok ? created.value.id : "");
  });

  it("map to SDK tools whose failures stay readable", async () => {
    const [read] = toSdkTools(repoEngineTools(fixture.tools()).filter((tool) => tool.name === "repo_read"));
    const result = await read?.handler?.({ repo: "api", path: "/etc/passwd" }, { sessionId: "s", toolCallId: "t", toolName: "repo_read", arguments: {} });
    expect(read?.parameters).toMatchObject({ type: "object", required: ["repo", "path"] });
    expect(result).toMatchObject({ resultType: "failure" });
    expect(JSON.stringify(result)).toContain('"textResultForLlm":"repo_tools.outside_workspace:');
  });
});
