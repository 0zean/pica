import type { McpSecretProvider, McpSecretReference } from "../mcp/secret-reference.ts";
import type { Result } from "../result.ts";

export interface McpSecretSourceError {
  // Says why the source could not answer; never contains a secret value.
  readonly message: string;
}

// `null` means the source answered and the secret is not set.
export type McpSecretReadResult = Result<string | null, McpSecretSourceError>;

export interface McpSecretSource {
  read(reference: McpSecretReference): Promise<McpSecretReadResult>;
}

// `keychain` reads through the client's broker (`secrets.get`); `env` reads the engine's environment.
export type McpSecretSources = Readonly<Record<McpSecretProvider, McpSecretSource>>;
