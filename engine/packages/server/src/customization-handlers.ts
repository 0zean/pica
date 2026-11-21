import { customizationProtocolCode } from "@pica/core";
import type { CustomizationError, CustomizationService, Result } from "@pica/core";
import { RpcFailure } from "./errors.ts";
import type { MethodRouter } from "./router.ts";

// X-02: the Agents & Skills window (docs/agents.md).
export function registerCustomizationHandlers(router: MethodRouter, service: CustomizationService): void {
  router.register("customization.list", ({ kind, workspaceId, repoId }) => {
    const listed = unwrap(service.list(kind, { workspaceId, repoId }));
    return { items: [...listed.items], locations: [...listed.locations] };
  });
  router.register("customization.create", ({ kind, locationId, name, text, workspaceId, repoId }) => ({
    item: unwrap(service.create({ kind, locationId, name, text }, { workspaceId, repoId })),
  }));
  router.register("customization.save", ({ kind, path, text, workspaceId, repoId }) => ({
    item: unwrap(service.save(kind, path, text, { workspaceId, repoId })),
  }));
  router.register("customization.delete", ({ kind, path, workspaceId, repoId }) => {
    unwrap(service.remove(kind, path, { workspaceId, repoId }));
    return { ok: true as const };
  });
}

function unwrap<T>(result: Result<T, CustomizationError>): T {
  if (result.ok) return result.value;
  const { code, message, problems, lockedBy } = result.error;
  throw new RpcFailure(customizationProtocolCode(code), message, {
    reason: code,
    ...(problems === undefined ? {} : { problems }),
    ...(lockedBy === undefined ? {} : { policy: lockedBy }),
  });
}
