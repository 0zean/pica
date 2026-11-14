import { parseArgs } from "node:util";
import { scrubSecrets } from "@pica/core";
import { startEngine } from "./engine.ts";
import { stderrLogger } from "./logger.ts";
import { DEFAULT_SOCKET_PATH } from "./paths.ts";

function socketPathFromArgs(): string {
  const { values } = parseArgs({ options: { socket: { type: "string" } } });
  return values.socket ?? process.env["PICA_SOCKET"] ?? DEFAULT_SOCKET_PATH;
}

async function main(): Promise<void> {
  const listener = await startEngine({ socketPath: socketPathFromArgs(), log: stderrLogger });
  const stop = (): void => {
    void listener.close().then(() => process.exit(0));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  // Supervisors (the app, the CLI) wait for this line before connecting.
  process.stdout.write(`${JSON.stringify({ ready: true, socket: listener.socketPath })}\n`);
}

main().catch((error: unknown) => {
  stderrLogger.error(scrubSecrets(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
