// S-07 spike server: streams synthetic session events over a Unix socket as NDJSON.
// Protocol: the client sends one `spike.start` request with { count, rate }; the server
// replies with its monotonic clock, streams `session.event` notifications, then `spike.done`.
// rate 0 means "as fast as the socket accepts".
import net from 'node:net';
import fs from 'node:fs';

const socketPath = process.argv[2];
if (!socketPath) {
  console.error('usage: node server.mjs <socket path>');
  process.exit(2);
}

const sessionId = 'ses_01JS07SPIKE0000000000000';
const shortText = 'The quick brown fox reads `src/index.ts` and proposes a two-line fix. ';
const toolOutput = 'x'.repeat(1800);

function eventFor(seq) {
  const sentNs = process.hrtime.bigint().toString();
  const ts = new Date().toISOString();
  let type;
  let data;
  if (seq % 50 === 0) {
    type = 'tool.completed';
    data = { toolCallId: `call_${seq}`, toolName: 'read_file', ok: true, output: toolOutput };
  } else if (seq % 10 === 0) {
    type = 'assistant.usage';
    data = { model: 'gpt-5-mini', inputTokens: 1200 + seq, cachedInputTokens: 900, outputTokens: 64 };
  } else {
    type = 'assistant.delta';
    data = { messageId: `msg_${Math.floor(seq / 100)}`, text: shortText };
  }
  return JSON.stringify({
    jsonrpc: '2.0',
    method: 'session.event',
    params: { sessionId, seq, ts, type, data, sentNs },
  }) + '\n';
}

function stream(socket, count, rate) {
  const startNs = process.hrtime.bigint();
  let seq = 0;
  let blocked = false;
  socket.on('drain', () => {
    blocked = false;
    setImmediate(pump);
  });

  function pump() {
    const elapsedNs = Number(process.hrtime.bigint() - startNs);
    const due = rate === 0 ? count : Math.min(count, Math.floor((elapsedNs / 1e9) * rate) + 1);
    while (seq < due && !blocked) {
      seq += 1;
      blocked = !socket.write(eventFor(seq));
    }
    if (seq < count) {
      if (!blocked) setImmediate(pump);
      return;
    }
    const seconds = Number(process.hrtime.bigint() - startNs) / 1e9;
    socket.end(JSON.stringify({ jsonrpc: '2.0', method: 'spike.done', params: { sent: seq, seconds } }) + '\n');
  }
  pump();
}

function onConnection(socket) {
  let buffered = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffered += chunk;
    const newline = buffered.indexOf('\n');
    if (newline < 0) return;
    const request = JSON.parse(buffered.slice(0, newline));
    buffered = '';
    const { count, rate } = request.params;
    const serverNs = process.hrtime.bigint().toString();
    socket.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { serverNs } }) + '\n');
    stream(socket, count, rate);
  });
  socket.on('error', (error) => console.error(`server: ${error.message}`));
}

fs.rmSync(socketPath, { force: true });
const server = net.createServer(onConnection);
server.listen(socketPath, () => fs.chmodSync(socketPath, 0o600));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close();
    fs.rmSync(socketPath, { force: true });
    process.exit(0);
  });
}
