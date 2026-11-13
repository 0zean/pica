import type { Socket } from "node:net";

// The Copilot runtime speaks JSON-RPC 2.0 with LSP-style `Content-Length` framing, the format
// `vscode-jsonrpc`'s stream reader and writer use.

export type JsonRpcMessage = Readonly<Record<string, unknown>>;

const separator = "\r\n\r\n";

export function writeMessage(socket: Socket, message: JsonRpcMessage): void {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  socket.write(`Content-Length: ${String(body.length)}${separator}`);
  socket.write(body);
}

export function readMessages(socket: Socket, onMessage: (message: JsonRpcMessage) => void): void {
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf(separator);
      if (headerEnd < 0) return;
      const length = contentLength(buffer.subarray(0, headerEnd).toString("ascii"));
      const bodyStart = headerEnd + separator.length;
      if (buffer.length < bodyStart + length) return;
      const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      buffer = buffer.subarray(bodyStart + length);
      onMessage(JSON.parse(body) as JsonRpcMessage);
    }
  });
}

function contentLength(header: string): number {
  const match = /^content-length:\s*(\d+)\s*$/im.exec(header);
  if (match?.[1] === undefined) {
    throw new Error(`JSON-RPC frame without Content-Length: ${header}`);
  }
  return Number(match[1]);
}
