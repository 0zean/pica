import { PROTOCOL_VERSION } from "@pica/protocol";
import { RpcFailure } from "./errors.ts";
import type { MethodRouter } from "./router.ts";
import { ENGINE_VERSION } from "./version.ts";

export interface StoreRecoveryReport {
  readonly backupPath: string;
  readonly reason: string;
  readonly at: string;
}

export interface EngineStatus {
  readonly uptimeMs: () => number;
  readonly sessionsRunning: () => number;
  // H-05: the damaged database this engine moved aside at start, if it did.
  readonly storeRecovery?: StoreRecoveryReport | null;
}

export function registerEngineHandlers(router: MethodRouter, status: EngineStatus): void {
  router.register("engine.hello", ({ protocolVersion }) => {
    if (protocolVersion.major !== PROTOCOL_VERSION.major) {
      throw new RpcFailure(
        "protocol_version_mismatch",
        `This engine speaks protocol ${String(PROTOCOL_VERSION.major)}.x; the client speaks ${String(protocolVersion.major)}.x.`,
        { engine: PROTOCOL_VERSION, client: protocolVersion },
      );
    }
    return { protocolVersion: PROTOCOL_VERSION, engineVersion: ENGINE_VERSION };
  });
  router.register("engine.health", () => ({
    status: "ok",
    uptimeMs: Math.floor(status.uptimeMs()),
    sessionsRunning: status.sessionsRunning(),
    ...(status.storeRecovery == null ? {} : { storeRecovery: status.storeRecovery }),
  }));
}
