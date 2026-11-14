import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decide, withRealPaths, type PolicyContext, type ToolCall, type ToolTarget } from "../../src/index.ts";
import { baseContext, policyConfig } from "../policy/fixtures.ts";

const writeRoots = ["/work/repo", "/work/repo2"];
const referenceRoots = ["/ref/lib"];

// A small filesystem of symlinks: some stay inside the roots, some lead out, one loops.
const links = new Map<string, string>([
  ["/work/repo/out", "/etc"],
  ["/work/repo/up", ".."],
  ["/work/repo/ref", "/ref/lib"],
  ["/work/repo/self", "."],
  ["/work/repo/loop", "loop"],
  ["/work/repo/src/sibling", "../../repo2"],
  ["/ref/lib/back", "/work/repo"],
  ["/ref/lib/deep", "../../tmp/x"],
  ["/tmp", "/private/tmp"],
]);

// An independent model of the OS: restart resolution from the link target, as a kernel would.
function fakeRealPath(path: string, depth = 0): string {
  const parts = path.split("/").filter((part) => part !== "" && part !== ".");
  const resolved: string[] = [];
  for (const [index, part] of parts.entries()) {
    if (part === "..") {
      resolved.pop();
      continue;
    }
    const link = depth < 32 ? links.get(`/${[...resolved, part].join("/")}`) : undefined;
    if (link !== undefined) {
      const base = link.startsWith("/") ? link : `/${resolved.join("/")}/${link}`;
      return fakeRealPath([base, ...parts.slice(index + 1)].join("/"), depth + 1);
    }
    resolved.push(part);
  }
  return `/${resolved.join("/")}`;
}

const resolveFake = (path: string): Promise<string> => Promise.resolve(fakeRealPath(path));

function lexical(path: string): string {
  const resolved: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") {
      resolved.pop();
    } else if (part !== "" && part !== ".") {
      resolved.push(part);
    }
  }
  return `/${resolved.join("/")}`;
}

const join = (cwd: string, path: string): string => (path.startsWith("/") ? path : `${cwd}/${path}`);
const inside = (path: string, roots: readonly string[]): boolean =>
  roots.some((root) => path === root || path.startsWith(`${root}/`));

const segment = fc.constantFrom("work", "repo", "repo2", "ref", "lib", "out", "up", "self", "loop", "sibling", "back", "deep", "src", "tmp", "etc", "a.ts", "..", ".", "");
const path = fc
  .tuple(fc.boolean(), fc.array(segment, { minLength: 1, maxLength: 7 }))
  .map(([absolute, parts]) => `${absolute ? "/" : ""}${parts.join("/")}` || ".");

type Step = { readonly op: "cd" | "redirect" | "tee"; readonly arg: string };
const step: fc.Arbitrary<Step> = fc.record({ op: fc.constantFrom("cd", "redirect", "tee"), arg: path });

interface Scenario {
  readonly target: ToolTarget;
  // Real paths the call touches and the roots each must be inside; `undefined` = cannot be known.
  readonly touched: readonly { readonly path: string | undefined; readonly writes: boolean }[];
}

function shellScenario(cwd: string, shellCwd: string, steps: readonly Step[]): Scenario {
  let current = join(cwd, shellCwd);
  const touched: { path: string | undefined; writes: boolean }[] = [{ path: fakeRealPath(current), writes: true }];
  const commands = steps.map(({ op, arg }) => {
    touched.push({ path: fakeRealPath(join(current, arg)), writes: true });
    if (op === "cd") {
      current = lexical(join(current, arg));
      return `cd ${arg}`;
    }
    return op === "redirect" ? `echo x > ${arg}` : `echo x | tee ${arg}`;
  });
  return { target: { kind: "shell", command: commands.join(" && "), cwd: shellCwd }, touched };
}

const scenario = (cwd: string): fc.Arbitrary<Scenario> =>
  fc.oneof(
    path.map((p): Scenario => ({ target: { kind: "read", path: p, sizeBytes: 10 }, touched: [{ path: fakeRealPath(join(cwd, p)), writes: false }] })),
    path.map((p): Scenario => ({ target: { kind: "write", path: p }, touched: [{ path: fakeRealPath(join(cwd, p)), writes: true }] })),
    fc.array(path, { maxLength: 3 }).map((paths): Scenario => ({
      target: { kind: "search", paths },
      touched: paths.map((p) => ({ path: fakeRealPath(join(cwd, p)), writes: false })),
    })),
    fc.tuple(path, fc.array(step, { maxLength: 4 })).map(([shellCwd, steps]) => shellScenario(cwd, shellCwd, steps)),
  );

const input = fc
  .record({
    cwd: fc.constantFrom("/work/repo", "/work/repo/src", "/work/repo2", "/ref/lib"),
    mode: fc.constantFrom("ask", "auto"),
    roots: fc.subarray(writeRoots, { minLength: 1 }),
  })
  .chain((setup) => scenario(setup.cwd).map((s) => ({ ...setup, ...s })));

function contextFor(cwd: string, mode: string, roots: readonly string[]): PolicyContext {
  return baseContext({ cwd, writeRoots: roots, referenceRoots, config: policyConfig({ permissions: { mode } }), commandDenyList: [] });
}

describe("session scope with symlinks resolved", () => {
  it("never lets a call that touches a real path outside its roots through", async () => {
    let passed = 0;
    await fc.assert(
      fc.asyncProperty(input, async ({ cwd, mode, roots, target, touched }) => {
        const call: ToolCall = { id: "call", tool: "tool", agent: "bulk-reader", target };
        const context = contextFor(cwd, mode, roots);
        const decision = decide(call, await withRealPaths(call, context, resolveFake));
        if (decision.outcome === "deny" || decision.ruleGroup === "safety") {
          return;
        }
        passed += 1;
        const realWriteRoots = roots.map((root) => fakeRealPath(root));
        const realRoots = [...realWriteRoots, ...referenceRoots.map((root) => fakeRealPath(root))];
        for (const entry of touched) {
          expect(entry.path).toBeDefined();
          expect(inside(entry.path ?? "", entry.writes ? realWriteRoots : realRoots), `${String(entry.path)} for ${JSON.stringify(target)}`).toBe(true);
        }
      }),
      { numRuns: 4000, seed: 7007 },
    );
    expect(passed).toBeGreaterThan(400);
  });

  it("denies, or asks about, every generated escape", async () => {
    let escapes = 0;
    await fc.assert(
      fc.asyncProperty(input, async ({ cwd, mode, roots, target, touched }) => {
        const realRoots = [...roots, ...referenceRoots].map((root) => fakeRealPath(root));
        fc.pre(touched.some((entry) => entry.path !== undefined && !inside(entry.path, realRoots)));
        escapes += 1;
        const call: ToolCall = { id: "call", tool: "tool", agent: "main", target };
        const decision = decide(call, await withRealPaths(call, contextFor(cwd, mode, roots), resolveFake));
        expect(decision.ruleGroup).toBe("safety");
        expect(decision.outcome).toBe(mode === "auto" ? "deny" : target.kind === "shell" ? "ask" : "deny");
      }),
      { numRuns: 4000, seed: 7008 },
    );
    expect(escapes).toBeGreaterThan(400);
  });
});
