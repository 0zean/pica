import { globPattern } from "../policy/read-exclusions.ts";
import { compareText } from "./refs.ts";

export interface SearchQuery {
  readonly text: string;
  readonly caseSensitive: boolean;
  // A glob over repo-relative paths (`**` spans directories).
  readonly pathGlob?: string;
}

export interface SearchHit {
  readonly repo: string;
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

const maxLineChars = 200;

export function pathFilter(glob: string | undefined): (path: string) => boolean {
  if (glob === undefined || glob === "") return () => true;
  const matcher = globPattern(glob);
  return (path) => matcher.test(path);
}

// Files in code-point order, so hits come out repo by repo, path by path, line by line.
export function sortedPaths(paths: readonly string[]): readonly string[] {
  return [...paths].sort(compareText);
}

export function matchLines(repo: string, path: string, content: string, query: SearchQuery): readonly SearchHit[] {
  const needle = query.caseSensitive ? query.text : query.text.toLowerCase();
  const hits: SearchHit[] = [];
  content.split("\n").forEach((line, index) => {
    const haystack = query.caseSensitive ? line : line.toLowerCase();
    if (haystack.includes(needle)) {
      hits.push({ repo, path, line: index + 1, text: clip(line.replace(/\r$/, "").trim()) });
    }
  });
  return hits;
}

export function formatHit(hit: SearchHit): string {
  return `${hit.repo}:${hit.path}:${String(hit.line)}: ${hit.text}`;
}

function clip(line: string): string {
  return line.length <= maxLineChars ? line : `${line.slice(0, maxLineChars)}…`;
}
