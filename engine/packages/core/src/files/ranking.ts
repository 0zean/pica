import { compareText } from "../repo-tools/refs.ts";
import { preparePaths, queryCodes, scorePrepared, scoreScratch, type PreparedPaths } from "./fuzzy.ts";

export interface RankedPath {
  readonly path: string;
  readonly score: number;
}

// One repo's paths, ready to rank. It remembers which paths the last query matched, so a query
// that extends it (the next keystroke) only looks at those.
export interface PathRanker {
  readonly size: number;
  rank(query: string, limit: number): readonly RankedPath[];
}

export function createPathRanker(paths: readonly string[]): PathRanker {
  const prepared = preparePaths(paths);
  let longest = 0;
  for (const path of paths) longest = Math.max(longest, path.length);
  let last: { readonly query: string; readonly matches: Uint32Array } | undefined;

  return {
    size: paths.length,
    rank(query, limit) {
      const folded = query.toLowerCase().replace(/\s+/g, "");
      const codes = queryCodes(folded);
      if (codes.length === 0 || limit <= 0) return [];
      const narrowed = last !== undefined && folded.startsWith(last.query) ? last.matches : undefined;
      const scratch = scoreScratch(longest, codes.length);
      const top = new TopPaths(limit);
      const matches: number[] = [];
      const count = narrowed?.length ?? paths.length;
      for (let at = 0; at < count; at += 1) {
        const index = narrowed === undefined ? at : (narrowed[at] ?? 0);
        const score = scorePrepared(prepared, index, codes, scratch);
        if (score === null) continue;
        matches.push(index);
        top.offer(prepared, index, score);
      }
      last = { query: folded, matches: Uint32Array.from(matches) };
      return top.sorted(prepared);
    },
  };
}

// Better first: higher score, then the shorter path, then code-point order.
export function compareRanked(a: RankedPath, b: RankedPath): number {
  return b.score - a.score || a.path.length - b.path.length || compareText(a.path, b.path);
}

// The best `limit` paths seen so far, kept sorted; most offers lose to the worst kept one at once.
class TopPaths {
  private readonly kept: { readonly index: number; readonly score: number }[] = [];
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  offer(prepared: PreparedPaths, index: number, score: number): void {
    const worst = this.kept.at(-1);
    if (this.kept.length >= this.limit && worst !== undefined && !before(prepared, index, score, worst)) return;
    let at = this.kept.length;
    while (at > 0) {
      const previous = this.kept[at - 1];
      if (previous === undefined || !before(prepared, index, score, previous)) break;
      at -= 1;
    }
    this.kept.splice(at, 0, { index, score });
    if (this.kept.length > this.limit) this.kept.pop();
  }

  sorted(prepared: PreparedPaths): readonly RankedPath[] {
    return this.kept.map(({ index, score }) => ({ path: prepared.paths[index] ?? "", score }));
  }
}

// `compareRanked`, without building the two entries for every offer.
function before(prepared: PreparedPaths, index: number, score: number, other: { readonly index: number; readonly score: number }): boolean {
  if (score !== other.score) return score > other.score;
  const path = prepared.paths[index] ?? "";
  const otherPath = prepared.paths[other.index] ?? "";
  if (path.length !== otherPath.length) return path.length < otherPath.length;
  return compareText(path, otherPath) < 0;
}
