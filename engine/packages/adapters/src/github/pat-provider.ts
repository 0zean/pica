import { err, ok, type GitHubCredentialProvider, type GitHubSecretReader } from "@pica/core";
import { methods } from "@pica/protocol";

// A personal access token stored in the client's secret broker under the host's secret reference.
export function createPatCredentialProvider(secrets: GitHubSecretReader): GitHubCredentialProvider {
  return {
    kind: "pat",
    token: (request) => secrets.read(request.host.patSecretRef),
  };
}

export type SecretsGetReply =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly code: string; readonly message: string };

// Sends the engine-to-client `secrets.get` request and waits for the reply.
export type SecretsGetCall = (params: { readonly secretRef: string }) => Promise<SecretsGetReply>;

const unsetCodes = new Set(["secret_unresolved", "not_found"]);

export function createRpcGitHubSecretReader(call: SecretsGetCall): GitHubSecretReader {
  return {
    async read(secretRef) {
      const reply = await call({ secretRef });
      if (!reply.ok) {
        return unsetCodes.has(reply.code)
          ? ok(null)
          : err({ code: "secret_unresolved", message: `could not read secret ${secretRef}: ${reply.message}`, details: { secretRef } });
      }
      const parsed = methods["secrets.get"].result.safeParse(reply.result);
      if (!parsed.success) {
        return err({ code: "secret_unresolved", message: `the client answered secrets.get for ${secretRef} with an invalid result`, details: { secretRef } });
      }
      return ok(parsed.data.value.length === 0 ? null : parsed.data.value);
    },
  };
}
