import { createWorkspaceService, defaultDiscoveryFilter, ok, type WorkspaceService, type WorkspaceServiceDeps } from "@pica/core";
import type { GitHubRestClient } from "@pica/core";
import { createRegistryFixture, type RegistryFixture } from "../repo-registry/helpers.ts";

export interface WorkspaceFixture extends RegistryFixture {
  readonly workspaces: WorkspaceService;
  readonly cloneRequests: string[];
}

// A workspace service over a real store and R-03 registry; `client` answers discovery.
export function createWorkspaceFixture(client: () => GitHubRestClient): WorkspaceFixture {
  const registry = createRegistryFixture();
  const cloneRequests: string[] = [];
  let next = 0;
  const deps: WorkspaceServiceDeps = {
    workspaces: registry.store.workspaces,
    repos: registry.store.repos,
    discovery: { client: () => Promise.resolve(ok(client())), filter: defaultDiscoveryFilter },
    clone: (remoteUrl) => {
      cloneRequests.push(remoteUrl);
      return registry.registry.addByUrl(remoteUrl);
    },
    newId: () => `ws-id-${String((next += 1))}`,
    clock: () => "2026-11-14T00:00:00.000Z",
  };
  return { ...registry, workspaces: createWorkspaceService(deps), cloneRequests };
}

export function noDiscovery(): GitHubRestClient {
  throw new Error("this test does not discover");
}
