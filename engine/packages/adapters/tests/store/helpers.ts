import type { Repo, Session, Store, StoreResult, Workspace } from "@pica/core";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { openSqliteStore } from "../../src/store/index.ts";

export const sampleRepo: Repo = {
  id: "repo-1",
  remoteUrl: "github.com/acme/api",
  localPath: "/src/acme/api",
  managed: false,
  defaultBranch: "main",
  cloneState: "ready",
};

export const sampleWorkspace: Workspace = {
  id: "ws-1",
  name: "Payments",
  sources: [{ kind: "team", org: "acme", selector: "payments", lastSyncAt: null }],
  pinnedRepoIds: ["repo-1"],
  settingsOverrides: { routing: { default: "economy" } },
};

export function sampleSession(id: string): Session {
  return {
    id,
    workspaceId: sampleWorkspace.id,
    writeRoots: ["/src/acme/api"],
    referenceRoots: [],
    state: "idle",
    routingProfile: "balanced",
    budgetMaxCredits: 5,
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
  };
}

export function value<T>(result: StoreResult<T>): T {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

export function withTempDir(): { readonly dir: string; readonly cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "pica-store-"));
  return { dir, cleanup: () => { rmSync(dir, { recursive: true, force: true }); } };
}

// Creates a store at `path` holding the sample workspace, its repo, and the given sessions.
export function seedStore(path: string, sessionIds: readonly string[]): Store {
  const store = value(openSqliteStore(path));
  value(store.repos.save(sampleRepo));
  value(store.workspaces.save(sampleWorkspace));
  for (const id of sessionIds) {
    value(store.sessions.create(sampleSession(id)));
  }
  return store;
}

export interface NodeProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly lines: AsyncIterator<string>;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>;
}

// Runs a TypeScript file from tests/store/processes in a separate Node process.
export function startNodeProcess(script: string, args: readonly string[]): NodeProcess {
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      join(import.meta.dirname, "processes", script),
      ...args,
    ],
    { stdio: "pipe" },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>(
    (resolve) => {
      child.on("exit", (code, signal) => {
        resolve({ code, signal, stderr });
      });
    },
  );
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  return { child, lines, exited };
}

export async function nextLine(process: NodeProcess): Promise<string> {
  const next = await process.lines.next();
  if (next.done === true) {
    const { code, signal, stderr } = await process.exited;
    throw new Error(`process ended (code ${String(code)}, signal ${String(signal)}): ${stderr}`);
  }
  return next.value;
}
