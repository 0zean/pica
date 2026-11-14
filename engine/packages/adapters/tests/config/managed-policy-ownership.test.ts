import { statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FileOwnership } from "@pica/core";
import { ManagedPolicyLoader, nodeManagedPolicyFileSystem } from "../../src/index.ts";
import type { ManagedPolicyCandidate, ManagedPolicyFileSystem } from "../../src/index.ts";
import { useTempDir, writeFile } from "./helpers.ts";

const tempDir = useTempDir();
const rootOwned: FileOwnership = { uid: 0, mode: 0o100644 };
const rootDirectory: FileOwnership = { uid: 0, mode: 0o40755 };

// Real files, fake owners: every path is root-owned unless listed in `owners`.
function fakeOwnership(owners: Readonly<Record<string, FileOwnership>> = {}): ManagedPolicyFileSystem {
  return {
    ...nodeManagedPolicyFileSystem,
    ownership: (path) => owners[path] ?? (statSync(path).isDirectory() ? rootDirectory : rootOwned),
    readPlist: (path) => JSON.parse(nodeManagedPolicyFileSystem.readText(path)) as unknown,
  };
}

function policyFile(text = '{ "id": "acme", "permissions": { "minimumMode": "ask" } }'): ManagedPolicyCandidate {
  const directory = nodeManagedPolicyFileSystem.realpath(tempDir());
  return { format: "jsonc", path: writeFile(join(directory, "policy.jsonc"), text) };
}

function load(candidates: readonly ManagedPolicyCandidate[], fs: ManagedPolicyFileSystem) {
  const loaded = new ManagedPolicyLoader(candidates, fs).load();
  if (!loaded.ok) {
    throw new Error(loaded.error.message);
  }
  return loaded.value;
}

describe("managed policy file ownership", () => {
  it("ignores a policy file not owned by root, with a warning", () => {
    const file = policyFile();
    const loaded = load([file], fakeOwnership({ [file.path]: { uid: 501, mode: 0o100644 } }));
    expect(loaded.policy).toBeUndefined();
    expect(loaded.warnings).toEqual([
      { code: "managed_policy.untrusted_file", message: `ignoring managed policy ${file.path}: ${file.path} is owned by uid 501, not root` },
    ]);
  });

  it("ignores a root-owned policy file that others can write, with a warning", () => {
    const file = policyFile();
    const loaded = load([file], fakeOwnership({ [file.path]: { uid: 0, mode: 0o100666 } }));
    expect(loaded.policy).toBeUndefined();
    expect(loaded.warnings).toEqual([
      { code: "managed_policy.untrusted_file", message: `ignoring managed policy ${file.path}: ${file.path} is writable by users other than root` },
    ]);
  });

  it("ignores a root-owned policy file in a directory another user owns, with a warning", () => {
    const file = policyFile();
    const directory = file.path.slice(0, file.path.lastIndexOf("/"));
    const loaded = load([file], fakeOwnership({ [directory]: { uid: 501, mode: 0o40755 } }));
    expect(loaded.policy).toBeUndefined();
    expect(loaded.warnings.map((warning) => warning.message)).toEqual([
      `ignoring managed policy ${file.path}: ${directory} is owned by uid 501, not root`,
    ]);
  });

  it("checks the owner of the file a symlink points to", () => {
    const file = policyFile();
    const link = join(nodeManagedPolicyFileSystem.realpath(tempDir()), "policy.jsonc");
    symlinkSync(file.path, link);
    const loaded = load([{ format: "jsonc", path: link }], fakeOwnership({ [file.path]: { uid: 501, mode: 0o100644 } }));
    expect(loaded.policy).toBeUndefined();
    expect(loaded.warnings).toHaveLength(1);
  });

  it("loads a root-owned policy file", () => {
    const file = policyFile();
    const loaded = load([file], fakeOwnership());
    expect(loaded.warnings).toEqual([]);
    expect(loaded.policy).toMatchObject({ id: "acme", source: file.path, minimumPermissionMode: "ask" });
  });

  it("uses the next trusted source after an untrusted one", () => {
    const untrusted = policyFile('{ "id": "spoofed" }');
    const trusted = policyFile();
    const loaded = load([untrusted, trusted], fakeOwnership({ [untrusted.path]: { uid: 501, mode: 0o100644 } }));
    expect(loaded.policy?.id).toBe("acme");
    expect(loaded.warnings.map((warning) => warning.code)).toEqual(["managed_policy.untrusted_file"]);
  });

  it("prefers managed preferences and reports the file it shadows", () => {
    const preferences = { format: "plist", path: policyFile('{ "id": "mdm" }').path } as const;
    const file = policyFile();
    const loaded = load([preferences, file], fakeOwnership());
    expect(loaded.policy?.id).toBe("mdm");
    expect(loaded.warnings).toEqual([
      { code: "managed_policy.shadowed", message: `ignoring managed policy ${file.path}: ${preferences.path} takes precedence` },
    ]);
  });

  it("has no policy and no warning when no source exists", () => {
    expect(load([{ format: "jsonc", path: join(tempDir(), "absent.jsonc") }], fakeOwnership())).toEqual({ policy: undefined, warnings: [] });
  });

  it("fails rather than dropping restrictions when a trusted policy is invalid", () => {
    const file = policyFile('{\n  "permissions": { "minimumMode": "never" }\n}');
    const loaded = new ManagedPolicyLoader([file], fakeOwnership()).load();
    expect(loaded).toMatchObject({ ok: false, error: { code: "config.invalid", file: file.path, issues: [{ keyPath: "permissions.minimumMode", line: 2 }] } });
  });

  it.runIf(process.platform === "darwin")("reads a managed preferences property list with plutil", () => {
    const plist = writeFile(
      join(tempDir(), "dev.pica.Pica.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>id</key><string>mdm</string>
  <key>models</key><dict><key>allow</key><array><string>approved</string></array></dict>
</dict></plist>
`,
    );
    const loaded = load([{ format: "plist", path: plist }], { ...nodeManagedPolicyFileSystem, ownership: () => rootOwned });
    expect(loaded.policy).toMatchObject({ id: "mdm", models: { allow: ["approved"] } });
  });
});
