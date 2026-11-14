import { PicaConfig } from "@pica/protocol";
import { describe, expect, it } from "vitest";
import {
  compileManagedPolicy,
  decide,
  managedConfigLayer,
  ok,
  resolveConfig,
  userHookAgent,
  withBeforeCommitHooks,
  type GitService,
  type HookProcessRequest,
  type ManagedRule,
  type UserHookDeps,
} from "../../src/index.ts";
import { baseContext } from "../policy/fixtures.ts";

const repo = "/work/repo";

function fakeGit(commits: string[]): GitService {
  const unused = (): never => {
    throw new Error("not used");
  };
  return {
    status: unused,
    diff: unused,
    branches: unused,
    log: unused,
    stage: unused,
    push: unused,
    commit: (_repo, options) => {
      commits.push(options.message);
      return Promise.resolve(ok({ hash: "abc123" }));
    },
  };
}

// Every hook "passes": exit 0 with output claiming approval. Only the policy can stop it.
function hookDeps(beforeCommit: unknown[], managed: readonly ManagedRule[], ran: HookProcessRequest[]): UserHookDeps {
  const settings = PicaConfig.parse({ hooks: { beforeCommit } }).hooks;
  return {
    runner: {
      run: (request) => {
        ran.push(request);
        return Promise.resolve({ kind: "exited", exitCode: 0, output: '{"decision":"allow"}' });
      },
    },
    settings: () => settings,
    decide: (call, scope) => decide(call, baseContext({ managed, ...scope })),
  };
}

const noPublish: ManagedRule = { id: "acme.no-publish", reason: "Publishing is done by CI", commandPattern: /\bnpm publish\b/ };

describe("user hooks and managed policy", () => {
  it("a hook command a managed rule denies is not run and blocks the commit", async () => {
    const ran: HookProcessRequest[] = [];
    const commits: string[] = [];
    const git = withBeforeCommitHooks(fakeGit(commits), hookDeps([{ name: "release", command: "npm publish" }], [noPublish], ran));
    const result = await git.commit(repo, { message: "Release" });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "git.hook_blocked",
        message: 'commit blocked: hook "release" was not run: Publishing is done by CI (managed:acme.no-publish)',
        stderr: "",
      },
    });
    expect(ran).toEqual([]);
    expect(commits).toEqual([]);
  });

  it("a passing hook does not lift a managed denial of the same command for the agent", async () => {
    const ran: HookProcessRequest[] = [];
    const git = withBeforeCommitHooks(fakeGit([]), hookDeps([{ command: "npm test" }], [noPublish], ran));
    expect(await git.commit(repo, { message: "Change" })).toMatchObject({ ok: true });
    const agentCall = { id: "call-1", tool: "bash", agent: "main", target: { kind: "shell", command: "npm publish", cwd: repo } } as const;
    expect(decide(agentCall, baseContext({ managed: [noPublish] }))).toMatchObject({ outcome: "deny", ruleId: "managed:acme.no-publish" });
    expect(ran).toHaveLength(1);
  });

  it("a managed rule can target user hooks by agent", async () => {
    const ran: HookProcessRequest[] = [];
    const noHooks: ManagedRule = { id: "acme.no-hooks", reason: "Hooks are disabled", agents: [userHookAgent] };
    const git = withBeforeCommitHooks(fakeGit([]), hookDeps([{ command: "true" }], [noHooks], ran));
    expect(await git.commit(repo, { message: "Change" })).toMatchObject({ ok: false, error: { code: "git.hook_blocked" } });
    expect(ran).toEqual([]);
  });

  it("hooks set by the managed policy's config section ignore the user's hooks", () => {
    const compiled = compileManagedPolicy("/Library/Application Support/Pica/policy.jsonc", {
      id: "acme",
      config: { hooks: { beforeCommit: [{ name: "secret scan", command: "acme-scan" }] } },
    });
    if (!compiled.ok) {
      throw new Error(compiled.error.message);
    }
    const resolved = resolveConfig([
      { layer: "user", source: "~/.pica/config.jsonc", value: { hooks: { beforeCommit: [] } } },
      ...managedConfigLayer(compiled.value),
    ]);
    expect(resolved).toMatchObject({ ok: true });
    if (resolved.ok) {
      expect(resolved.value.config.hooks.beforeCommit).toEqual([{ name: "secret scan", command: "acme-scan", timeoutSeconds: 60 }]);
      expect(resolved.value.values.get("hooks.beforeCommit")).toMatchObject({ layer: "managed", locked: true });
    }
  });
});
