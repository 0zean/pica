export interface HookProcessRequest {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs: number;
  // Added to the engine's environment for the hook.
  readonly env: Readonly<Record<string, string>>;
}

// `output` is stdout and stderr interleaved as the hook wrote them, possibly trimmed to its tail.
export type HookProcessOutcome =
  | { readonly kind: "exited"; readonly exitCode: number; readonly output: string }
  | { readonly kind: "timed_out"; readonly output: string }
  | { readonly kind: "not_started"; readonly message: string };

// Runs one hook command. A hook still running at its timeout is killed with its process group.
// Never throws.
export interface HookProcessRunner {
  run(request: HookProcessRequest): Promise<HookProcessOutcome>;
}
