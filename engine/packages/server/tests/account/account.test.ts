import { afterEach, describe, expect, it } from "vitest";
import { err, ok } from "@pica/core";
import type { AgentRuntime } from "@pica/core";
import { call } from "../sessions/helpers.ts";
import { pricedScenario, startBudgetEngine } from "../budgets/helpers.ts";
import type { BudgetEngine } from "../budgets/helpers.ts";

let running: BudgetEngine | undefined;
afterEach(async () => {
  await running?.stop();
  running = undefined;
});

async function accountWith(account?: AgentRuntime["account"]): Promise<unknown> {
  running = await startBudgetEngine(pricedScenario([]), {}, undefined, account);
  return (await call(running.client, "engine.account", {}))["account"];
}

describe("engine.account (S-01)", () => {
  it("reports the signed-in login and credential source", async () => {
    const signedIn = { login: "octocat", authType: "user", host: "https://github.com" };
    expect(await accountWith(() => Promise.resolve(ok(signedIn)))).toEqual({ status: "signed_in", ...signedIn, message: null });
  });

  it("reports an account with no models and the runtime's sign-in hint", async () => {
    const message = 'GitHub Copilot offers no models to "octocat" (signed in via gh-cli). Run `copilot login` to sign in with a Copilot login.';
    expect(await accountWith(() => Promise.resolve(err({ code: "runtime.no_models", message })))).toEqual({
      status: "no_models",
      login: null,
      authType: null,
      host: null,
      message,
    });
  });

  it("reports signed out, and unknown for a runtime without accounts", async () => {
    const signedOut = await accountWith(() => Promise.resolve(err({ code: "runtime.auth_missing", message: "Not logged in" })));
    expect(signedOut).toMatchObject({ status: "signed_out", message: "Not logged in" });
    await running?.stop();
    expect(await accountWith()).toEqual({ status: "unknown", login: null, authType: null, host: null, message: null });
  });
});
