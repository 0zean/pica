import { sessionRoots } from "@pica/core";
import type { Store } from "@pica/core";
import { RpcFailure } from "./errors.ts";
import type { MethodRouter } from "./router.ts";

// A-10: the terminal opens its shell in one of these (docs/terminal.md).
export function registerSessionRootsHandlers(router: MethodRouter, store: Pick<Store, "sessions" | "repos">): void {
  router.register("session.roots", ({ sessionId }) => {
    const session = store.sessions.get(sessionId);
    if (!session.ok) {
      const code = session.error.code === "store.not_found" ? "not_found" : "internal_error";
      throw new RpcFailure(code, session.error.message);
    }
    const repos = store.repos.list();
    if (!repos.ok) {
      throw new RpcFailure("internal_error", repos.error.message);
    }
    return { roots: sessionRoots(session.value, repos.value) };
  });
}
