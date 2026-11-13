import {
  runtimeErrorCodes,
  type AgentRuntime,
  type PostToolUseInput,
  type RuntimeEvent,
  type RuntimeEventOf,
  type RuntimeEventType,
  type RuntimeHooks,
  type RuntimeSession,
  type ToolUseInput,
} from "@pica/core";
import { describe, expect, it } from "vitest";
import { recordTurn, type RecordedTurn } from "./turn-recorder.ts";

// Each fixture is a runtime set up to behave as described. FakeRuntime reads a scenario file of
// the same name; a replay-backed adapter (E-09) reads a recorded transcript of the same name.
export const contractFixtures = {
  "text-reply": "Two turns, each answered with streamed text, one usage record, and context usage.",
  "tool-call": "One turn with two tool calls followed by text.",
  subagent: "One turn that delegates to a sub-agent which makes one tool call and reports usage.",
  "ask-permission": "One turn with a single tool call.",
  "runtime-error": "One turn that fails with a runtime error.",
  "hanging-tool": "One turn whose tool call does not finish until aborted.",
} as const;

export type ContractFixture = keyof typeof contractFixtures;

export interface RuntimeContractHarness {
  readonly name: string;
  readonly workingDirectory: string;
  createRuntime(fixture: ContractFixture): Promise<AgentRuntime>;
}

const prompt = "contract prompt";

function ofType<T extends RuntimeEventType>(
  events: readonly RuntimeEvent[],
  type: T,
): Extract<RuntimeEvent, { type: T }>[] {
  return events.filter((event): event is Extract<RuntimeEvent, { type: T }> => event.type === type);
}

function expectWellFormedTurn(turn: RecordedTurn): void {
  const types = turn.events.map((event) => event.type);
  expect(types[0]).toBe("user.message");
  expect(types.at(-1)).toBe("session.idle");
  expect(types.filter((type) => type === "session.idle")).toHaveLength(1);
  const ids = turn.events.map((event) => event.id);
  expect(new Set(ids).size).toBe(ids.length);
  const times = turn.events.map((event) => Date.parse(event.timestamp));
  expect(times.every((time) => Number.isFinite(time))).toBe(true);
  expect([...times].sort((a, b) => a - b)).toEqual(times);
  const started = ofType(turn.events, "tool.execution_start").map((event) => event.data.toolCallId);
  const completed = ofType(turn.events, "tool.execution_complete").map((event) => event.data.toolCallId);
  expect([...completed].sort()).toEqual([...started].sort());
}

function unwrapTurn(result: Awaited<ReturnType<typeof recordTurn>>): RecordedTurn {
  if (!result.ok) {
    throw new Error(`send failed: ${result.error.code}: ${result.error.message}`);
  }
  expectWellFormedTurn(result.value);
  return result.value;
}

export function runtimeContractSuite(harness: RuntimeContractHarness): void {
  async function open(fixture: ContractFixture, hooks: RuntimeHooks = {}): Promise<[AgentRuntime, RuntimeSession]> {
    const runtime = await harness.createRuntime(fixture);
    const created = await runtime.createSession({ workingDirectory: harness.workingDirectory, hooks });
    if (!created.ok) {
      throw new Error(`createSession failed: ${created.error.code}`);
    }
    return [runtime, created.value];
  }

  function recordingHooks(pre: RuntimeHooks["onPreToolUse"], post?: RuntimeHooks["onPostToolUse"]) {
    const preCalls: ToolUseInput[] = [];
    const postCalls: PostToolUseInput[] = [];
    const hooks: RuntimeHooks = {
      onPreToolUse: async (input) => {
        preCalls.push(input);
        return pre === undefined ? { decision: "allow" } : pre(input);
      },
      onPostToolUse: async (input) => {
        postCalls.push(input);
        return post === undefined ? { kind: "keep" } : post(input);
      },
    };
    return { hooks, preCalls, postCalls };
  }

  describe(`AgentRuntime contract: ${harness.name}`, () => {
    describe("models and quota", () => {
      it("lists at least one model with unique ids and valid prices", async () => {
        const runtime = await harness.createRuntime("text-reply");
        const models = await runtime.listModels();
        expect(models.ok).toBe(true);
        if (!models.ok) return;
        expect(models.value.length).toBeGreaterThan(0);
        expect(new Set(models.value.map((model) => model.id)).size).toBe(models.value.length);
        for (const model of models.value) {
          expect(model.name.length).toBeGreaterThan(0);
          for (const price of Object.values(model.tokenPrices ?? {})) {
            expect(price).toBeGreaterThanOrEqual(0);
          }
        }
      });

      it("reports quota", async () => {
        const quota = await (await harness.createRuntime("text-reply")).quota();
        expect(quota.ok).toBe(true);
        if (quota.ok) expect(quota.value.usedCredits).toBeGreaterThanOrEqual(0);
      });

      it("refuses a session on an unknown model", async () => {
        const runtime = await harness.createRuntime("text-reply");
        const created = await runtime.createSession({
          workingDirectory: harness.workingDirectory,
          model: "contract-no-such-model",
        });
        expect(created.ok ? undefined : created.error.code).toBe("runtime.model_unavailable");
      });
    });

    describe("turns", () => {
      it("streams text that matches the final message, twice in a row", async () => {
        const [, session] = await open("text-reply");
        for (let turn = 0; turn < 2; turn += 1) {
          const { events } = unwrapTurn(await recordTurn(session, prompt));
          const messages = ofType(events, "assistant.message");
          expect(messages.length).toBeGreaterThan(0);
          for (const message of messages) {
            expect(message.data.content.length).toBeGreaterThan(0);
            const deltas = ofType(events, "assistant.message_delta").filter(
              (delta) => delta.data.messageId === message.data.messageId,
            );
            if (deltas.length > 0) {
              expect(deltas.map((delta) => delta.data.deltaContent).join("")).toBe(message.data.content);
            }
          }
          expect(ofType(events, "session.usage_info").every((info) => info.data.tokenLimit > 0)).toBe(true);
        }
      });

      it("rejects a second send while a turn runs, and abort ends the turn", async () => {
        const [, session] = await open("hanging-tool");
        let busyCode: string | undefined;
        const turn = await recordTurn(session, prompt, (event) => {
          if (event.type === "tool.execution_start") {
            void session.send(prompt).then(async (second) => {
              busyCode = second.ok ? "accepted" : second.error.code;
              await session.abort();
            });
          }
        });
        const { events } = unwrapTurn(turn);
        expect(busyCode).toBe("runtime.session_busy");
        const types = events.map((event) => event.type);
        expect(types).toContain("abort");
        expect(types.indexOf("abort")).toBeLessThan(types.indexOf("session.idle"));
        expect(ofType(events, "tool.execution_complete").every((event) => !event.data.success)).toBe(true);
      });

      it("treats abort while idle as a no-op", async () => {
        const [, session] = await open("text-reply");
        expect((await session.abort()).ok).toBe(true);
      });

      it("surfaces a runtime error with a stable code and returns to idle", async () => {
        const [, session] = await open("runtime-error");
        const { events } = unwrapTurn(await recordTurn(session, prompt));
        const errors = ofType(events, "session.error");
        expect(errors.length).toBeGreaterThan(0);
        for (const error of errors) {
          expect(runtimeErrorCodes).toContain(error.data.code);
        }
      });
    });

    describe("hooks", () => {
      it("calls both hooks once per tool call with the call's name and arguments", async () => {
        const { hooks, preCalls, postCalls } = recordingHooks(undefined);
        const [, session] = await open("tool-call", hooks);
        const { events } = unwrapTurn(await recordTurn(session, prompt));
        const starts = ofType(events, "tool.execution_start");
        expect(starts.length).toBeGreaterThan(0);
        expect(preCalls.map((call) => [call.toolCallId, call.toolName, call.arguments])).toEqual(
          starts.map((start) => [start.data.toolCallId, start.data.toolName, start.data.arguments]),
        );
        expect(postCalls.map((call) => call.toolCallId)).toEqual(starts.map((start) => start.data.toolCallId));
        for (const call of [...preCalls, ...postCalls]) {
          expect(call.sessionId).toBe(session.id);
        }
      });

      it("does not run a denied tool and reports the reason", async () => {
        const { hooks, postCalls } = recordingHooks(() => Promise.resolve({ decision: "deny", reason: "contract-deny" }));
        const [, session] = await open("tool-call", hooks);
        const { events } = unwrapTurn(await recordTurn(session, prompt));
        const completes = ofType(events, "tool.execution_complete");
        expect(completes.length).toBeGreaterThan(0);
        for (const complete of completes) {
          expect(complete.data.success).toBe(false);
          expect(complete.data.result.content).toContain("contract-deny");
        }
        expect(postCalls).toHaveLength(0);
      });

      it("replaces a tool result with the post hook's modified result", async () => {
        const { hooks } = recordingHooks(undefined, (input) =>
          Promise.resolve({ kind: "modify", result: { content: `modified:${input.toolCallId}` } }),
        );
        const [, session] = await open("tool-call", hooks);
        const { events } = unwrapTurn(await recordTurn(session, prompt));
        for (const complete of ofType(events, "tool.execution_complete")) {
          expect(complete.data.result.content).toBe(`modified:${complete.data.toolCallId}`);
        }
      });

      it("treats a throwing pre hook as a deny without breaking the turn", async () => {
        const [, session] = await open("tool-call", {
          onPreToolUse: () => Promise.reject(new Error("contract-hook-failure")),
        });
        const { events } = unwrapTurn(await recordTurn(session, prompt));
        expect(ofType(events, "tool.execution_complete").every((event) => !event.data.success)).toBe(true);
      });

      it("fires hooks for tool calls inside a sub-agent", async () => {
        const { hooks, preCalls } = recordingHooks(undefined);
        const [, session] = await open("subagent", hooks);
        const { events } = unwrapTurn(await recordTurn(session, prompt));
        const started = ofType(events, "subagent.started");
        expect(started.length).toBeGreaterThan(0);
        expect(preCalls.length).toBe(ofType(events, "tool.execution_start").length);
        for (const start of started) {
          const ends = events.filter(
            (event) =>
              (event.type === "subagent.completed" || event.type === "subagent.failed") &&
              event.data.toolCallId === start.data.toolCallId,
          );
          expect(ends).toHaveLength(1);
          expect(events.indexOf(start)).toBeLessThan(events.indexOf(ends[0] as RuntimeEvent));
        }
      });
    });

    describe("permissions", () => {
      for (const approved of [true, false]) {
        it(`runs the tool only when an ask is ${approved ? "approved" : "declined"}`, async () => {
          const { hooks } = recordingHooks(() => Promise.resolve({ decision: "ask", reason: "contract-ask" }));
          const [, session] = await open("ask-permission", hooks);
          const answers: Promise<unknown>[] = [];
          const { events } = unwrapTurn(
            await recordTurn(session, prompt, (event) => {
              if (event.type === "permission.requested") {
                answers.push(session.resolvePermission(event.data.requestId, approved));
              }
            }),
          );
          await Promise.all(answers);
          const requests = ofType(events, "permission.requested");
          expect(requests).toHaveLength(1);
          const request = requests[0] as RuntimeEventOf<"permission.requested">;
          const complete = ofType(events, "tool.execution_complete").find(
            (event) => event.data.toolCallId === request.data.toolCallId,
          );
          expect(complete?.data.success).toBe(approved);
          const again = await session.resolvePermission(request.data.requestId, approved);
          expect(again.ok ? undefined : again.error.code).toBe("runtime.permission_not_found");
        });
      }
    });

    describe("usage", () => {
      it("totals match the turn's usage records and use listed models", async () => {
        const [runtime, session] = await open("subagent");
        const { events } = unwrapTurn(await recordTurn(session, prompt));
        const records = ofType(events, "assistant.usage");
        expect(records.length).toBeGreaterThan(0);
        const models = await runtime.listModels();
        const listed = new Set(models.ok ? models.value.map((model) => model.id) : []);
        for (const record of records) {
          expect(listed.has(record.data.model)).toBe(true);
          for (const count of [record.data.inputTokens, record.data.cachedInputTokens, record.data.outputTokens]) {
            expect(Number.isInteger(count) && count >= 0).toBe(true);
          }
        }
        const usage = await session.usage();
        expect(usage.ok).toBe(true);
        if (!usage.ok) return;
        const sum = (pick: (data: RuntimeEventOf<"assistant.usage">["data"]) => number): number =>
          records.reduce((total, record) => total + pick(record.data), 0);
        expect(usage.value.inputTokens).toBe(sum((data) => data.inputTokens));
        expect(usage.value.cachedInputTokens).toBe(sum((data) => data.cachedInputTokens));
        expect(usage.value.outputTokens).toBe(sum((data) => data.outputTokens));
        expect(usage.value.byModel.map((entry) => entry.model)).toEqual(
          [...new Set(records.map((record) => record.data.model))].sort(),
        );
      });
    });

    describe("session lifecycle", () => {
      it("resumes a session by id and refuses an unknown id", async () => {
        const [runtime, session] = await open("text-reply");
        unwrapTurn(await recordTurn(session, prompt));
        expect((await session.close()).ok).toBe(true);
        const resumed = await runtime.resumeSession({ sessionId: session.id, workingDirectory: harness.workingDirectory });
        expect(resumed.ok ? resumed.value.id : resumed.error.code).toBe(session.id);
        const unknown = await runtime.resumeSession({
          sessionId: "contract-no-such-session",
          workingDirectory: harness.workingDirectory,
        });
        expect(unknown.ok ? undefined : unknown.error.code).toBe("runtime.session_not_found");
      });

      it("refuses to send on a closed session", async () => {
        const [, session] = await open("text-reply");
        await session.close();
        const sent = await session.send(prompt);
        expect(sent.ok ? undefined : sent.error.code).toBe("runtime.session_closed");
      });
    });
  });
}
