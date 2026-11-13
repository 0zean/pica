export type Frame = { kind: "line"; text: string } | { kind: "too_large"; bytes: number };

const NEWLINE = 0x0a;

// Splits an NDJSON byte stream into lines. A line longer than `maxFrameBytes` is reported once
// and its remaining bytes are skipped up to the next newline, so the stream stays in sync.
export class NdjsonDecoder {
  private chunks: Buffer[] = [];
  private pendingBytes = 0;
  private discarding = false;
  private readonly maxFrameBytes: number;

  constructor(maxFrameBytes: number) {
    this.maxFrameBytes = maxFrameBytes;
  }

  push(chunk: Buffer): Frame[] {
    const frames: Frame[] = [];
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(NEWLINE, start);
      const end = newline === -1 ? chunk.length : newline;
      this.append(chunk.subarray(start, end), frames);
      if (newline === -1) {
        break;
      }
      this.finishLine(frames);
      start = newline + 1;
    }
    return frames;
  }

  private append(piece: Buffer, frames: Frame[]): void {
    if (this.discarding) {
      return;
    }
    if (this.pendingBytes + piece.length > this.maxFrameBytes) {
      frames.push({ kind: "too_large", bytes: this.pendingBytes + piece.length });
      this.discarding = true;
      this.chunks = [];
      this.pendingBytes = 0;
      return;
    }
    if (piece.length > 0) {
      this.chunks.push(Buffer.from(piece));
      this.pendingBytes += piece.length;
    }
  }

  private finishLine(frames: Frame[]): void {
    if (this.discarding) {
      this.discarding = false;
      return;
    }
    const text = Buffer.concat(this.chunks, this.pendingBytes).toString("utf8").trim();
    this.chunks = [];
    this.pendingBytes = 0;
    if (text.length > 0) {
      frames.push({ kind: "line", text });
    }
  }
}

export function encodeFrame(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}
