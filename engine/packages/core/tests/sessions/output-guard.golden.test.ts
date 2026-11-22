import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createOutputGuard, err, ok, utf8ByteLength, withOutputGuard } from "../../src/index.ts";
import type { PostToolUseOutcome } from "../../src/index.ts";
import { guardContext, memoryArtifacts, postInput } from "./output-guard-fixtures.ts";

// Each case's guarded result is compared with golden/<name>.txt; review a change with `vitest -u`.
const goldenDir = join(import.meta.dirname, "golden");
const maxBytes = 320;

function numberedLines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${String(index + 1).padStart(3, "0")}: ok`).join("\n");
}

function jsonOutput(): string {
  const items = Array.from({ length: 40 }, (_, index) => ({ id: index + 1, name: `item-${String(index + 1)}`, tags: ["a", "b"] }));
  return JSON.stringify({ total: items.length, items }, null, 2);
}

// Control bytes, Latin-1, replacement characters and astral code points, as a hex dump or a
// binary file read as text would produce; head and tail cuts land inside multi-byte characters.
function binaryLookingOutput(): string {
  let text = "";
  for (let index = 0; index < 600; index += 1) {
    text += String.fromCodePoint(index % 7 === 0 ? 0x1f600 + (index % 50) : index % 256);
    if (index % 97 === 0) {
      text += "�";
    }
  }
  return text;
}

const cases: Record<string, string> = {
  text: numberedLines(80),
  json: jsonOutput(),
  binary: binaryLookingOutput(),
};

function contentOf(outcome: PostToolUseOutcome): string {
  if (outcome.kind !== "modify") {
    throw new Error("expected the result to be modified");
  }
  return outcome.result.content;
}

describe("output guard golden cases", () => {
  for (const [name, original] of Object.entries(cases)) {
    it(`truncates ${name} output head and tail`, async () => {
      const artifacts = memoryArtifacts();
      const guard = createOutputGuard({ artifacts, policyContext: () => guardContext(maxBytes) });
      const guarded = contentOf(await guard(postInput(original, { toolCallId: `call-${name}` })));

      await expect(guarded).toMatchFileSnapshot(join(goldenDir, `${name}.txt`));
      expect(utf8ByteLength(guarded)).toBeLessThanOrEqual(maxBytes);
      const [head = "", pointer = "", ...rest] = guarded.split("\n[pica]");
      expect(rest).toEqual([]);
      expect(original.startsWith(head)).toBe(true);
      expect(pointer).toContain(`/artifacts/session-1/tool-output/call-${name}.txt`);
      const tail = pointer.slice(pointer.indexOf("\n") + 1);
      expect(original.endsWith(tail)).toBe(true);
      expect(head.length).toBeGreaterThan(0);
      expect(tail.length).toBeGreaterThan(0);
      expect(artifacts.files.get(`/artifacts/session-1/tool-output/call-${name}.txt`)).toBe(original);
    });
  }

  it("keeps a result at the cap", async () => {
    const artifacts = memoryArtifacts();
    const guard = createOutputGuard({ artifacts, policyContext: () => guardContext(10) });
    expect(await guard(postInput("0123456789"))).toEqual({ kind: "keep" });
    expect(artifacts.files.size).toBe(0);
  });

  it("measures the cap in UTF-8 bytes, not characters", async () => {
    const guard = createOutputGuard({ artifacts: memoryArtifacts(), policyContext: () => guardContext(10) });
    expect((await guard(postInput("ééééé!"))).kind).toBe("modify");
  });

  it("keeps every result in the off profile", async () => {
    const guard = createOutputGuard({ artifacts: memoryArtifacts(), policyContext: () => guardContext(16, "off") });
    expect(await guard(postInput(cases["text"] ?? ""))).toEqual({ kind: "keep" });
  });

  it("guards sub-agent results too", async () => {
    const guard = createOutputGuard({ artifacts: memoryArtifacts(), policyContext: () => guardContext(maxBytes) });
    expect((await guard(postInput(cases["text"] ?? "", { agentId: "bulk-reader" }))).kind).toBe("modify");
  });

  it("still truncates when the spill fails, and says so", async () => {
    const guard = createOutputGuard({
      artifacts: {
        write: () => Promise.resolve(err({ code: "artifact.write_failed", message: "disk full" })),
        remove: () => Promise.resolve(ok(undefined)),
      },
      policyContext: () => guardContext(maxBytes),
    });
    const guarded = contentOf(await guard(postInput(cases["json"] ?? "")));
    expect(utf8ByteLength(guarded)).toBeLessThanOrEqual(maxBytes);
    expect(guarded).toContain("The full output could not be saved: disk full");
  });

  it("adds the guard beside a session's other hooks", () => {
    const guard = createOutputGuard({ artifacts: memoryArtifacts(), policyContext: () => guardContext(maxBytes) });
    const onPreToolUse = () => Promise.resolve({ decision: "allow" as const });
    const hooks = withOutputGuard(() => ({ onPreToolUse }), guard)("session-1");
    expect(hooks.onPreToolUse).toBe(onPreToolUse);
    expect(hooks.onPostToolUse).toBe(guard);
    expect(withOutputGuard(undefined, guard)("session-1")).toEqual({ onPostToolUse: guard });
  });
});
