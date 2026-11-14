import dgram from "node:dgram";
import dns from "node:dns";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectDiagnostics, createSecretScrubber, createStructuredLog } from "@pica/core";
import { createOtlpHttpTransport, writeDiagnosticsFile } from "@pica/adapters";
import { createUsageMetricsExporter } from "../../src/index.ts";
import { runFixtureScenario, startFixtureEngine } from "./helpers.ts";
import type { FixtureEngine } from "./helpers.ts";

// Every way Node code reaches the network. Unix-socket connects (the engine's own listener and the
// test client) are local IPC and pass through; anything else is recorded and refused, except fetch,
// which is recorded and answered so an enabled exporter can be observed succeeding.
interface NetworkLog {
  readonly outbound: string[];
  readonly local: string[];
}

function stubNetwork(): NetworkLog {
  const outbound: string[] = [];
  const local: string[] = [];
  const refuse = (what: string): never => {
    outbound.push(what);
    throw new Error(`network stub: ${what} refused`);
  };
  const connect: unknown = Reflect.get(net.Socket.prototype, "connect");
  vi.spyOn(net.Socket.prototype, "connect").mockImplementation(function (this: net.Socket, ...args: unknown[]) {
    const target = connectTarget(args);
    if (target.ipc) {
      local.push(target.address);
      return Reflect.apply(connect as (...forwarded: unknown[]) => net.Socket, this, args);
    }
    return refuse(`net.connect ${target.address}`);
  });
  vi.spyOn(tls, "connect").mockImplementation(() => refuse("tls.connect"));
  vi.spyOn(http, "request").mockImplementation(() => refuse("http.request"));
  vi.spyOn(http, "get").mockImplementation(() => refuse("http.get"));
  vi.spyOn(https, "request").mockImplementation(() => refuse("https.request"));
  vi.spyOn(https, "get").mockImplementation(() => refuse("https.get"));
  vi.spyOn(dgram, "createSocket").mockImplementation(() => refuse("dgram.createSocket"));
  vi.spyOn(dns, "lookup").mockImplementation(() => refuse("dns.lookup"));
  vi.stubGlobal("fetch", (input: unknown) => {
    outbound.push(`fetch ${String(input)}`);
    return Promise.resolve(new Response(null, { status: 200 }));
  });
  return { outbound, local };
}

function connectTarget(args: readonly unknown[]): { readonly ipc: boolean; readonly address: string } {
  // net.connect passes its normalized arguments as one array.
  const first: unknown = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
  if (typeof first === "string") {
    return { ipc: true, address: first };
  }
  if (typeof first === "object" && first !== null) {
    const options = first as { readonly path?: unknown; readonly host?: unknown; readonly port?: unknown };
    if (typeof options.path === "string") {
      return { ipc: true, address: options.path };
    }
    const host = typeof options.host === "string" ? options.host : "localhost";
    const port = typeof options.port === "number" || typeof options.port === "string" ? String(options.port) : "?";
    return { ipc: false, address: `${host}:${port}` };
  }
  return { ipc: false, address: String(first) };
}

let running: FixtureEngine | undefined;
let network: NetworkLog = { outbound: [], local: [] };

beforeEach(() => {
  network = stubNetwork();
});

afterEach(async () => {
  await running?.stop();
  running = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("observability with export disabled", () => {
  it("opens no outbound connection while sessions run, logs are written and a bundle is collected", async () => {
    const lines: string[] = [];
    const structured = createStructuredLog({
      write: (line) => lines.push(line),
      clock: () => "2026-11-14T09:00:00.000Z",
      redactor: createSecretScrubber(),
    });
    running = await startFixtureEngine();
    const sessionId = await runFixtureScenario(running.client);
    structured.logger("picad").info(`session ${sessionId} idle`);

    const dir = await mkdtemp(join(tmpdir(), "picad-bundle-"));
    try {
      const bundle = collectDiagnostics({
        store: running.store,
        generatedAt: "2026-11-14T10:00:00.000Z",
        environment: { engineVersion: "0.0.0" },
        config: {},
        logs: structured.recent(),
      });
      const written = writeDiagnosticsFile(join(dir, "diagnostics.json"), bundle);
      expect(written.ok).toBe(true);
      const text = await readFile(join(dir, "diagnostics.json"), "utf8");
      expect((JSON.parse(text) as { sessions: unknown[] }).sessions).toHaveLength(1);
      expect(text).not.toContain("find the schema");
      expect(text).toContain(`session ${sessionId} idle`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    expect(lines).toHaveLength(1);
    expect(network.local).toContain(running.socketPath);
    expect(network.outbound).toEqual([]);
  });

  it("the stub refuses a TCP connection and sees the exporter's request once export is enabled", async () => {
    expect(() => net.connect(4318, "collector.invalid")).toThrow("network stub");
    expect(network.outbound).toEqual(["net.connect collector.invalid:4318"]);
    network.outbound.length = 0;

    const endpoint = "http://collector.invalid:4318/v1/metrics";
    const exporter = createUsageMetricsExporter({
      transport: createOtlpHttpTransport({ endpoint }),
      clock: () => "2026-11-14T09:00:00.000Z",
    });
    running = await startFixtureEngine({ metricsExport: exporter });
    await runFixtureScenario(running.client);
    expect(network.outbound).toEqual([]);

    const stopped = await exporter.stop();
    expect(stopped.ok).toBe(true);
    expect(network.outbound).toEqual([`fetch ${endpoint}`]);
  });
});
