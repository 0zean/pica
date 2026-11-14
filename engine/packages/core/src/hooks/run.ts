import type { ToolCall } from "../policy/index.ts";
import type { HookProcessOutcome } from "./port.ts";
import type { HookResult, HookRunReport, HookScope, UserHook, UserHookDeps, UserHookEvent } from "./types.ts";

// The agent name a hook's command is decided under, so a managed rule can target hooks alone.
export const userHookAgent = "user-hook";

export function hookName(hook: UserHook): string {
  return hook.name ?? hook.command;
}

export function hookCall(event: UserHookEvent, index: number, hook: UserHook, cwd: string): ToolCall {
  return {
    id: `hook:${event}:${String(index)}`,
    tool: "hook",
    agent: userHookAgent,
    target: { kind: "shell", command: hook.command, cwd },
  };
}

// Hooks run one at a time, in configured order. Each command goes through the policy first: a
// denial (managed or safety) stops it from running and counts as a failure, so no hook result can
// turn a policy denial into an allowed action. Before a commit the first failure ends the run.
export async function runUserHooks(
  deps: UserHookDeps,
  event: UserHookEvent,
  scope: HookScope,
  env: Readonly<Record<string, string>>,
): Promise<HookRunReport> {
  const hooks = deps.settings()[event];
  const results: HookResult[] = [];
  for (const [index, hook] of hooks.entries()) {
    const result = await runOne(deps, event, index, hook, scope, env);
    results.push(result);
    if (result.status === "failed" && event === "beforeCommit") {
      break;
    }
  }
  const failure = results.find((result) => result.status === "failed");
  return failure?.status === "failed" ? { event, results, failure } : { event, results };
}

async function runOne(
  deps: UserHookDeps,
  event: UserHookEvent,
  index: number,
  hook: UserHook,
  scope: HookScope,
  env: Readonly<Record<string, string>>,
): Promise<HookResult> {
  const name = hookName(hook);
  const decision = deps.decide(hookCall(event, index, hook, scope.cwd), scope);
  if (decision.outcome === "deny") {
    return {
      status: "failed",
      code: "hook.denied",
      hook: name,
      message: `hook "${name}" was not run: ${decision.reason} (${decision.ruleId})`,
      output: "",
    };
  }
  const timeoutMs = hook.timeoutSeconds * 1000;
  const outcome = await deps.runner.run({
    command: hook.command,
    cwd: scope.cwd,
    timeoutMs,
    env: { ...env, PICA_HOOK_EVENT: event },
  });
  return toResult(name, hook.timeoutSeconds, outcome);
}

function toResult(name: string, timeoutSeconds: number, outcome: HookProcessOutcome): HookResult {
  switch (outcome.kind) {
    case "exited":
      return outcome.exitCode === 0
        ? { status: "passed", hook: name, output: outcome.output }
        : {
            status: "failed",
            code: "hook.failed",
            hook: name,
            message: `hook "${name}" exited with code ${String(outcome.exitCode)}`,
            output: outcome.output,
            exitCode: outcome.exitCode,
          };
    case "timed_out":
      return {
        status: "failed",
        code: "hook.timed_out",
        hook: name,
        message: `hook "${name}" ran longer than ${String(timeoutSeconds)}s and was killed`,
        output: outcome.output,
      };
    case "not_started":
      return {
        status: "failed",
        code: "hook.not_started",
        hook: name,
        message: `hook "${name}" could not start: ${outcome.message}`,
        output: "",
      };
  }
}
