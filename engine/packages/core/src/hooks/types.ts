import type { PicaConfig, UserHook, UserHookEvent } from "@pica/protocol";
import type { PolicyDecision, ToolCall } from "../policy/index.ts";
import type { HookProcessRunner } from "./port.ts";

export type { UserHook, UserHookEvent };
export type UserHookSettings = PicaConfig["hooks"];

// The roots the policy sees when it decides a hook's command.
export interface HookScope {
  readonly cwd: string;
  readonly writeRoots: readonly string[];
  readonly referenceRoots: readonly string[];
}

export interface UserHookDeps {
  readonly runner: HookProcessRunner;
  // Read on every event so a reloaded config applies to the next one.
  readonly settings: () => UserHookSettings;
  readonly decide: (call: ToolCall, scope: HookScope) => PolicyDecision;
}

export type HookErrorCode = "hook.failed" | "hook.timed_out" | "hook.not_started" | "hook.denied";

export type HookResult =
  | { readonly status: "passed"; readonly hook: string; readonly output: string }
  | {
      readonly status: "failed";
      readonly code: HookErrorCode;
      readonly hook: string;
      readonly message: string;
      readonly output: string;
      readonly exitCode?: number;
    };

export interface HookRunReport {
  readonly event: UserHookEvent;
  readonly results: readonly HookResult[];
  // The first hook that did not pass. Before a commit it also ends the run.
  readonly failure?: Extract<HookResult, { status: "failed" }>;
}
