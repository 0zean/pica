import { err, ok, type McpSecretSource } from "@pica/core";
import { formatMcpSecretReference } from "@pica/core";
import { methods } from "@pica/protocol";

export type BrokerSecretsReply =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly code: string; readonly message: string };

// Sends the engine-to-client `secrets.get` request and waits for the reply.
export type BrokerSecretsGetCall = (params: { readonly secretRef: string }) => Promise<BrokerSecretsReply>;

// The client answers -32000 `secret_unresolved` when the Keychain has no item (docs/engine-client.md).
const unsetCodes = new Set(["secret_unresolved", "not_found"]);

// `keychain:<name>` references, read from the app's Keychain broker by the reference text.
export function createBrokerSecretSource(call: BrokerSecretsGetCall): McpSecretSource {
  return {
    async read(reference) {
      const secretRef = formatMcpSecretReference(reference);
      const reply = await call({ secretRef });
      if (!reply.ok) {
        return unsetCodes.has(reply.code) ? ok(null) : err({ message: `the client could not read it (${reply.code})` });
      }
      const parsed = methods["secrets.get"].result.safeParse(reply.result);
      if (!parsed.success) {
        return err({ message: "the client answered secrets.get with an invalid result" });
      }
      return ok(parsed.data.value);
    },
  };
}
