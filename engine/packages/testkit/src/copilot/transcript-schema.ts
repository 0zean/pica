import { z } from "zod";

// A transcript describes what the Copilot runtime says on the wire, in the SDK's own shapes
// (`@github/copilot-sdk` generated types). The replay server answers the SDK's requests from it.
// See docs/copilot-replay.md for which shapes are recorded and which are inferred.

const jsonObject = z.record(z.string(), z.json());

const rpcError = z.strictObject({
  code: z.int(),
  message: z.string().min(1),
  data: z.json().optional(),
});

// One `session.event` notification. The server fills in `id`, `timestamp`, and `parentId`.
const eventFrame = z.strictObject({
  event: z.strictObject({
    type: z.string().min(1),
    data: jsonObject,
    agentId: z.string().min(1).optional(),
    ephemeral: z.boolean().optional(),
  }),
});

// A tool call. Its events and hook requests depend on the client's hook answers, so the server
// generates them: execution_start, preToolUse, an optional permission prompt, the nested frames
// (a sub-agent's work, for the `task` tool), postToolUse, and execution_complete.
const toolFields = {
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  arguments: z.json(),
  result: z.string(),
  agentId: z.string().min(1).optional(),
  // The tool never finishes on its own; only `session.abort` ends the turn.
  hangs: z.boolean().default(false),
};

const innerToolFrame = z.strictObject({ tool: z.strictObject(toolFields) });

const toolFrame = z.strictObject({
  tool: z.strictObject({ ...toolFields, frames: z.array(z.union([eventFrame, innerToolFrame])).default([]) }),
});

const frame = z.union([eventFrame, toolFrame]);

export const transcriptSchema = z.strictObject({
  version: z.literal(1),
  provenance: z.enum(["recorded", "inferred"]),
  protocolVersion: z.int().positive().default(3),
  auth: jsonObject,
  models: z.array(jsonObject),
  // `models.listTokenPriceUnits` entries. Absent means every model with `billing.tokenPrices`
  // quotes them in AI Credits.
  tokenPriceUnits: z.array(z.strictObject({ modelId: z.string().min(1), unit: z.enum(["ai_credits", "nano_aiu"]) })).optional(),
  quota: jsonObject.default({ quotaSnapshots: {} }),
  // Requests answered with a JSON-RPC error instead of their normal result, keyed by method.
  rpcErrors: z.record(z.string(), rpcError).default({}),
  // Each `session.send` plays the next turn. The server adds `user.message` first and
  // `session.idle` last.
  turns: z.array(z.strictObject({ frames: z.array(frame) })),
});

export type Transcript = z.output<typeof transcriptSchema>;
export type TranscriptFrame = Transcript["turns"][number]["frames"][number];
export type TranscriptEvent = z.output<typeof eventFrame>["event"];
export type TranscriptTool = z.output<typeof innerToolFrame>["tool"] & { readonly frames?: readonly PlayableFrame[] };
export type PlayableFrame = { readonly event: TranscriptEvent } | { readonly tool: TranscriptTool };
export type RpcErrorBody = z.output<typeof rpcError>;
