import * as z from "zod";

// The Copilot account the runtime is signed in with (S-01). `no_models` is signed in but offered
// no models: on Copilot Free that happens through the `gh` CLI token, and `copilot login` fixes it.
// `unknown` means the runtime has no notion of a signed-in account.
export const CopilotAccountStatus = z.enum(["signed_in", "signed_out", "no_models", "unknown"]);

export const CopilotAccount = z.object({
  status: CopilotAccountStatus,
  login: z.string().nullable(),
  // The credential source, e.g. `user` (Copilot CLI login), `gh-cli`, `env`, `token`.
  authType: z.string().nullable(),
  host: z.string().nullable(),
  // What is wrong and how to fix it; null when signed in.
  message: z.string().nullable(),
});
