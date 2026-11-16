import { afterEach, describe, expect, it } from "vitest";
import { ReplayRuntimes } from "./replay-harness.ts";

// C-07 follow-up: the main agent's excluded tools and the delegation guide reach Copilot's
// `session.create` as `defaultAgent.excludedTools` and an appended system message.

const replays = new ReplayRuntimes();
afterEach(() => replays.stopAll());

function createParams(requests: readonly { method: string; params: unknown }[]): Record<string, unknown> {
  const create = requests.find((request) => request.method === "session.create");
  if (create === undefined) throw new Error("no session.create request");
  return create.params as Record<string, unknown>;
}

describe("CopilotRuntime main-agent routing", () => {
  it("sends the excluded tools and the guide on session.create", async () => {
    const { runtime, server } = await replays.start("text-reply");
    const created = await runtime.createSession({
      workingDirectory: "/routing/repo",
      excludedTools: ["apply_patch", "create"],
      systemMessage: "# Delegation\n",
    });
    if (!created.ok) throw new Error(created.error.code);
    expect(createParams(server.requests)).toMatchObject({
      defaultAgent: { excludedTools: ["apply_patch", "create"] },
      systemMessage: { mode: "append", content: "# Delegation\n" },
    });
  });

  it("sends neither when the session has none", async () => {
    const { runtime, server } = await replays.start("text-reply");
    const created = await runtime.createSession({ workingDirectory: "/routing/repo" });
    if (!created.ok) throw new Error(created.error.code);
    const params = createParams(server.requests);
    expect(params).not.toHaveProperty("defaultAgent");
    expect(params).not.toHaveProperty("systemMessage");
  });
});
