// Onboarding's precondition checks under `fake-picad.ts` (A-15). PICA_TEST_PRECONDITIONS names a JSON
// file, read again on every check, so a UI test can fail a check and then fix it while Pica runs:
// `{ "copilot": "signed_out", "gitInstall": "missing", "github": "signed-out" }`. A key that is absent, or
// a file that is missing, passes.
import { readFileSync } from "node:fs";
import { err, ok } from "@pica/core";
import type { AgentRuntime, GitInstallation } from "@pica/core";
import type { FakeGitHubMode } from "./fake-github.ts";

interface FakePreconditions {
  readonly copilot: "signed_in" | "signed_out";
  readonly gitInstall: "installed" | "missing";
  readonly github: FakeGitHubMode;
}

export function readFakePreconditions(path: string): FakePreconditions {
  let saved: Record<string, unknown> = {};
  try {
    saved = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    // No file yet: every check passes.
  }
  return {
    copilot: saved["copilot"] === "signed_out" ? "signed_out" : "signed_in",
    gitInstall: saved["gitInstall"] === "missing" ? "missing" : "installed",
    github: saved["github"] === "signed-out" ? "signed-out" : "signed-in",
  };
}

export function fakeCopilotAccount(path: string): NonNullable<AgentRuntime["account"]> {
  return () =>
    Promise.resolve(
      readFakePreconditions(path).copilot === "signed_in"
        ? ok({ login: "octo", authType: "user", host: "https://github.com" })
        : err({ code: "runtime.auth_missing", message: "Pica is not signed in to GitHub Copilot." }),
    );
}

export function fakeGitInstall(path: string): () => Promise<GitInstallation> {
  return () =>
    Promise.resolve(
      readFakePreconditions(path).gitInstall === "installed"
        ? { status: "installed", version: "2.39.5 (Apple Git-154)", message: null }
        : { status: "missing", version: null, message: "xcode-select: note: No developer tools were found, requesting install." },
    );
}
