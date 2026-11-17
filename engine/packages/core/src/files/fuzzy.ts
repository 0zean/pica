// A-09: the quick-open ranking (docs/files.md). A path matches when the query's characters appear in
// it in order, ignoring case and spaces. Among the ways they can be placed, the best is kept: each
// matched character scores, more at the start of a word and in the file name, a run of adjacent
// characters earns its first character's bonus on every character, and gaps cost.

export const fuzzyScores = {
  match: 16,
  // The first character of the path, or one after "/".
  segmentStart: 10,
  // After "-", "_", ".", or a space, or an upper-case letter after a lower-case one.
  wordStart: 8,
  // Any match inside the last path segment, the file name.
  fileName: 4,
  // The least a character right after the previous match earns; it earns its run's first bonus if larger.
  adjacent: 4,
  gapStart: -3,
  gapExtension: -1,
  // The query is the whole file name, or the start of it.
  fileNameExact: 40,
  fileNamePrefix: 20,
} as const;

// Paths prepared once, so ranking a keystroke reads flat arrays instead of strings.
export interface PreparedPaths {
  readonly paths: readonly string[];
  // Lower-cased UTF-16 code units of every path, back to back.
  readonly codes: Uint16Array;
  // The bonus each code unit earns when matched.
  readonly bonuses: Int8Array;
  // Where each path starts in `codes`; one more entry than paths, for the end of the last.
  readonly starts: Uint32Array;
  // Where each path's file name starts, as an offset into `codes`.
  readonly fileNameStarts: Uint32Array;
}

export function preparePaths(paths: readonly string[]): PreparedPaths {
  let total = 0;
  for (const path of paths) total += path.length;
  const codes = new Uint16Array(total);
  const bonuses = new Int8Array(total);
  const starts = new Uint32Array(paths.length + 1);
  const fileNameStarts = new Uint32Array(paths.length);
  let offset = 0;
  paths.forEach((path, index) => {
    starts[index] = offset;
    const lower = path.toLowerCase();
    // Lower-casing keeps the length for the characters paths use; others are kept as written.
    const folded = lower.length === path.length ? lower : path;
    const fileName = path.lastIndexOf("/") + 1;
    fileNameStarts[index] = offset + fileName;
    for (let at = 0; at < path.length; at += 1) {
      codes[offset + at] = folded.charCodeAt(at);
      bonuses[offset + at] = bonusAt(path, at) + (at >= fileName ? fuzzyScores.fileName : 0);
    }
    offset += path.length;
  });
  starts[paths.length] = offset;
  return { paths, codes, bonuses, starts, fileNameStarts };
}

// What a query looks for: its lower-cased characters without spaces.
export function queryCodes(query: string): Uint16Array {
  const lower = query.toLowerCase().replace(/\s+/g, "");
  const codes = new Uint16Array(lower.length);
  for (let at = 0; at < lower.length; at += 1) codes[at] = lower.charCodeAt(at);
  return codes;
}

// Scratch space for scoring one query, sized for the longest path.
export interface ScoreScratch {
  // Per query character: the earliest and the latest position it can be matched at.
  readonly earliest: Int32Array;
  readonly latest: Int32Array;
  // Two rows of the table, each a list of the positions where that query character matches, the
  // best score with it matched there, and the bonus its run of adjacent matches started with.
  readonly positions: readonly [Int32Array, Int32Array];
  readonly scores: readonly [Int32Array, Int32Array];
  readonly runs: readonly [Int8Array, Int8Array];
}

export function scoreScratch(longestPath: number, queryLength: number): ScoreScratch {
  const size = longestPath + 1;
  return {
    earliest: new Int32Array(queryLength),
    latest: new Int32Array(queryLength),
    positions: [new Int32Array(size), new Int32Array(size)],
    scores: [new Int32Array(size), new Int32Array(size)],
    runs: [new Int8Array(size), new Int8Array(size)],
  };
}

// Scores path `index` against `query`; null when it does not match.
export function scorePrepared(prepared: PreparedPaths, index: number, query: Uint16Array, scratch: ScoreScratch): number | null {
  const start = prepared.starts[index] ?? 0;
  const end = prepared.starts[index + 1] ?? start;
  if (query.length === 0 || !placeBounds(prepared.codes, start, end, query, scratch)) return null;
  const best = bestAlignment(prepared, query, scratch);
  return best + fileNameBonus(prepared, prepared.fileNameStarts[index] ?? start, end, query);
}

// Scores one path; for tests and single lookups.
export function fuzzyScore(query: string, path: string): number | null {
  const prepared = preparePaths([path]);
  const codes = queryCodes(query);
  return scorePrepared(prepared, 0, codes, scoreScratch(path.length, codes.length));
}

// Fills each query character's earliest position (matching greedily from the start) and latest
// (greedily from the end); false when the query is not a subsequence of the path. Every placement
// lies between the two, so only those cells are scored.
function placeBounds(codes: Uint16Array, start: number, end: number, query: Uint16Array, scratch: ScoreScratch): boolean {
  const { earliest, latest } = scratch;
  let wanted = 0;
  for (let at = start; at < end && wanted < query.length; at += 1) {
    if (codes[at] === query[wanted]) {
      earliest[wanted] = at;
      wanted += 1;
    }
  }
  if (wanted < query.length) return false;
  wanted = query.length - 1;
  for (let at = end - 1; wanted >= 0; at -= 1) {
    if (codes[at] === query[wanted]) {
      latest[wanted] = at;
      wanted -= 1;
    }
  }
  return true;
}

const none = -1_000_000;

// The best total over every placement of the query's characters, one row per query character over
// the positions it matches at. Reaching position `at` from the previous character at `k`: right
// after it (k = at - 1) the run goes on and keeps its bonus; further back, the gap costs
// `gapStart + gapExtension * (at - k - 2)`, which is `(score[k] + k) - at` plus a constant, so the
// best gap so far is a running maximum of `score[k] + k`.
function bestAlignment(prepared: PreparedPaths, query: Uint16Array, scratch: ScoreScratch): number {
  const { codes, bonuses } = prepared;
  const { earliest, latest, positions, scores, runs } = scratch;
  let previous: 0 | 1 = 0;
  let count = 0;
  for (let at = earliest[0] ?? 0; at <= (latest[0] ?? -1); at += 1) {
    if (codes[at] !== query[0]) continue;
    const bonus = bonuses[at] ?? 0;
    positions[0][count] = at;
    scores[0][count] = fuzzyScores.match + bonus;
    runs[0][count] = bonus;
    count += 1;
  }
  const gapBase = fuzzyScores.gapStart - 2 * fuzzyScores.gapExtension;
  for (let row = 1; row < query.length; row += 1) {
    const current: 0 | 1 = previous === 0 ? 1 : 0;
    const fromPositions = positions[previous];
    const fromScores = scores[previous];
    const fromRuns = runs[previous];
    const toPositions = positions[current];
    const toScores = scores[current];
    const toRuns = runs[current];
    let next = 0;
    let reach = 0;
    let bestGap = none;
    let written = 0;
    for (let at = earliest[row] ?? 0; at <= (latest[row] ?? -1); at += 1) {
      if (codes[at] !== query[row]) continue;
      while (reach < count && (fromPositions[reach] ?? 0) <= at - 2) {
        bestGap = Math.max(bestGap, (fromScores[reach] ?? none) - fuzzyScores.gapExtension * (fromPositions[reach] ?? 0));
        reach += 1;
      }
      while (next < count && (fromPositions[next] ?? 0) < at - 1) next += 1;
      const bonus = bonuses[at] ?? 0;
      const touching = next < count && fromPositions[next] === at - 1;
      const runBonus = touching ? (fromRuns[next] ?? 0) : 0;
      const adjacent = touching ? (fromScores[next] ?? none) + Math.max(bonus, runBonus, fuzzyScores.adjacent) : none;
      const gapped = bestGap <= none / 2 ? none : bestGap + fuzzyScores.gapExtension * at + gapBase + bonus;
      const best = Math.max(adjacent, gapped);
      if (best <= none / 2) continue;
      toPositions[written] = at;
      toScores[written] = best + fuzzyScores.match;
      toRuns[written] = adjacent >= gapped ? Math.max(bonus, runBonus) : bonus;
      written += 1;
    }
    previous = current;
    count = written;
  }
  let best = none;
  for (let at = 0; at < count; at += 1) best = Math.max(best, scores[previous][at] ?? none);
  return best;
}

function fileNameBonus(prepared: PreparedPaths, fileName: number, end: number, query: Uint16Array): number {
  if (end - fileName < query.length) return 0;
  for (let at = 0; at < query.length; at += 1) {
    if (prepared.codes[fileName + at] !== query[at]) return 0;
  }
  return end - fileName === query.length ? fuzzyScores.fileNameExact : fuzzyScores.fileNamePrefix;
}

function bonusAt(path: string, at: number): number {
  if (at === 0) return fuzzyScores.segmentStart;
  const before = path.charAt(at - 1);
  if (before === "/") return fuzzyScores.segmentStart;
  if (before === "-" || before === "_" || before === "." || before === " ") return fuzzyScores.wordStart;
  const char = path.charAt(at);
  if (isUpper(char) && isLower(before)) return fuzzyScores.wordStart;
  return 0;
}

function isUpper(char: string): boolean {
  return char !== char.toLowerCase() && char === char.toUpperCase();
}

function isLower(char: string): boolean {
  return char !== char.toUpperCase() && char === char.toLowerCase();
}
