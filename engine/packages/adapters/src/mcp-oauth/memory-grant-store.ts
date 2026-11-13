import { ok, type McpOAuthGrant, type McpOAuthGrantStore } from "@pica/core";

// Grants live as long as the engine; after a restart each OAuth server is signed in again
// (docs/mcp-secrets.md explains why tokens are not written to the database).
export function createMemoryMcpGrantStore(): McpOAuthGrantStore {
  const grants = new Map<string, McpOAuthGrant>();
  return {
    load: (serverId) => Promise.resolve(ok(grants.get(serverId) ?? null)),
    save: (grant) => {
      grants.set(grant.serverId, grant);
      return Promise.resolve(ok(undefined));
    },
    clear: (serverId) => {
      grants.delete(serverId);
      return Promise.resolve(ok(undefined));
    },
  };
}
