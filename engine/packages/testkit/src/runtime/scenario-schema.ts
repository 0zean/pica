import { runtimeErrorCodes } from "@pica/core";
import { z } from "zod";

const tokenCount = z.int().nonnegative();

const textStep = z
  .strictObject({
    type: z.literal("text"),
    content: z.string(),
    deltas: z.array(z.string()).min(1).optional(),
  })
  .refine((step) => step.deltas === undefined || step.deltas.join("") === step.content, {
    message: "deltas must concatenate to content",
    path: ["deltas"],
  });

const toolCallStep = z.strictObject({
  type: z.literal("toolCall"),
  name: z.string().min(1),
  arguments: z.json(),
  result: z.string(),
  success: z.boolean().default(true),
  // The tool never finishes on its own; only `abort` ends the turn.
  hangs: z.boolean().default(false),
  // The runtime's own permission flow asks the host before running the call, with this reason,
  // when the hook allowed it (A-07). A hook's ask or deny still decides first.
  asks: z.string().min(1).optional(),
});

const usageStep = z.strictObject({
  type: z.literal("usage"),
  model: z.string().min(1),
  inputTokens: tokenCount,
  cachedInputTokens: tokenCount.default(0),
  outputTokens: tokenCount,
  // What the runtime billed, as Copilot reports it on plans without token prices (S-03).
  billedCredits: z.number().nonnegative().optional(),
});

const subagentStep = z.strictObject({
  type: z.literal("subagent"),
  agentName: z.string().min(1),
  model: z.string().min(1),
  steps: z.array(z.discriminatedUnion("type", [textStep, toolCallStep, usageStep])),
  failure: z.string().min(1).optional(),
  // As the Copilot runtime does (S-02), the parent first calls `task`; the sub-agent's events carry
  // that call's id, and the call completes with the sub-agent's last text or its failure. Off by
  // default, so older scenarios keep their event streams.
  viaTask: z.boolean().default(false),
});

const contextUsageStep = z.strictObject({
  type: z.literal("contextUsage"),
  currentTokens: tokenCount,
  tokenLimit: tokenCount,
});

// The runtime's running total of credits billed in the session (Copilot's `session.usage_checkpoint`).
const usageCheckpointStep = z.strictObject({
  type: z.literal("usageCheckpoint"),
  billedCredits: z.number().nonnegative(),
});

const errorStep = z.strictObject({
  type: z.literal("error"),
  code: z.enum(runtimeErrorCodes),
  message: z.string().min(1),
});

const step = z.discriminatedUnion("type", [
  textStep,
  toolCallStep,
  usageStep,
  subagentStep,
  contextUsageStep,
  usageCheckpointStep,
  errorStep,
]);

const model = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  tokenPrices: z
    .strictObject({ input: z.number().nonnegative(), cachedInput: z.number().nonnegative(), output: z.number().nonnegative() })
    .optional(),
  contextWindow: tokenCount.optional(),
  supportsReasoningEffort: z.boolean().optional(),
});

const turn = z.strictObject({
  // When set, a different prompt makes the turn fail with `runtime.invalid_argument`.
  prompt: z.string().optional(),
  steps: z.array(step),
});

export const scenarioSchema = z
  .strictObject({
    version: z.literal(1),
    description: z.string().optional(),
    models: z.array(model).min(1),
    defaultModel: z.string().min(1),
    quota: z
      .strictObject({
        usedCredits: z.number().nonnegative(),
        entitlementCredits: z.number().nonnegative().nullable(),
        resetDate: z.string().nullable(),
      })
      .default({ usedCredits: 0, entitlementCredits: null, resetDate: null }),
    turns: z.array(turn),
  })
  .superRefine((scenario, context) => {
    const known = new Set(scenario.models.map((entry) => entry.id));
    const requireKnown = (id: string, path: (string | number)[]): void => {
      if (!known.has(id)) {
        context.addIssue({ code: "custom", message: `model "${id}" is not in models`, path });
      }
    };
    requireKnown(scenario.defaultModel, ["defaultModel"]);
    scenario.turns.forEach((entry, turnIndex) => {
      entry.steps.forEach((item, stepIndex) => {
        const path = ["turns", turnIndex, "steps", stepIndex];
        if (item.type === "usage" || item.type === "subagent") {
          requireKnown(item.model, [...path, "model"]);
        }
        if (item.type === "subagent") {
          item.steps.forEach((inner, innerIndex) => {
            if (inner.type === "usage") {
              requireKnown(inner.model, [...path, "steps", innerIndex, "model"]);
            }
          });
        }
      });
    });
  });

export type Scenario = z.output<typeof scenarioSchema>;
export type ScenarioTurn = Scenario["turns"][number];
export type ScenarioStep = ScenarioTurn["steps"][number];
export type SubagentStep = Extract<ScenarioStep, { type: "subagent" }>;
export type ToolCallStep = Extract<ScenarioStep, { type: "toolCall" }>;
