// S-05 "hello" engine: the smallest thing that speaks the engine's socket protocol (E-05).
// NDJSON JSON-RPC 2.0 over a Unix socket; `engine.hello` must come first; prints the same
// `{"ready":true,"socket":...}` line on stdout that supervisors wait for.
// `spike.probe` additionally proves that code nested in the signed bundle runs: it pings the
// bundled Copilot runtime (Content-Length framed JSON-RPC over stdio) and opens node:sqlite.
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const PROTOCOL_VERSION = { major: 1, minor: 0 };
const ENGINE_VERSION = '0.0.0-s05';
const startedAt = performance.now();

const { values } = parseArgs({ options: { socket: { type: 'string' } } });
const socketPath = values.socket ?? process.env.PICA_SOCKET;
if (!socketPath) {
  process.stderr.write('usage: node hello-engine.mjs --socket <path>\n');
  process.exit(2);
}

function pingCopilot() {
  const runtime = process.env.COPILOT_CLI_PATH;
  if (!runtime) return Promise.resolve({ ok: false, error: 'COPILOT_CLI_PATH not set' });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-s05-copilot-'));
  return new Promise((resolve) => {
    const child = spawn(runtime, ['--headless', '--no-auto-update', '--stdio', '--no-auto-login'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, COPILOT_HOME: home },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      fs.rmSync(home, { recursive: true, force: true });
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout', stderr: stderr.slice(-500) }), 20000);
    child.on('error', (error) => finish({ ok: false, error: error.message }));
    child.on('exit', (code, signal) => finish({ ok: false, error: `exited code=${code} signal=${signal}`, stderr: stderr.slice(-500) }));
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const start = stdout.indexOf('{');
      if (start < 0) return;
      try {
        const reply = JSON.parse(stdout.slice(start));
        if (reply.id === 1) finish({ ok: reply.result?.message === 'pong: s05', ...reply.result });
      } catch {
        // Partial body; wait for more bytes.
      }
    });
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { message: 's05' } });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  });
}

function probeSqlite() {
  const db = new DatabaseSync(':memory:');
  const row = db.prepare('select sqlite_version() as version').get();
  db.close();
  return { ok: true, version: row.version };
}

const handlers = {
  'engine.hello': ({ protocolVersion }) => {
    if (protocolVersion?.major !== PROTOCOL_VERSION.major) {
      throw { code: -32000, message: 'protocol_version_mismatch' };
    }
    return { protocolVersion: PROTOCOL_VERSION, engineVersion: ENGINE_VERSION };
  },
  'engine.health': () => ({ status: 'ok', uptimeMs: Math.floor(performance.now() - startedAt), sessionsRunning: 0 }),
  'spike.probe': async () => ({
    node: { version: process.version, execPath: process.execPath },
    sqlite: probeSqlite(),
    copilot: await pingCopilot(),
  }),
};

function onConnection(socket) {
  let buffered = '';
  let handshaken = false;
  const send = (message) => socket.write(`${JSON.stringify(message)}\n`);
  socket.setEncoding('utf8');
  socket.on('error', () => {});
  socket.on('data', async (chunk) => {
    buffered += chunk;
    let newline;
    while ((newline = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      const request = JSON.parse(line);
      const handler = handlers[request.method];
      if (!handshaken && request.method !== 'engine.hello') {
        send({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'invalid_state' } });
        continue;
      }
      if (!handler) {
        send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'method_not_found' } });
        continue;
      }
      try {
        const result = await handler(request.params ?? {});
        if (request.method === 'engine.hello') handshaken = true;
        send({ jsonrpc: '2.0', id: request.id, result });
      } catch (error) {
        send({ jsonrpc: '2.0', id: request.id, error: { code: error.code ?? -32603, message: error.message ?? String(error) } });
      }
    }
  });
}

fs.rmSync(socketPath, { force: true });
const server = net.createServer(onConnection);
server.listen(socketPath, () => {
  fs.chmodSync(socketPath, 0o600);
  process.stdout.write(`${JSON.stringify({ ready: true, socket: socketPath })}\n`);
});
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close();
    fs.rmSync(socketPath, { force: true });
    process.exit(0);
  });
}
