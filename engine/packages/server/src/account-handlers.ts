import { protocolErrorCode } from "@pica/core";
import type { AgentRuntime } from "@pica/core";
import { RpcFailure } from "./errors.ts";
import type { MethodRouter } from "./router.ts";

// `engine.account` (S-01): who is signed in and through which credential source, or why the account
// cannot be used, so a client can show the sign-in hint before a session fails.
export function registerAccountHandlers(router: MethodRouter, runtime: AgentRuntime): void {
  router.register("engine.account", async () => {
    const none = { login: null, authType: null, host: null };
    if (runtime.account === undefined) {
      return { account: { status: "unknown" as const, ...none, message: null } };
    }
    const account = await runtime.account();
    if (account.ok) {
      return { account: { status: "signed_in" as const, ...account.value, message: null } };
    }
    const { code, message } = account.error;
    if (code === "runtime.no_models") return { account: { status: "no_models" as const, ...none, message } };
    if (code === "runtime.auth_missing") return { account: { status: "signed_out" as const, ...none, message } };
    throw new RpcFailure(protocolErrorCode(code), message);
  });
}
