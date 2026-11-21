import type { CustomizationItem } from "@pica/protocol";
import type { DescribedFile } from "./describe.ts";

// `files` are in location order, lowest precedence first. Agents and skills of one name: the last
// valid one wins, as C-02's `resolveAgents` decides. The same name twice in one location is an
// error there, so the second is invalid here. Instruction files all apply.
export function resolveCustomizations(files: readonly DescribedFile[]): CustomizationItem[] {
  const firstInLocation = new Map<string, string>();
  const checked = files.map((file) => {
    if (file.problems.length > 0 || file.kind === "instructions") return file;
    const key = `${file.locationId}/${file.name}`;
    const earlier = firstInLocation.get(key);
    if (earlier === undefined) {
      firstInLocation.set(key, file.path);
      return file;
    }
    return { ...file, problems: [{ field: "name", message: `"${file.name}" is also defined in ${earlier}, in the same location` }] };
  });

  const winners = new Map<string, string>();
  for (const file of checked) {
    if (file.problems.length === 0 && file.kind !== "instructions") winners.set(file.name, file.path);
  }
  const items = checked.map((file): CustomizationItem => {
    if (file.problems.length > 0) return { ...file, status: "invalid", overriddenBy: null };
    const winner = winners.get(file.name);
    if (file.kind === "instructions" || winner === file.path || winner === undefined) {
      return { ...file, status: "active", overriddenBy: null };
    }
    return { ...file, status: "overridden", overriddenBy: winner };
  });
  // By name, then the winning (highest) location first.
  const order = new Map(files.map((file, index) => [file.path, index]));
  return items.sort((a, b) => a.name.localeCompare(b.name) || (order.get(b.path) ?? 0) - (order.get(a.path) ?? 0));
}
