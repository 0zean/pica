import { protocolErrorCode, runtimeErrorCodes } from "@pica/core";
import { ErrorCode } from "@pica/protocol";
import { recordTurn } from "@pica/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { ReplayRuntimes } from "./replay-harness.ts";

const replays = new ReplayRuntimes();
afterEach(() => replays.stopAll());

const workingDirectory = "/errors/repo";

function codeOf(result: { ok: true } | { ok: false; error: { code: string } }): string | undefined {
  return result.ok ? undefined : result.error.code;
}

describe("Copilot error transcripts map to stable codes", () => {
  it("auth-missing: every account call fails with runtime.auth_missing", async () => {
    const { runtime } = await replays.start("auth-missing");
    expect(codeOf(await runtime.listModels())).toBe("runtime.auth_missing");
    expect(codeOf(await runtime.quota())).toBe("runtime.auth_missing");
    expect(codeOf(await runtime.createSession({ workingDirectory }))).toBe("runtime.auth_missing");
    const resumed = await runtime.resumeSession({ sessionId: "any", workingDirectory });
    expect(codeOf(resumed)).toBe("runtime.auth_missing");
  });

  it("auth-missing: the refusal carries the runtime's sign-in message", async () => {
    const { runtime } = await replays.start("auth-missing");
    const models = await runtime.listModels();
    expect(models.ok ? "" : models.error.message).toContain("copilot login");
  });

  it("no-models: a signed-in account offered no models is runtime.no_models with a sign-in hint (S-01)", async () => {
    const { runtime } = await replays.start("no-models");
    const models = await runtime.listModels();
    expect(codeOf(models)).toBe("runtime.no_models");
    expect(models.ok ? "" : models.error.message).toMatch(/"replay-user" \(signed in via gh-cli\).*copilot login/);
    expect(codeOf(await runtime.createSession({ workingDirectory }))).toBe("runtime.no_models");
    expect(codeOf(await runtime.account())).toBe("runtime.no_models");
    expect(protocolErrorCode("runtime.no_models")).toBe("auth_required");
  });

  it("reports the signed-in account and its credential source", async () => {
    const { runtime } = await replays.start("default-model-only");
    const account = await runtime.account();
    expect(account.ok ? account.value : account.error).toEqual({ login: "replay-user", authType: "user", host: "https://github.com" });
  });

  it("quota-exhausted: the turn's session.error is runtime.quota_exhausted and the turn ends", async () => {
    const { runtime } = await replays.start("quota-exhausted");
    const created = await runtime.createSession({ workingDirectory });
    if (!created.ok) throw new Error(created.error.code);
    const turn = await recordTurn(created.value, "hello");
    if (!turn.ok) throw new Error(turn.error.code);
    const errors = turn.value.events.filter((event) => event.type === "session.error");
    expect(errors.map((event) => event.data.code)).toEqual(["runtime.quota_exhausted"]);
    expect(turn.value.events.at(-1)?.type).toBe("session.idle");
  });

  it("model-unavailable: a model disabled by policy is refused before the runtime is asked", async () => {
    const { runtime, server } = await replays.start("model-unavailable");
    const created = await runtime.createSession({ workingDirectory, model: "locked-1" });
    expect(codeOf(created)).toBe("runtime.model_unavailable");
    expect(server.requests.map((request) => request.method)).not.toContain("session.create");
  });

  it("model-unavailable: the runtime's refusal of a listed model is runtime.model_unavailable", async () => {
    const { runtime } = await replays.start("model-unavailable");
    const created = await runtime.createSession({ workingDirectory, model: "frontier-1" });
    expect(codeOf(created)).toBe("runtime.model_unavailable");
    expect(created.ok ? "" : created.error.message).toContain("frontier-1");
  });
});

describe("runtime error codes reach clients as stable protocol codes", () => {
  it("maps the three transcript errors to their protocol codes", () => {
    expect(protocolErrorCode("runtime.auth_missing")).toBe("auth_required");
    expect(protocolErrorCode("runtime.quota_exhausted")).toBe("quota_exhausted");
    expect(protocolErrorCode("runtime.model_unavailable")).toBe("model_unavailable");
  });

  it("maps every runtime code to a code the protocol defines", () => {
    for (const code of runtimeErrorCodes) {
      expect(ErrorCode.options).toContain(protocolErrorCode(code));
    }
  });
});

