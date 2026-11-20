import { execFile } from "node:child_process";
import {
  createEnvSecretSource,
  createJsonMcpAttachmentStore,
  createLoopbackBrowser,
  createMcpLaunchConnector,
  createMcpOAuthCrypto,
  createMcpOAuthHttp,
  createMcpServerFiles,
  createMemoryMcpGrantStore,
  JsoncMcpRegistryLoader,
  mcpAttachmentsPath,
  mcpFileSources,
} from "@pica/adapters";
import type { McpHttpFetch } from "@pica/adapters";
import type { ManagedMcpAllowlist, McpDefinitions, Store } from "@pica/core";
import type { EngineMcpOptions } from "./mcp-composition.ts";

export interface McpCompositionInputs {
  readonly homeDir: string;
  readonly dataDir: string;
  readonly store: Store;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly agents: () => readonly string[];
  readonly managedAllowlist: ManagedMcpAllowlist | undefined;
  // Tests send remote servers to a local stub; production uses the network.
  readonly fetch?: McpHttpFetch;
}

// A-13: Pica's own `mcp.jsonc` files (global and per workspace, plus the Copilot CLI's global
// file M-01 reads), attachments beside the store, `env:` secrets from the engine's environment.
export function mcpOptions(inputs: McpCompositionInputs): EngineMcpOptions {
  const definitions: McpDefinitions = (workspaceId) => {
    const loaded = new JsoncMcpRegistryLoader(mcpFileSources(inputs.homeDir, undefined, workspaceId)).load();
    return loaded.ok ? { ok: true, value: loaded.value.servers.map((server) => server.definition) } : loaded;
  };
  const fetch = inputs.fetch;
  return {
    files: createMcpServerFiles(inputs.homeDir),
    definitions,
    attachments: createJsonMcpAttachmentStore(mcpAttachmentsPath(inputs.dataDir)),
    workspaceIds: () => {
      const listed = inputs.store.workspaces.list();
      return listed.ok ? listed.value.map((workspace) => workspace.id) : [];
    },
    launcher: createMcpLaunchConnector(fetch === undefined ? {} : { fetch }),
    envSecrets: createEnvSecretSource(inputs.env),
    agents: inputs.agents,
    managedAllowlist: () => inputs.managedAllowlist,
    oauth: {
      http: createMcpOAuthHttp(fetch === undefined ? {} : { fetch }),
      browser: createLoopbackBrowser({ open: openInBrowser }),
      crypto: createMcpOAuthCrypto(),
      grants: createMemoryMcpGrantStore(),
    },
  };
}

function openInBrowser(url: string): void {
  execFile("/usr/bin/open", [url], () => undefined);
}
