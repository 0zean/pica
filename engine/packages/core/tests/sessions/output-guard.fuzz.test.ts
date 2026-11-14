import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createOutputGuard, truncateHeadTail, utf8ByteLength } from "../../src/index.ts";
import { guardContext, memoryArtifacts, postInput } from "./output-guard-fixtures.ts";

const runs = { numRuns: 3000, seed: 3006 };

const contentArbitrary = fc.oneof(
  fc.string({ maxLength: 2000 }),
  fc.string({ unit: "binary", maxLength: 2000 }),
  fc.string({ unit: "grapheme", maxLength: 600 }),
  fc.json({ maxDepth: 4 }),
);

describe("output guard fuzz", () => {
  it("never returns a result over the cap, pointer line included", async () => {
    await fc.assert(
      fc.asyncProperty(contentArbitrary, fc.nat({ max: 4096 }), fc.string({ maxLength: 40 }), async (content, maxBytes, callId) => {
        const guard = createOutputGuard({ artifacts: memoryArtifacts(), policyContext: () => guardContext(maxBytes) });
        const outcome = await guard(postInput(content, { toolCallId: callId }));
        const returned = outcome.kind === "modify" ? outcome.result.content : content;
        expect(utf8ByteLength(returned)).toBeLessThanOrEqual(maxBytes);
      }),
      runs,
    );
  });

  it("holds for any pointer, including one longer than the cap", () => {
    fc.assert(
      fc.property(contentArbitrary, fc.nat({ max: 4096 }), fc.string({ unit: "binary", maxLength: 600 }), (content, maxBytes, pointer) => {
        const truncated = truncateHeadTail(content, maxBytes, pointer);
        expect(utf8ByteLength(truncated)).toBeLessThanOrEqual(maxBytes);
        if (utf8ByteLength(content) <= maxBytes) {
          expect(truncated).toBe(content);
        }
      }),
      runs,
    );
  });
});
