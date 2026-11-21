import type { GitInstallation } from "@pica/core";
import type { MethodRouter } from "./router.ts";

// `engine.git` (A-15): whether the engine can run git, for onboarding's precondition check.
export function registerGitInstallHandlers(router: MethodRouter, probe: () => Promise<GitInstallation>): void {
  router.register("engine.git", async () => ({ git: await probe() }));
}
