import { parseArgs } from "node:util";
import { createSecretScrubber, createStructuredLog } from "@pica/core";
import { startEngine } from "./engine.ts";
import { DEFAULT_SOCKET_PATH } from "./paths.ts";

function socketPathFromArgs(): string {
  const { values } = parseArgs({ options: { socket: { type: "string" } } });
  return values.socket ?? process.env["PICA_SOCKET"] ?? DEFAULT_SOCKET_PATH;
}

// H-04: one JSON object per stderr line; supervisors send stderr to picad.log.
const log = createStructuredLog({
  write: (line) => {
    process.stderr.write(`${line}\n`);
  },
  clock: () => new Date().toISOString(),
  redactor: createSecretScrubber(),
}).logger("picad");

async function main(): Promise<void> {
  const listener = await startEngine({ socketPath: socketPathFromArgs(), log });
  const stop = (): void => {
    void listener.close().then(() => process.exit(0));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  // Supervisors (the app, the CLI) wait for this line before connecting.
  process.stdout.write(`${JSON.stringify({ ready: true, socket: listener.socketPath })}\n`);
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
