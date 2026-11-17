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
