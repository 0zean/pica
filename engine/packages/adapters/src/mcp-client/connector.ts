import type { McpLaunchConnector } from "@pica/core";
import { connectHttpMcpServer, type McpHttpFetch } from "./http.ts";
import { connectStdioMcpServer } from "./stdio.ts";

export interface McpLaunchConnectorOptions {
  readonly fetch?: McpHttpFetch;
  // Variables every stdio server inherits beneath its own `env`, such as PATH.
  readonly baseEnv?: NodeJS.ProcessEnv;
}

export function createMcpLaunchConnector(options: McpLaunchConnectorOptions = {}): McpLaunchConnector {
  const doFetch = options.fetch ?? fetch;
  const baseEnv = options.baseEnv ?? process.env;
  return {
    connect(launch, onExit) {
      const { transport } = launch;
      return transport.type === "stdio"
        ? connectStdioMcpServer(transport, onExit, baseEnv)
        : connectHttpMcpServer(transport, doFetch);
    },
  };
}
