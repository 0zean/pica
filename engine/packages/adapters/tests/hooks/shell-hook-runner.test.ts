import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PicaConfig } from "@pica/protocol";
import { decide, runUserHooks, type HookScope, type PolicyContext } from "@pica/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createShellHookRunner, type HookTimer } from "../../src/index.ts";

// A timer the test fires itself, so no test waits on the wall clock.
function manualTimer(): { readonly timer: HookTimer; fire(): void; readonly started: number[]; cancelled: number } {
  const pending: (() => void)[] = [];
  const state = {
    started: [] as number[],
    cancelled: 0,
    timer: ((ms, onTimeout) => {
      state.started.push(ms);
      pending.push(onTimeout);
      return () => {
        state.cancelled += 1;
      };
    }) as HookTimer,
    fire: () => {
      for (const onTimeout of pending.splice(0)) {
        onTimeout();
      }
    },
  };
  return state;
}

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "pica-hooks-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const request = (command: string) => ({ command, cwd, timeoutMs: 5000, env: { PICA_HOOK_EVENT: "beforeCommit" } });

describe("createShellHookRunner", () => {
  it("returns the exit code and stdout and stderr in the order written, and cancels its timer", async () => {
    const clock = manualTimer();
    const runner = createShellHookRunner({ timer: clock.timer });
    const outcome = await runner.run(request('echo "checking"; echo "lint: 2 errors" >&2; exit 3'));
    expect(outcome).toEqual({ kind: "exited", exitCode: 3, output: "checking\nlint: 2 errors\n" });
    expect(clock.started).toEqual([5000]);
    expect(clock.cancelled).toBe(1);
  });

  it("passes the hook its environment and working directory", async () => {
    const runner = createShellHookRunner({ timer: manualTimer().timer });
    const outcome = await runner.run(request('printf "%s %s" "$PICA_HOOK_EVENT" "$(basename "$PWD")"'));
    expect(outcome).toEqual({ kind: "exited", exitCode: 0, output: `beforeCommit ${cwd.split("/").pop() ?? ""}` });
  });

  // `sleep` is a grandchild that holds the output pipe: the run only ends if the whole group dies.
  it("kills a hook and everything it started when its timeout fires, and reports the timeout", async () => {
    const clock = manualTimer();
    const runner = createShellHookRunner({ timer: clock.timer });
    const running = runner.run(request("sleep 600 & wait"));
    clock.fire();
    expect(await running).toEqual({ kind: "timed_out", output: "" });
  });

  it("reports a timed-out hook as failed and killed through runUserHooks", async () => {
    const clock = manualTimer();
    const settings = PicaConfig.parse({ hooks: { sessionEnd: [{ name: "upload logs", command: "sleep 600 & wait", timeoutSeconds: 2 }] } }).hooks;
    const scope: HookScope = { cwd, writeRoots: [cwd], referenceRoots: [] };
    const context: Omit<PolicyContext, keyof HookScope> = { config: PicaConfig.parse({}), managed: [], commandDenyList: [] };
    const running = runUserHooks(
      { runner: createShellHookRunner({ timer: clock.timer }), settings: () => settings, decide: (call, roots) => decide(call, { ...context, ...roots }) },
      "sessionEnd",
      scope,
      {},
    );
    await expectTimerStarted(clock);
    clock.fire();
    const report = await running;
    expect(clock.started).toEqual([2000]);
    expect(report.failure).toMatchObject({
      code: "hook.timed_out",
      hook: "upload logs",
      message: 'hook "upload logs" ran longer than 2s and was killed',
    });
  });

  it("trims long output to its tail", async () => {
    const runner = createShellHookRunner({ timer: manualTimer().timer, maxOutputBytes: 4 });
    const outcome = await runner.run(request("printf 0123456789"));
    expect(outcome).toEqual({ kind: "exited", exitCode: 0, output: "[… 6 bytes trimmed]\n6789" });
  });

  it("reports a shell that cannot start", async () => {
    const runner = createShellHookRunner({ shell: join(cwd, "no-such-shell"), timer: manualTimer().timer });
    expect(await runner.run(request("true"))).toMatchObject({ kind: "not_started" });
  });
});

// runUserHooks decides the policy before it starts the process; wait for the timer it arms.
async function expectTimerStarted(clock: { readonly started: number[] }): Promise<void> {
  while (clock.started.length === 0) {
    await Promise.resolve();
  }
}
