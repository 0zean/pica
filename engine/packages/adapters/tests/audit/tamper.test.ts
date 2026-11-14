import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { entryLine, openAuditLog, sealEntry, verifyAuditLines } from "@pica/core";
import type { AuditEntry, AuditLog, AuditRecord } from "@pica/core";
import { createJsonlAuditStore, exportAuditFile, sha256Hex } from "../../src/index.ts";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pica-audit-"));
  path = join(dir, "audit.jsonl");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const records: readonly AuditRecord[] = [
  tool("tool.started", 1, "call-1"),
  decision(2, "call-1", "cost.large-read", "deny", "Read schema.sql (212 KB) with bulk-reader"),
  tool("tool.failed", 3, "call-1"),
  tool("tool.started", 4, "call-2"),
  decision(5, "call-2", "permission.read-only", "allow", "Read-only tools run without asking"),
  { sessionId: "session-1", eventSeq: 6, timestamp: at(6), kind: "approval.requested", data: { approvalId: "a-1", approvalKind: "tool_call", toolCallId: "call-3" } },
  { sessionId: "session-1", eventSeq: 7, timestamp: at(7), kind: "approval.resolved", data: { approvalId: "a-1", choice: "allow_once" } },
  { ...tool("tool.completed", 8, "call-2"), data: { toolCallId: "call-2", toolName: "view", agent: "main", parentToolCallId: null, resultBytes: 10240 } },
  decision(9, "call-4", "cost.oversized-output", "rewrite", "Result is 9000 bytes (limit 1024); truncated, full output spilled"),
  { ...tool("tool.started", 1, "call-9"), sessionId: "session-2", data: { toolCallId: "call-9", toolName: "view", agent: "bulk-reader", parentToolCallId: "call-8" } },
];

function at(seq: number): string {
  return `2026-11-14T09:00:${String(seq).padStart(2, "0")}.000Z`;
}

function tool(kind: "tool.started" | "tool.completed" | "tool.failed", eventSeq: number, toolCallId: string): AuditRecord {
  return { sessionId: "session-1", eventSeq, timestamp: at(eventSeq), kind, data: { toolCallId, toolName: "view", agent: "main", parentToolCallId: null } };
}

function decision(eventSeq: number, toolCallId: string, ruleId: string, outcome: string, reason: string): AuditRecord {
  return {
    sessionId: "session-1",
    eventSeq,
    timestamp: at(eventSeq),
    kind: "policy.decision",
    data: { ruleId, ruleGroup: ruleId.split(".")[0] ?? "", outcome, reason, toolCallId, toolName: "view", agent: "main" },
  };
}

function open(): AuditLog {
  const opened = openAuditLog({ store: createJsonlAuditStore(path), hash: sha256Hex });
  if (!opened.ok) {
    throw new Error(opened.error.message);
  }
  return opened.value;
}

async function writeLog(): Promise<string[]> {
  const audit = open();
  for (const record of records) {
    expect(audit.record(record).ok).toBe(true);
  }
  const text = await readFile(path, "utf8");
  expect(text.endsWith("\n")).toBe(true);
  return text.slice(0, -1).split("\n");
}

function failingLine(lines: readonly string[]): number | undefined {
  const verified = verifyAuditLines(lines, sha256Hex);
  return verified.ok ? undefined : verified.error.line;
}

function replaceLine(lines: readonly string[], index: number, line: string): string[] {
  return lines.map((original, i) => (i === index ? line : original));
}

function parsed(line: string): AuditEntry {
  return JSON.parse(line) as AuditEntry;
}

describe("audit log hash chain", () => {
  it("verifies the untouched log, and each line carries the previous line's hash", async () => {
    const lines = await writeLog();
    expect(verifyAuditLines(lines, sha256Hex)).toMatchObject({ ok: true, value: { entries: records.length } });
    for (const [index, line] of lines.entries()) {
      const previous = lines[index - 1];
      expect(parsed(line).prevHash).toBe(previous === undefined ? "0".repeat(64) : parsed(previous).hash);
    }
  });

  it("fails at the altered line for every single-character change to any line", async () => {
    const lines = await writeLog();
    for (const [index, line] of lines.entries()) {
      for (let position = 0; position < line.length; position += 1) {
        const changed = line.charCodeAt(position) === 0x30 ? "1" : "0";
        const altered = `${line.slice(0, position)}${changed}${line.slice(position + 1)}`;
        expect({ index, position, line: failingLine(replaceLine(lines, index, altered)) }).toEqual({ index, position, line: index + 1 });
      }
    }
  });

  it("fails at the altered line for added whitespace, truncation, blanking, deletion, insertion and reordering", async () => {
    const lines = await writeLog();
    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;
      expect(failingLine(replaceLine(lines, index, ` ${line}`))).toBe(lineNumber);
      expect(failingLine(replaceLine(lines, index, line.replace(":", ": ")))).toBe(lineNumber);
      expect(failingLine(replaceLine(lines, index, line.slice(0, -1)))).toBe(lineNumber);
      expect(failingLine(replaceLine(lines, index, ""))).toBe(lineNumber);
      expect(failingLine(lines.filter((_, i) => i !== index))).toBe(index === lines.length - 1 ? undefined : lineNumber);
      expect(failingLine([...lines.slice(0, index), line, ...lines.slice(index)])).toBe(lineNumber + 1);
      const next = lines[index + 1];
      if (next !== undefined) {
        expect(failingLine(replaceLine(replaceLine(lines, index, next), index + 1, line))).toBe(lineNumber);
      }
    }
  });

  it("fails at the altered line when a field is changed and the JSON re-serialized", async () => {
    const lines = await writeLog();
    for (const [index, line] of lines.entries()) {
      const entry = parsed(line);
      const edits: AuditEntry[] = [
        { ...entry, timestamp: "2026-11-15T00:00:00.000Z" },
        { ...entry, sessionId: "session-x" },
        { ...entry, eventSeq: entry.eventSeq + 1 },
        { ...entry, data: { ...entry.data, toolCallId: "call-forged" } },
        { ...entry, seq: entry.seq + 1 },
        { ...entry, prevHash: sha256Hex("forged") },
        { ...entry, hash: sha256Hex("forged") },
      ];
      for (const edited of edits) {
        expect(failingLine(replaceLine(lines, index, entryLine(edited)))).toBe(index + 1);
      }
    }
  });

  // Re-sealing an edited line moves the break to the next line; re-sealing every line after it is
  // only caught by comparing against a head hash kept elsewhere, which export reports.
  it("a re-sealed edit breaks the next line and changes the exported head", async () => {
    const lines = await writeLog();
    const original = exportAuditFile(path, join(dir, "original.jsonl"));
    expect(original.ok).toBe(true);
    const index = 3;
    const previous = parsed(lines[index - 1] ?? "");
    const target = parsed(lines[index] ?? "");
    const forged = sealEntry({ seq: previous.seq, hash: previous.hash }, { ...target, data: { ...target.data, agent: "forged" } }, sha256Hex);
    const resealed = replaceLine(lines, index, entryLine(forged));
    expect(failingLine(resealed)).toBe(index + 2);

    let head = { seq: forged.seq, hash: forged.hash };
    const rewritten = resealed.map((line, i) => {
      if (i <= index) {
        return line;
      }
      const entry = sealEntry(head, parsed(line), sha256Hex);
      head = { seq: entry.seq, hash: entry.hash };
      return entryLine(entry);
    });
    expect(failingLine(rewritten)).toBeUndefined();
    await writeFile(path, `${rewritten.join("\n")}\n`);
    const forgedExport = exportAuditFile(path, join(dir, "forged.jsonl"));
    expect(forgedExport.ok && original.ok && forgedExport.value.head.hash !== original.value.head.hash).toBe(true);
  });

  it("continues the chain across reopening and refuses to append to a broken log", async () => {
    const lines = await writeLog();
    const reopened = open();
    const appended = reopened.record(tool("tool.started", 99, "call-99"));
    expect(appended).toMatchObject({ ok: true, value: { seq: lines.length + 1, prevHash: parsed(lines.at(-1) ?? "").hash } });
    expect(verifyAuditLines((await readFile(path, "utf8")).trimEnd().split("\n"), sha256Hex).ok).toBe(true);

    await writeFile(path, `${replaceLine(lines, 2, (lines[2] ?? "").replace("call-1", "call-X")).join("\n")}\n`);
    expect(openAuditLog({ store: createJsonlAuditStore(path), hash: sha256Hex })).toMatchObject({
      ok: false,
      error: { code: "audit.chain_broken", line: 3 },
    });
    expect(exportAuditFile(path, join(dir, "export.jsonl"))).toMatchObject({ ok: false, error: { line: 3 } });
  });

  it("exports a byte-equal, verifiable copy with its entry count and head hash", async () => {
    const lines = await writeLog();
    const destination = join(dir, "export.jsonl");
    const exported = exportAuditFile(path, destination);
    expect(exported).toEqual({ ok: true, value: { entries: lines.length, head: { seq: lines.length, hash: parsed(lines.at(-1) ?? "").hash } } });
    expect(await readFile(destination, "utf8")).toBe(await readFile(path, "utf8"));
    expect(exportAuditFile(path, destination)).toMatchObject({ ok: false, error: { code: "audit.write_failed" } });
  });
});
