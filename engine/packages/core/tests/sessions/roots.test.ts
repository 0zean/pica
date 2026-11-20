import { describe, expect, it } from "vitest";
import { sessionRoots } from "../../src/index.ts";

const repos = [
  { id: "repo-api", localPath: "/src/acme/api" },
  { id: "repo-web", localPath: "/src/acme/web" },
  { id: "repo-remote", localPath: null },
];

describe("sessionRoots", () => {
  it("lists write roots first, then reference roots, each with the repo checked out there", () => {
    const session = { writeRoots: ["/src/acme/web", "/src/acme/api"], referenceRoots: ["/src/acme/docs"] };
    expect(sessionRoots(session, repos)).toEqual([
      { path: "/src/acme/web", access: "write", repoId: "repo-web" },
      { path: "/src/acme/api", access: "write", repoId: "repo-api" },
      { path: "/src/acme/docs", access: "reference", repoId: null },
    ]);
  });

  it("answers no roots for a session with none", () => {
    expect(sessionRoots({ writeRoots: [], referenceRoots: [] }, repos)).toEqual([]);
  });
});
