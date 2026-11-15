import { describe, expect, it } from "vitest";
import { PicaConfig } from "@pica/protocol";
import { createReadGate, err, ok } from "../../src/index.ts";
import type { JsonValue, PolicyDecision, PreToolUseDecision, RealPathResolver, Session } from "../../src/index.ts";

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
    ["a non-read tool", "create", { path: "big.sql", file_text: "x" }, "allow"],
    ["a forced whole read, even with a short range (S-02)", "view", { path: "big.sql", view_range: [1, 50], forceReadLargeFiles: true }, "deny"],
    ["a forced read of a small file", "view", { path: "small.ts", forceReadLargeFiles: true }, "allow"],
    ["a content search of a large file (S-02)", "grep", { pattern: "x", paths: "big.sql", output_mode: "content" }, "deny"],
    ["a content search given a singular path", "grep", { pattern: "x", path: "big.sql", output_mode: "content" }, "deny"],
    ["a content search given a list of paths", "grep", { pattern: "x", paths: ["small.ts", "big.sql"], output_mode: "content" }, "deny"],
    ["a file-name search of a large file", "grep", { pattern: "x", paths: "big.sql" }, "allow"],
    ["a count search of a large file", "grep", { pattern: "x", path: "big.sql", output_mode: "count" }, "allow"],
    ["an rg search of a large file, which prints lines by default", "rg", { pattern: "x", paths: ["big.sql"] }, "deny"],
    ["an rg search for file names", "rg", { pattern: "x", paths: ["big.sql"], output_mode: "files_with_matches" }, "allow"],
    ["a search outside the session roots", "grep", { pattern: "x", paths: "/etc" }, "deny"],
    ["a search with no paths", "grep", { pattern: "x" }, "allow"],
    ["cat of a large file in bash (S-02)", "bash", { command: "cat big.sql", description: "show" }, "deny"],
    ["less of a large file after cd", "bash", { command: "cd /work && less repo/big.sql", description: "show" }, "deny"],
    ["cat of a small file in bash", "bash", { command: "cat small.ts | wc -l", description: "count" }, "allow"],
    ["head of a large file in bash", "bash", { command: "head -n 20 big.sql", description: "peek" }, "allow"],
    ["a bash call without a command", "read_bash", { shellId: "1" }, "allow"],
    ["a read without a path", "view", { file: "big.sql" }, "allow"],
    ["a read whose arguments are not an object", "view", ["big.sql"], "allow"],
  ] as const)("%s → %s", async (_name, toolName, args, decision) => {
    expect((await gate(toolName, args)).decision).toBe(decision);
  });

  it("allows a sub-agent's large reads and names it by agentType (S-02)", async () => {
    const decisions: PolicyDecision[] = [];
    const hooks = createReadGate({
      sessions: { get: () => ok(session()) },
      config: () => PicaConfig.parse({}),
      fileSize: (path) => Promise.resolve(sizes[path]),
      onDecision: (_id, decision) => decisions.push(decision),
    })("s1");
    const input = { sessionId: "s1", toolCallId: "t1", toolName: "view", arguments: { path: "big.sql" } };
    const sub = await hooks.onPreToolUse?.({ ...input, agentId: "9f0c", agentType: "bulk-reader", parentAgentId: "p" });
    expect(sub?.decision).toBe("allow");
    const typed = await hooks.onPreToolUse?.({ ...input, agentType: "main-ish" });
    expect(typed?.decision).toBe("deny");
    expect(decisions.map((decision) => decision.call.agent)).toEqual(["bulk-reader", "main"]);
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
