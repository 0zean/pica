import { describe, expect, it } from "vitest";
import { linkedPullRequestBody, type PullRequestRef } from "../../src/index.ts";

const api: PullRequestRef = { repo: { owner: "acme", name: "api" }, number: 11, url: "https://github.com/acme/api/pull/11" };
const web: PullRequestRef = { repo: { owner: "acme", name: "web" }, number: 42, url: "https://github.com/acme/web/pull/42" };

describe("linkedPullRequestBody (R-10)", () => {
  it("appends a section linking the other pull requests and naming this one", () => {
    expect(linkedPullRequestBody("Renames a field.", "pica/rename", api, [api, web])).toBe(
      [
        "Renames a field.",
        "",
        "<!-- pica:change-set -->",
        "Part of change set `pica/rename` across 2 repositories:",
        "- acme/api#11 (this pull request)",
        "- [acme/web#42](https://github.com/acme/web/pull/42)",
      ].join("\n"),
    );
  });

  it("replaces an earlier section instead of stacking another", () => {
    const once = linkedPullRequestBody("Renames a field.", "pica/rename", web, [api, web]);
    expect(linkedPullRequestBody(once, "pica/rename", web, [api, web])).toBe(once);
  });

  it("is just the section when there is no description", () => {
    expect(linkedPullRequestBody("", "pica/rename", api, [api, web]).startsWith("<!-- pica:change-set -->")).toBe(true);
  });
});
