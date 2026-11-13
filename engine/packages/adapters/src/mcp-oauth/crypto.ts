import { createHash, randomBytes } from "node:crypto";
import type { McpOAuthCrypto } from "@pica/core";

export function createMcpOAuthCrypto(): McpOAuthCrypto {
  return {
    randomToken: () => randomBytes(32).toString("base64url"),
    codeChallenge: (verifier) => createHash("sha256").update(verifier).digest("base64url"),
  };
}
