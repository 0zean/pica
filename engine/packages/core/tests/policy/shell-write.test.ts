import { describe, expect, it } from "vitest";
import { decide } from "../../src/index.ts";
import { auto, shell } from "./cases.ts";
import { baseContext, toolCall } from "./fixtures.ts";

// C-04 follow-up: the shell-write tables (shell-write-cases.ts) run in decide.test.ts with the other
// policy tables; this checks what the denial says.
describe("main-agent shell writes", () => {
  it("names code-writer, the target and the profile", () => {
    const decision = decide(toolCall(shell("cat > test/money.test.mjs <<'EOF'\nx\nEOF")), baseContext(auto));
    expect(decision.reason).toContain("code-writer");
    expect(decision.reason).toContain("test/money.test.mjs");
    expect(decision.reason).toContain("balanced");
    expect(decision.ruleGroup).toBe("cost");
  });
});
