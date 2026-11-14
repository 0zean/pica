import type { RepoCard } from "./types.ts";

export const defaultRepoCardMaxBytes = 1536;

interface ListLine {
  readonly label: string;
  readonly items: readonly string[];
  readonly separator: string;
  readonly maxItems: number;
}

const encoder = new TextEncoder();

export function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

function clean(text: string): string {
  let cleaned = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    cleaned += code < 0x20 || code === 0x7f ? " " : char;
  }
  return cleaned;
}

// Cuts on a code point boundary so the result is still valid UTF-8.
export function clipToBytes(text: string, maxBytes: number): string {
  let used = 0;
  let clipped = "";
  for (const char of text) {
    used += utf8Bytes(char);
    if (used > maxBytes) break;
    clipped += char;
  }
  return clipped;
}

function listLines(card: RepoCard): ListLine[] {
  return [
    {
      label: "languages",
      items: card.languages.map((language) => `${language.name} ${String(language.files)}`),
      separator: ", ",
      maxItems: 6,
    },
    { label: "build", items: card.build, separator: "; ", maxItems: 3 },
    { label: "test", items: card.test, separator: "; ", maxItems: 3 },
    { label: "entry points", items: card.entryPoints, separator: ", ", maxItems: 8 },
    { label: "manifests", items: card.manifests, separator: ", ", maxItems: 12 },
    {
      label: "owners",
      items: card.owners.map((rule) => `${rule.pattern} ${rule.owners.join(" ")}`),
      separator: "; ",
      maxItems: 8,
    },
  ];
}

function listText(line: ListLine, shown: number): string {
  const items = line.items.slice(0, shown).map(clean).join(line.separator);
  const hidden = line.items.length - shown;
  return hidden > 0 ? `${line.label}: ${items} (+${String(hidden)} more)` : `${line.label}: ${items}`;
}

// The longest form of the line that fits, dropping trailing items; undefined if not even one fits.
function fitLine(line: ListLine, budget: number): string | undefined {
  for (let shown = Math.min(line.items.length, line.maxItems); shown > 0; shown -= 1) {
    const text = listText(line, shown);
    if (utf8Bytes(text) <= budget) return text;
  }
  return undefined;
}

// Lines are in priority order and rendering stops at the first one that had to be shortened, so a
// card under its cap is always a prefix-stable rendering of the same card.
export function renderRepoCard(card: RepoCard, maxBytes = defaultRepoCardMaxBytes): string {
  const header = clipToBytes(clean(`repo: ${card.name} @ ${card.commit.slice(0, 12)}`), maxBytes);
  const lines = [header];
  let used = utf8Bytes(header);
  for (const line of listLines(card)) {
    if (line.items.length === 0) continue;
    const budget = maxBytes - used - 1;
    const text = fitLine(line, budget);
    if (text === undefined) break;
    lines.push(text);
    used += 1 + utf8Bytes(text);
    if (text !== listText(line, Math.min(line.items.length, line.maxItems))) break;
  }
  return lines.join("\n");
}
