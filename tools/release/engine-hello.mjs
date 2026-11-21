// Starts the engine bundled in a Pica.app the way the app does (docs/app-shell.md), with HOME in a throwaway
// directory, sends `engine.hello` and `engine.health`, and prints {engineVersion, health} as JSON.
// Usage: node tools/release/engine-hello.mjs <Pica.app>   (any Node runs this script; the bundle's own Node runs picad)
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const app = process.argv[2];
if (!app) {
  console.error("usage: engine-hello.mjs <Pica.app>");
  process.exit(2);
}
const contents = join(app, "Contents");
const home = mkdtempSync(join(tmpdir(), "pica-hello-"));
const socket = join(home, "picad.sock");
const engine = spawn(join(contents, "Helpers/node"), [join(contents, "Resources/engine/picad.mjs"), "--socket", socket], {
  env: {
    HOME: home,
    PATH: "/usr/bin:/bin",
    COPILOT_CLI_PATH: join(contents, "Resources/copilot/prebuilds/darwin-arm64/copilot-runtime"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
engine.stderr.on("data", (chunk) => (stderr += chunk));

function finish(code, output) {
  engine.kill("SIGTERM");
  rmSync(home, { recursive: true, force: true });
  if (code === 0) console.log(JSON.stringify(output));
  else console.error(output, stderr.split("\n").slice(-5).join("\n"));
  process.exit(code);
}

const timer = setTimeout(() => finish(1, "timed out waiting for the engine"), 15_000);
engine.on("exit", (code) => finish(1, `engine exited with ${code} before answering`));

function request(lines, conn, id, method, params) {
  conn.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const onLine = (line) => {
      const message = JSON.parse(line);
      if (message.id !== id) return;
      lines.off("line", onLine);
      if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
      else resolve(message.result);
    };
    lines.on("line", onLine);
  });
}

createInterface({ input: engine.stdout }).once("line", (ready) => {
  if (!JSON.parse(ready).ready) return finish(1, `unexpected first line: ${ready}`);
  const conn = connect(socket, async () => {
    const lines = createInterface({ input: conn });
    try {
      const hello = await request(lines, conn, 1, "engine.hello", { protocolVersion: { major: 1, minor: 0 }, client: { name: "pica-release-check", version: "0" } });
      const health = await request(lines, conn, 2, "engine.health", {});
      clearTimeout(timer);
      engine.removeAllListeners("exit");
      conn.end();
      finish(0, { engineVersion: hello.engineVersion, health: health.status });
    } catch (error) {
      finish(1, error.message);
    }
  });
});
