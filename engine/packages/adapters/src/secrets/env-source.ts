import { ok, type McpSecretSource } from "@pica/core";

// `env:<NAME>` references, read from the engine's own environment.
export function createEnvSecretSource(env: Readonly<Record<string, string | undefined>> = process.env): McpSecretSource {
  return {
    read(reference) {
      return Promise.resolve(ok(env[reference.name] ?? null));
    },
  };
}
