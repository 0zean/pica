import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOutputGuard, defaultCommandDenyList } from "@pica/core";
import type { PolicyContext } from "@pica/core";
import { PicaConfig } from "@pica/protocol";
import { createSessionArtifacts } from "../../src/index.ts";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pica-artifacts-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const context: PolicyContext = {
  cwd: "/work/repo",
  writeRoots: ["/work/repo"],
  referenceRoots: [],
  config: PicaConfig.parse({ routing: { delegation: { output: { maxBytes: 256 } } } }),
  managed: [],
  commandDenyList: defaultCommandDenyList,
};

function binaryLooking(length: number): string {
  let text = "";
  for (let index = 0; index < length; index += 1) {
    text += String.fromCodePoint(index % 11 === 0 ? 0x1f300 + (index % 80) : index % 256);
  }
  return `${text}\r\n\u0000�`;
}

describe("session artifacts", () => {
  it("spills an oversized result to a file byte-equal to the original", async () => {
    const original = binaryLooking(5000);
    const guard = createOutputGuard({ artifacts: createSessionArtifacts(root), policyContext: () => context });
    const outcome = await guard({
      sessionId: "session-1",
      toolCallId: "call-7",
      toolName: "bash",
      arguments: {},
      success: true,
      result: { content: original },
    });

    const path = join(root, "session-1", "artifacts", "tool-output", "call-7.txt");
    expect(outcome.kind === "modify" && outcome.result.content).toContain(`Full output: ${path} `);
    expect(await readFile(path)).toEqual(Buffer.from(original, "utf8"));
  });

  it("keeps ids and names inside the session's directory", async () => {
    const artifacts = createSessionArtifacts(root);
    const written = await artifacts.write("../escape", "../../x/../y.txt", "data");
    if (!written.ok) {
      throw new Error(written.error.message);
    }
    expect(relative(root, written.value.path)).toBe(join(".._escape", "artifacts", "_", "_", "x", "_", "y.txt"));
    expect(await readFile(written.value.path, "utf8")).toBe("data");
  });

  it("returns an error instead of throwing when the file cannot be written", async () => {
    const artifacts = createSessionArtifacts(join(root, "file"));
    await artifacts.write("s", "blocker", "x");
    const blocked = createSessionArtifacts(join(root, "file", "s", "artifacts", "blocker"));
    const written = await blocked.write("s", "out.txt", "x");
    expect(written.ok).toBe(false);
    expect(!written.ok && written.error.code).toBe("artifact.write_failed");
  });
});
