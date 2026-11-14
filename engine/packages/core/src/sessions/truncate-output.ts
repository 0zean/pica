const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

/**
 * Keeps the head and tail of `content` around a `pointer` line so the whole result is at most
 * `maxBytes` of UTF-8. Cuts fall on character boundaries. Content already within the cap is
 * returned unchanged; a pointer longer than the cap is itself cut to fit.
 */
export function truncateHeadTail(content: string, maxBytes: number, pointer: string): string {
  const bytes = encoder.encode(content);
  if (bytes.byteLength <= maxBytes) {
    return content;
  }
  const marker = encoder.encode(`\n${pointer}\n`);
  if (marker.byteLength > maxBytes) {
    const line = encoder.encode(pointer);
    return decoder.decode(line.subarray(0, boundaryAtOrBefore(line, Math.min(maxBytes, line.byteLength))));
  }
  const budget = maxBytes - marker.byteLength;
  const headEnd = boundaryAtOrBefore(bytes, Math.ceil(budget / 2));
  const tailStart = boundaryAtOrAfter(bytes, bytes.byteLength - (budget - headEnd));
  return decoder.decode(bytes.subarray(0, headEnd)) + decoder.decode(marker) + decoder.decode(bytes.subarray(tailStart));
}

function isContinuationByte(byte: number | undefined): boolean {
  return byte !== undefined && (byte & 0xc0) === 0x80;
}

function boundaryAtOrBefore(bytes: Uint8Array, index: number): number {
  let at = index;
  while (at > 0 && isContinuationByte(bytes[at])) {
    at -= 1;
  }
  return at;
}

function boundaryAtOrAfter(bytes: Uint8Array, index: number): number {
  let at = index;
  while (at < bytes.byteLength && isContinuationByte(bytes[at])) {
    at += 1;
  }
  return at;
}
