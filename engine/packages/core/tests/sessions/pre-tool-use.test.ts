import { describe, expect, it } from "vitest";
import { PicaConfig } from "@pica/protocol";
import { createReadGate, err, ok } from "../../src/index.ts";
import type { JsonValue, PreToolUseDecision, RealPathResolver, Session } from "../../src/index.ts";

const root = "/work/repo";
const sizes: Readonly<Record<string, number>> = { [`${root}/big.sql`]: 200_000, [`${root}/small.ts`]: 100 };

const session = (overrides: Partial<Session> = {}): Session => ({
  id: "s1",
  workspaceId: "ws",
  writeRoots: [root],
  referenceRoots: [],
  state: "running",
  routingProfile: "balanced",
  budgetMaxCredits: null,
  createdAt: "2026-11-14T00:00:00.000Z",
  updatedAt: "2026-11-14T00:00:00.000Z",
  ...overrides,
});

async function gate(
  toolName: string,
  args: JsonValue,
  stored: Session | null = session(),
  realPath?: RealPathResolver,
): Promise<PreToolUseDecision> {
  const hooks = createReadGate({
    sessions: { get: (id) => (stored === null ? err({ code: "store.not_found", message: id }) : ok(stored)) },
    config: () => PicaConfig.parse({}),
    fileSize: (path) => Promise.resolve(sizes[path]),
    ...(realPath === undefined ? {} : { realPath }),
  })("s1");
  const decision = await hooks.onPreToolUse?.({ sessionId: "s1", toolCallId: "t1", toolName, arguments: args });
  if (decision === undefined) {
    throw new Error("no onPreToolUse hook");
  }
  return decision;
}

describe("createReadGate", () => {
  it.each([
    ["a large unranged read", "view", { path: "big.sql" }, "deny"],
    ["a read with an open-ended range", "view", { path: "big.sql", view_range: [1, -1] }, "deny"],
    ["a read with a malformed range", "view", { path: "big.sql", view_range: [1, "10"] }, "deny"],
    ["a read with a three-element range", "view", { path: "big.sql", view_range: [1, 2, 3] }, "deny"],
    ["a short ranged read", "view", { path: "big.sql", view_range: [1, 50] }, "allow"],
    ["a small read", "view", { path: `${root}/small.ts` }, "allow"],
    ["a missing file", "view", { path: "missing.txt" }, "allow"],
    ["a read outside the session roots", "view", { path: "/etc/hosts" }, "deny"],
    ["a non-read tool", "bash", { command: "cat big.sql" }, "allow"],
    ["a read without a path", "view", { file: "big.sql" }, "allow"],
    ["a read whose arguments are not an object", "view", ["big.sql"], "allow"],
  ] as const)("%s → %s", async (_name, toolName, args, decision) => {
    expect((await gate(toolName, args)).decision).toBe(decision);
  });

  it("follows the session's routing profile", async () => {
    expect((await gate("view", { path: "big.sql" }, session({ routingProfile: "off" }))).decision).toBe("allow");
  });

  it("denies a read for a session the store does not know", async () => {
    expect(await gate("view", { path: "small.ts" }, null)).toMatchObject({ decision: "deny", reason: "session s1 is unknown to the engine" });
  });

  it("judges a read by where its symlinks lead when given a resolver (R-07)", async () => {
    const resolver: RealPathResolver = (path) => Promise.resolve(path === `${root}/link/hosts` ? "/etc/hosts" : path);
    expect((await gate("view", { path: "link/hosts" })).decision).toBe("allow");
    expect((await gate("view", { path: "link/hosts" }, session(), resolver)).decision).toBe("deny");
  });
});
