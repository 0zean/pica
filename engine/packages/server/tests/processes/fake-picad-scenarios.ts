// The FakeRuntime scenarios `fake-picad.ts` can run, chosen with PICA_TEST_SCENARIO. Each session plays
// the scenario's turns in order, one per message sent to it.
import type { Scenario } from "@pica/testkit";

type Turn = Scenario["turns"][number];
type Step = Turn["steps"][number];
type TextStep = Extract<Step, { type: "text" }>;
type ToolCallStep = Extract<Step, { type: "toolCall" }>;
type UsageStep = Extract<Step, { type: "usage" }>;

const models: Scenario["models"] = [
  { id: "model-a", name: "Model A", tokenPrices: { input: 1, cachedInput: 0.1, output: 4 }, contextWindow: 128_000 },
  { id: "model-b", name: "Model B" },
];

function scenario(turns: Turn[]): Scenario {
  return {
    version: 1,
    models,
    defaultModel: "model-a",
    quota: { usedCredits: 0, entitlementCredits: null, resetDate: null },
    turns,
  };
}

function words(count: number, seed: number): string {
  const vocabulary = ["the", "router", "reads", "a", "file", "and", "tier", "agent", "returns", "diff", "test", "cache"];
  return Array.from({ length: count }, (_, index) => vocabulary[(index * 7 + seed) % vocabulary.length]).join(" ");
}

/** Markdown text streamed as `pieces` deltas. */
function streamedText(content: string, pieces: number): TextStep {
  const size = Math.ceil(content.length / pieces);
  const deltas = Array.from({ length: Math.ceil(content.length / size) }, (_, index) =>
    content.slice(index * size, (index + 1) * size),
  );
  return { type: "text", content, deltas };
}

function toolCall(name: string, argument: string, result: string, success = true): ToolCallStep {
  return { type: "toolCall", name, arguments: { path: argument }, result, success, hangs: false };
}

function usage(inputTokens: number, outputTokens: number): UsageStep {
  return { type: "usage", model: "model-a", inputTokens, cachedInputTokens: 0, outputTokens };
}

/** One ordinary turn: an answer in Markdown, a few tool calls, and the model's usage. About 30 events. */
function workTurn(index: number): Turn {
  const answer =
    `### Step ${String(index + 1)}\n\n` +
    `${words(24, index)}, with **bold** and \`code\`.\n\n` +
    `- ${words(6, index + 1)}\n- ${words(5, index + 2)}\n\n` +
    "```swift\nlet value = route(call)\n```\n";
  return {
    steps: [
      streamedText(answer, 12),
      toolCall("view", `src/file-${String(index)}.ts`, words(30, index)),
      toolCall("grep", "src", words(12, index + 3)),
      toolCall("edit", `src/file-${String(index)}.ts`, "edited"),
      usage(1_200 + index, 300),
      { type: "contextUsage", currentTokens: 20_000 + index * 10, tokenLimit: 128_000 },
      streamedText(words(40, index + 5), 6),
    ],
  };
}

/** A turn that delegates to a sub-agent through `task`, as Copilot does. */
function delegatingTurn(): Turn {
  return {
    steps: [
      streamedText("Delegating the search to a cheaper agent.", 3),
      {
        type: "subagent",
        agentName: "bulk-reader",
        model: "model-b",
        viaTask: true,
        steps: [toolCall("grep", "src", "12 matches"), streamedText("Found 12 matches in 4 files.", 2)],
      },
      toolCall("view", "missing.ts", "no such file", false),
      usage(900, 120),
      streamedText("Done.", 1),
    ],
  };
}

/** The A-05 timeline scenario: the first turn writes about 10,000 events, later turns stream a little more. */
function timelineTurns(): Turn[] {
  return [
    { steps: Array.from({ length: 334 }, (_, index) => workTurn(index).steps).flat() },
    { steps: [streamedText(`## Follow-up\n\n${words(120, 1)}`, 40), usage(400, 200)] },
    { steps: [streamedText(`## Another follow-up\n\n${words(120, 2)}`, 40), usage(400, 200)] },
    delegatingTurn(),
  ];
}

/** The A-06 composer scenario: the first turn runs until it is stopped, so a test can send while it runs. */
function composerTurns(): Turn[] {
  return [
    { steps: [streamedText("Working on it.", 2), { ...toolCall("view", "src/a.ts", "a"), hangs: true }] },
    { steps: [streamedText("Done.", 1), usage(100, 20)] },
  ];
}

/** A shell call the runtime's own permission flow asks about, as Copilot asks the host (A-07). */
function askingShell(command: string): ToolCallStep {
  return {
    type: "toolCall",
    name: "bash",
    arguments: { command, description: `Run ${command}` },
    result: "ok",
    success: true,
    hangs: false,
    asks: `bash wants to run ${command}`,
  };
}

/**
 * The A-07 approvals scenario: the first four turns run `npm test` and the fifth `npm run lint`, each asking
 * first. The UI test allows the first once, denies the second and always allows the third, so the fourth runs
 * without asking and the fifth, a different command, asks again.
 */
function approvalTurns(): Turn[] {
  const turn = (command: string, index: number): Turn => ({
    steps: [streamedText(`Running \`${command}\` (${String(index)}).`, 2), askingShell(command), streamedText("Done.", 1)],
  });
  return [...[1, 2, 3, 4].map((index) => turn("npm test", index)), turn("npm run lint", 5)];
}

/**
 * The A-08 review scenario: one turn that reports editing `story.txt`. The FakeRuntime changes no files, so the UI
 * test edits the file itself before sending, and the review refreshes when the turn ends.
 */
function reviewTurns(): Turn[] {
  return [{ steps: [streamedText("Renaming two lines of the story.", 2), toolCall("edit", "story.txt", "edited"), usage(200, 40)] }];
}

/**
 * The A-11 usage scenario: one turn in which the main agent (model-a, priced) delegates to `bulk-reader`, and the
 * runtime reports the context in use, so the chip and the dashboard have figures from every source.
 */
function usageTurns(): Turn[] {
  return [
    {
      steps: [
        streamedText("Reading the schema through a cheaper agent.", 2),
        usage(12_000, 800),
        {
          type: "subagent",
          agentName: "bulk-reader",
          model: "model-a",
          viaTask: false,
          steps: [{ type: "usage", model: "model-a", inputTokens: 90_000, cachedInputTokens: 0, outputTokens: 1_200 }],
        },
        { type: "contextUsage", currentTokens: 54_000, tokenLimit: 128_000 },
        streamedText("The schema has 14 tables.", 1),
      ],
    },
  ];
}

export const fakePicadScenarios: Record<string, Scenario> = {
  empty: scenario([]),
  timeline: scenario(timelineTurns()),
  composer: scenario(composerTurns()),
  approvals: scenario(approvalTurns()),
  review: scenario(reviewTurns()),
  usage: scenario(usageTurns()),
};
