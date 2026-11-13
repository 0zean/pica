const simpleEscapes: Readonly<Record<string, number>> = {
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
  '"': 0x22,
  "\\": 0x5c,
};

// Reverses git's C-style path quoting ("a\tb", "\303\251"). Returns undefined if malformed.
export function unquotePath(text: string): string | undefined {
  if (!text.startsWith('"')) {
    return text;
  }
  if (text.length < 2 || !text.endsWith('"')) {
    return undefined;
  }
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  const body = text.slice(1, -1);
  let i = 0;
  while (i < body.length) {
    const char = body.charAt(i);
    if (char !== "\\") {
      bytes.push(...encoder.encode(char));
      i += 1;
      continue;
    }
    const next = body.charAt(i + 1);
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1, i + 4));
    if (octal !== null) {
      bytes.push(Number.parseInt(octal[0], 8));
      i += 4;
    } else if (next in simpleEscapes) {
      bytes.push(simpleEscapes[next] ?? 0);
      i += 2;
    } else {
      return undefined;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
