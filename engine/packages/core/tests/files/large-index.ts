// A synthetic monorepo-shaped listing of `count` paths, the same on every run.
export function largeIndex(count: number): readonly string[] {
  const areas = ["app", "engine", "packages", "services", "tools", "docs", "web", "infra"];
  const parts = ["core", "server", "client", "session", "timeline", "composer", "router", "store", "billing", "auth", "search", "review"];
  const kinds = ["components", "models", "views", "handlers", "tests", "utils", "fixtures", "adapters"];
  const words = ["button", "list", "item", "row", "card", "panel", "picker", "index", "config", "helper", "cache", "queue", "event"];
  const extensions = [".ts", ".tsx", ".swift", ".md", ".json", ".test.ts"];
  // xorshift32, so the listing is the same on every run.
  let seed = 2_463_534_242;
  const next = (modulo: number): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % modulo;
  };
  const pick = <T>(values: readonly T[]): T => values[next(values.length)] as T;
  const paths = new Set<string>();
  while (paths.size < count) {
    const depth = 1 + next(4);
    const directories = Array.from({ length: depth }, (_, level) => (level === 0 ? pick(areas) : level === 1 ? pick(parts) : pick(kinds)));
    const name = `${pick(words)}${next(3) === 0 ? `-${pick(words)}` : ""}${String(next(400))}${pick(extensions)}`;
    paths.add(`${directories.join("/")}/${name}`);
  }
  return [...paths];
}

// What a user types: each prefix of these queries is one keystroke.
export const typedQueries = ["sessiontimelinerow", "engine/server/handlers/config", "btn12", "composer picker", "app/core/views/button-list3"];

// PLAN.md §9's budget for one keystroke. Locally (`make verify UNIT=A-09`, the gate per PLAN.md §8.1)
// it is asserted as is. CI's shared Linux runners measured 2.4x slower than a developer Mac on the same
// code (2026-11-17: 53 ms against 22 ms), so on CI the tests only catch a regression past three times it.
export const keystrokeBudgetMs = 50;
export const ciSlowdown = 3;

export function keystrokeLimitMs(env: Readonly<Record<string, string | undefined>> = process.env): number {
  return env["CI"] === "true" ? keystrokeBudgetMs * ciSlowdown : keystrokeBudgetMs;
}

export interface KeystrokeTiming {
  readonly query: string;
  readonly ms: number;
}

// Types every prefix of `typedQueries` with `search`, three times over (after a warm-up typing that is
// not counted); a keystroke's time is the median of its three, so one garbage collection or a busy
// moment on the machine does not decide the result.
// `wall` is elapsed time. `cpu` is this process's CPU time, which leaves out time spent waiting for a
// CPU on a busy machine (CI runs test files in parallel); it fits work that never waits, like ranking.
export type KeystrokeClock = "wall" | "cpu";

export async function timeKeystrokes(
  startTyping: () => (query: string) => unknown,
  clock: KeystrokeClock = "wall",
): Promise<readonly KeystrokeTiming[]> {
  await typeAll(startTyping(), clock);
  const runs: (readonly KeystrokeTiming[])[] = [];
  for (let run = 0; run < 3; run += 1) runs.push(await typeAll(startTyping(), clock));
  return (runs[0] ?? []).map((timing, index) => ({
    query: timing.query,
    ms: median(runs.map((typed) => typed[index]?.ms ?? Number.POSITIVE_INFINITY)),
  }));
}

async function typeAll(search: (query: string) => unknown, clock: KeystrokeClock): Promise<readonly KeystrokeTiming[]> {
  const now = clock === "wall" ? () => performance.now() : cpuMs;
  const timings: KeystrokeTiming[] = [];
  for (const typed of typedQueries) {
    for (let length = 1; length <= typed.length; length += 1) {
      const query = typed.slice(0, length);
      const started = now();
      await search(query);
      timings.push({ query, ms: now() - started });
    }
  }
  return timings;
}

function cpuMs(): number {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
}

export function slowest(timings: readonly KeystrokeTiming[]): KeystrokeTiming {
  return timings.reduce((worst, timing) => (timing.ms > worst.ms ? timing : worst));
}
