import { describe, expect, it } from "vitest";
import { builtinAgent } from "./helpers.ts";

// The prompts are part of the cached prompt prefix (PLAN.md §5.5): a change must be deliberate.
describe("built-in agent prompts", () => {
  it.each(["bulk-reader", "code-writer", "repo-scout"])("%s matches its snapshot", (name) => {
    expect(builtinAgent(name)).toMatchSnapshot();
  });
});
