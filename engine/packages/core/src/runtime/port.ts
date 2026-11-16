import type { JsonObject, JsonValue } from "../json.ts";
import type { Result } from "../result.ts";
import type { RuntimeError } from "./errors.ts";
import type { RuntimeEventListener } from "./events.ts";
import type { RuntimeHooks } from "./hooks.ts";

export type RuntimeResult<T> = Promise<Result<T, RuntimeError>>;

// Credits per million tokens (1 credit = $0.01), as listed by `models.list` billing.
export interface TokenPrices {
  readonly input: number;
  readonly cachedInput: number;
  readonly output: number;
}

export interface RuntimeModel {
  readonly id: string;
  readonly name: string;
  readonly tokenPrices?: TokenPrices;
  readonly contextWindow?: number;
  // Whether the model takes a reasoning-effort setting, as the runtime reports its capabilities.
  readonly supportsReasoningEffort?: boolean;
}

// The account's AI-credit quota. `entitlementCredits` is null when the entitlement is unlimited.
export interface QuotaInfo {
  readonly usedCredits: number;
  readonly entitlementCredits: number | null;
  readonly resetDate: string | null;
}

// The signed-in account. `authType` names the credential source (for Copilot: `user` for a Copilot
// CLI login, `gh-cli` for the GitHub CLI token, `env`, `token`, ...); null fields were not reported.
export interface RuntimeAccount {
  readonly login: string | null;
  readonly authType: string | null;
  readonly host: string | null;
}

export interface ModelUsage {
  readonly model: string;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly calls: number;
}

// Totals over every `assistant.usage` in the session; `byModel` is sorted by model id.
export interface UsageMetrics {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly byModel: readonly ModelUsage[];
}

export interface CustomAgentDefinition {
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
  readonly model?: string;
  readonly tools?: readonly string[];
}

// A tool the engine implements itself (R-08). `invoke` never throws; a failure is `ok: false`
// with text the model can read. `parameters` is a JSON Schema object.
export interface EngineTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonObject;
  invoke(args: JsonValue): Promise<EngineToolOutput>;
}

export interface EngineToolOutput {
  readonly ok: boolean;
  readonly text: string;
}

export interface SessionOptions {
  // Lets the caller use its own id for the runtime session; the runtime picks one when absent.
  readonly sessionId?: string;
  readonly workingDirectory: string;
  readonly model?: string;
  readonly customAgents?: readonly CustomAgentDefinition[];
  readonly excludedTools?: readonly string[];
  readonly tools?: readonly EngineTool[];
  readonly maxAiCredits?: number;
  readonly hooks?: RuntimeHooks;
}

export interface ResumeOptions extends SessionOptions {
  readonly sessionId: string;
}

// `send` returns once the prompt is accepted; the turn's outcome arrives as events and ends
// with `session.idle`. Only one turn runs at a time. Methods never throw.
export interface RuntimeSession {
  readonly id: string;
  subscribe(listener: RuntimeEventListener): () => void;
  send(prompt: string): RuntimeResult<{ readonly messageId: string }>;
  abort(): RuntimeResult<undefined>;
  resolvePermission(requestId: string, approved: boolean): RuntimeResult<undefined>;
  // Answers `session_limits_exhausted.requested`: a number raises the limit to it and lets the
  // blocked call run; null cancels that call and ends the turn.
  resolveSessionLimit(requestId: string, maxAiCredits: number | null): RuntimeResult<undefined>;
  usage(): RuntimeResult<UsageMetrics>;
  close(): RuntimeResult<undefined>;
}

export interface AgentRuntime {
  // The lowest `maxAiCredits` the runtime accepts; a lower session limit is enforced by the engine
  // instead (S-03: Copilot refuses limits under 30). Absent means any limit is accepted.
  readonly minSessionCredits?: number | undefined;
  listModels(): RuntimeResult<readonly RuntimeModel[]>;
  // Absent for runtimes with no signed-in account. Fails with `runtime.no_models` when the account
  // is signed in but offered no models, so the host can show a sign-in hint (S-01).
  account?(): RuntimeResult<RuntimeAccount>;
  // null when the plan reports no AI-credit quota: Copilot Free counts requests, not credits (S-01).
  quota(): RuntimeResult<QuotaInfo | null>;
  createSession(options: SessionOptions): RuntimeResult<RuntimeSession>;
  resumeSession(options: ResumeOptions): RuntimeResult<RuntimeSession>;
}
