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
}

export interface QuotaInfo {
  readonly usedCredits: number;
  readonly entitlementCredits: number | null;
  readonly resetDate: string | null;
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

export interface SessionOptions {
  // Lets the caller use its own id for the runtime session; the runtime picks one when absent.
  readonly sessionId?: string;
  readonly workingDirectory: string;
  readonly model?: string;
  readonly customAgents?: readonly CustomAgentDefinition[];
  readonly excludedTools?: readonly string[];
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
  listModels(): RuntimeResult<readonly RuntimeModel[]>;
  quota(): RuntimeResult<QuotaInfo>;
  createSession(options: SessionOptions): RuntimeResult<RuntimeSession>;
  resumeSession(options: ResumeOptions): RuntimeResult<RuntimeSession>;
}
