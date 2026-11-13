import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { silentLogger, startEngine } from "../src/index.ts";
import { TestClient, makeSocketDir, startTestEngine } from "./helpers.ts";

const mode = async (path: string): Promise<number> => (await stat(path)).mode & 0o777;

describe("socket file", () => {
  it("is mode 0600 inside a directory of mode 0700", async () => {
    const { socketPath, dir, stop } = await startTestEngine();
    expect((await stat(socketPath)).isSocket()).toBe(true);
    expect(await mode(socketPath)).toBe(0o600);
    expect(await mode(dir)).toBe(0o700);
    await stop();
  });

  it("tightens an existing directory to 0700", async () => {
    const paths = await makeSocketDir();
    await mkdir(paths.dir, { mode: 0o755 });
    await chmod(paths.dir, 0o755);
    const engine = await startEngine({ socketPath: paths.socketPath, log: silentLogger });
    expect(await mode(paths.dir)).toBe(0o700);
    expect(await mode(paths.socketPath)).toBe(0o600);
    await engine.close();
    await paths.remove();
  });

  it("replaces a stale socket left by a killed engine", async () => {
    const paths = await makeSocketDir();
    await mkdir(paths.dir, { recursive: true, mode: 0o700 });
    await leaveStaleSocket(paths.socketPath);
    expect((await stat(paths.socketPath)).isSocket()).toBe(true);
    const engine = await startEngine({ socketPath: paths.socketPath, log: silentLogger });
    const client = await TestClient.connectAndHello(paths.socketPath);
    client.close();
    await engine.close();
    await paths.remove();
  });

  it("refuses to start while another engine is listening on the socket", async () => {
    const { socketPath, stop } = await startTestEngine();
    await expect(startEngine({ socketPath, log: silentLogger })).rejects.toThrow(/already listening/);
    await stop();
  });

  it("refuses to replace a path that is not a socket", async () => {
    const paths = await makeSocketDir();
    await mkdir(paths.dir, { recursive: true, mode: 0o700 });
    await writeFile(paths.socketPath, "not a socket");
    await expect(startEngine({ socketPath: paths.socketPath, log: silentLogger })).rejects.toThrow(/not a socket/);
    await paths.remove();
  });
});

async function leaveStaleSocket(socketPath: string): Promise<void> {
  const script = "require('node:net').createServer().listen(process.argv[1], () => console.log('up'))";
  const child = spawn(process.execPath, ["-e", script, socketPath], { stdio: ["ignore", "pipe", "inherit"] });
  await once(child.stdout, "data");
  child.kill("SIGKILL");
  await once(child, "exit");
}
