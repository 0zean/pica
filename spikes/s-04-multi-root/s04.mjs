// S-04 spike: multi-root access against the real Copilot runtime (PLAN.md §10, Phase 0).
// Usage: node --experimental-strip-types spikes/s-04-multi-root/s04.mjs read|write|concurrent|guard
//   read        a session rooted in fixture repo A reads a file in fixture repo B, once with no
//               extra grant (host approves the permission request) and once with B passed as an
//               `additionalDirectories` entry. Records which mechanism let the read through.
//   write       a session rooted in A, with B as a reference root, is asked to write into B with
//               the file tool and with a shell redirect. An `onPreToolUse` hook built on R-07's
//               shell-path parser denies both; asserts B is untouched.
//   concurrent  two sessions on one client, rooted in A and B, each read `marker.txt` at the same
//               time; asserts each reply, hook call and event carries only its own session's data.
//   guard       offline: what R-07's `shellPaths` sees in shell writes that do not use a redirect.
// Live modes need a Copilot login and send one or two minimal prompts each on the default model.
// Never run in CI. Saved output (docs/spikes/S-04-<mode>.json) has the login and paths redacted.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
// R-07's guard, imported from source so the spike tests the code Pica ships.
const { shellPaths } = await import(join(root, "engine/packages/core/src/policy/shell-paths.ts"));

const mode = process.argv[2];
if (!["read", "write", "concurrent", "guard"].includes(mode)) {
  console.error("usage: s04.mjs read|write|concurrent|guard");
  process.exit(2);
}

let failures = 0;
function check(condition, message) {
  console.log(`${condition ? "ok" : "FAIL"}: ${message}`);
  if (!condition) failures += 1;
}

const inside = (path, dir) => path === dir || path.startsWith(dir + sep);

// Declared before the live run starts: a hook that throws is swallowed by the SDK (fail-open).
const readOnlyTools = new Set(["view", "read", "glob", "grep", "ls", "list_directory", "read_file"]);
const shellTools = new Set(["bash", "shell", "powershell"]);
const writeTools = new Set(["create", "edit", "apply_patch", "str_replace_editor", "write", "write_file"]);
// Paths a tool call writes: `path`-style arguments, or the file headers of an `apply_patch` body
// (its argument is the raw patch text, not an object).
function writePaths(args) {
  if (typeof args === "string") {
    return [...args.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)].map((match) => (match[1] ?? match[2]).trim());
  }
  if (args === null || typeof args !== "object") return [];
  const path = args.path ?? args.file_path ?? args.filePath ?? args.filename;
  return typeof path === "string" ? [path] : [];
}

if (mode === "guard") {
  guard();
  process.exit(failures === 0 ? 0 : 1);
}

const sdkEntry = join(root, "engine/packages/adapters/node_modules/@github/copilot-sdk/dist/index.js");
const { CopilotClient } = await import(sdkEntry);

// Fixture repos live under one throwaway directory in the home directory, not the OS temporary
// directory: the runtime grants temporary storage to every session, which would hide its gate.
// Resolved through symlinks so runtime paths and fixture paths compare equal.
const base = realpathSync(mkdtempSync(join(homedir(), ".pica-s04-")));
const repoA = join(base, "repo-a");
const repoB = join(base, "repo-b");
const tokenA = `alpha-${Math.random().toString(36).slice(2, 8)}`;
const tokenB = `bravo-${Math.random().toString(36).slice(2, 8)}`;
fixture(repoA, { "marker.txt": `${tokenA}\n`, "README.md": "Fixture repo A.\n" });
fixture(repoB, { "marker.txt": `${tokenB}\n`, "notes.txt": `${tokenB}\n` });

let login;
const maxString = 400;
function redact(value) {
  let text = JSON.stringify(value, (_key, field) =>
    typeof field === "string" && field.length > maxString ? `${field.slice(0, maxString)}…(${field.length} chars)` : field,
  );
  text = text.split(repoA).join("<repoA>").split(repoB).join("<repoB>").split(base).join("<base>");
  text = text.split(tmpdir()).join("<tmp>").split(homedir()).join("~");
  if (login) text = text.split(login).join("<login>");
  // Tokens: anything shaped like a GitHub token.
  text = text.replace(/\b(gh[opsu]_|github_pat_)[A-Za-z0-9_]{20,}/g, "<token>");
  return JSON.parse(text);
}

const client = new CopilotClient({});
try {
  await client.start();
  const auth = await client.getAuthStatus();
  login = auth.login;
  if (!auth.isAuthenticated) {
    console.error(`FAIL: not signed in: ${auth.statusMessage ?? "(no status message)"}`);
    process.exit(1);
  }
  const result = mode === "read" ? await readCheck() : mode === "write" ? await writeCheck() : await concurrentCheck();
  writeFileSync(join(root, `docs/spikes/S-04-${mode}.json`), JSON.stringify(redact({ sdk: "@github/copilot-sdk@1.0.28", ...result }), null, 2) + "\n");
} finally {
  await client.stop().catch(() => undefined);
  rmSync(base, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);

function fixture(dir, files) {
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture");
}

function gitStatus(dir) {
  return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: dir, encoding: "utf8" });
}

// One session with a recording permission handler and pre-tool hook. `decidePermission` and
// `decideTool` return the decision; both default to deny.
async function open(label, { workingDirectory, additionalDirectories, decidePermission, decideTool }) {
  const log = { label, workingDirectory, additionalDirectories, permissions: [], hooks: [], events: [] };
  const session = await client.createSession({
    workingDirectory,
    ...(additionalDirectories ? { additionalDirectories } : {}),
    onPermissionRequest: (request, invocation) => {
      const result = decidePermission?.(request) ?? { kind: "reject", feedback: "Denied by the S-04 spike." };
      log.permissions.push({ sessionId: invocation.sessionId, request, result });
      return result;
    },
    hooks: {
      onPreToolUse: (input, invocation) => {
        // No decision unless the spike denies: an "allow" here would pre-approve the call and
        // skip the runtime's own permission request.
        let output;
        try {
          output = decideTool?.(input);
        } catch (error) {
          // Fail closed: the SDK would treat a thrown hook as "no decision".
          log.hookErrors = [...(log.hookErrors ?? []), String(error?.stack ?? error)];
          output = { permissionDecision: "deny", permissionDecisionReason: "Blocked by Pica: the policy hook failed." };
        }
        log.hooks.push({ sessionId: invocation.sessionId, input, output });
        return output;
      },
    },
    // `model.*` events are the runtime's internal model-call trace (most of the log's size).
    onEvent: (event) => {
      if (!event.type.startsWith("model.")) log.events.push(event);
    },
  });
  log.sessionId = session.sessionId;
  return { session, log };
}

async function ask(session, log, prompt) {
  const start = log.events.length;
  const idle = new Promise((done) => {
    const off = session.on("session.idle", () => {
      off?.();
      done(true);
    });
  });
  await session.send({ prompt });
  const reached = await Promise.race([idle, new Promise((done) => setTimeout(() => done(false), 180_000))]);
  const turn = log.events.slice(start);
  const reply = turn.filter((event) => event.type === "assistant.message").map((event) => event.data.content ?? "").join("\n");
  const errors = turn.filter((event) => event.type === "session.error").map((event) => event.data);
  const tools = turn.filter((event) => event.type === "tool.execution_start").map((event) => ({ tool: event.data.toolName, args: event.data.arguments }));
  console.log(JSON.stringify({ session: log.label, reached, reply, errors, tools }));
  if (errors.length > 0) console.error(`session.error: ${JSON.stringify(errors)}`);
  return { reached, reply, errors };
}


// --- read -------------------------------------------------------------------------------------

async function readCheck() {
  const target = join(repoB, "notes.txt");
  const prompt = `Read the file ${target} and reply with its exact contents only.`;
  const runs = [];
  for (const variant of ["permission", "additionalDirectories"]) {
    const { session, log } = await open(`read:${variant}`, {
      workingDirectory: repoA,
      ...(variant === "additionalDirectories" ? { additionalDirectories: [repoB] } : {}),
      // The host's approval: reads inside A or B are approved once, everything else refused.
      decidePermission: (request) =>
        request.kind === "read" && (inside(request.path, repoA) || inside(request.path, repoB)) ? { kind: "approve-once" } : undefined,
    });
    const turn = await ask(session, log, prompt);
    await session.disconnect().catch(() => undefined);
    const outside = log.permissions.filter((entry) => entry.request.kind === "read" && inside(entry.request.path, repoB));
    runs.push({ variant, ...turn, readPermissionsForB: outside.length, log });
    if (turn.errors.length > 0) break;
  }
  const [plain, added] = runs;
  check(plain.reached && plain.reply.includes(tokenB), "session rooted in A read B's file after host approval");
  console.log(`info: without a grant, ${plain.readPermissionsForB} read permission request(s) named a path in B`);
  check(plain.readPermissionsForB > 0, "the runtime asked the host before reading outside workingDirectory (mechanism: permission request)");
  if (added) {
    check(added.reached && added.reply.includes(tokenB), "with B in additionalDirectories the read also succeeds");
    console.log(`info: with additionalDirectories, ${added.readPermissionsForB} read permission request(s) named a path in B`);
  }
  return { mode: "read", runs };
}

// --- write ------------------------------------------------------------------------------------

// The R-07 rule applied in a hook: writes and shell commands must stay inside the write roots.
function fence(writeRoots) {
  return (input) => {
    const args = input.toolArgs;
    if (shellTools.has(input.toolName)) {
      const command = typeof args?.command === "string" ? args.command : "";
      const outside = shellPaths(command, input.workingDirectory).filter(
        (entry) => entry.path === undefined || !writeRoots.some((dir) => inside(resolve(entry.path), dir)),
      );
      if (outside.length > 0) {
        return {
          permissionDecision: "deny",
          permissionDecisionReason: `Blocked by Pica: ${outside.map((entry) => `${entry.role} ${entry.raw}`).join(", ")} is outside the write roots.`,
        };
      }
      return undefined;
    }
    if (readOnlyTools.has(input.toolName)) return undefined;
    const outside = writePaths(args).filter((path) => !writeRoots.some((dir) => inside(resolve(input.workingDirectory, path), dir)));
    if (outside.length > 0) {
      return { permissionDecision: "deny", permissionDecisionReason: `Blocked by Pica: ${outside.join(", ")} is outside the write roots.` };
    }
    // A tool the spike cannot read paths from is denied rather than guessed at.
    if (writeTools.has(input.toolName) && writePaths(args).length === 0) {
      return { permissionDecision: "deny", permissionDecisionReason: `Blocked by Pica: cannot tell what ${input.toolName} writes.` };
    }
    return undefined;
  };
}

async function writeCheck() {
  const { session, log } = await open("write", {
    workingDirectory: repoA,
    additionalDirectories: [repoB],
    decideTool: fence([repoA]),
    // Behind the hook, the host approves only writes and commands it would allow anyway, so a
    // write that reaches B can only come from a hook miss.
    decidePermission: (request) => {
      if (request.kind === "read") return { kind: "approve-once" };
      if (request.kind === "write" && inside(resolve(repoA, request.fileName ?? ""), repoA)) return { kind: "approve-once" };
      if (request.kind === "shell") return { kind: "approve-once" };
      return undefined;
    },
  });
  const stop = "If the call is blocked, do not try another way; just say it was blocked.";
  const editTurn = await ask(session, log, `Create the file ${join(repoB, "edit.txt")} containing the word pica, using your file creation tool. ${stop}`);
  const shellTurn =
    editTurn.errors.length > 0
      ? undefined
      : await ask(session, log, `Run exactly this shell command: echo pica > ${join(repoB, "shell.txt")}  ${stop}`);
  await session.disconnect().catch(() => undefined);

  const denied = log.hooks.filter((entry) => entry.output?.permissionDecision === "deny");
  const shellDenied = denied.filter((entry) => shellTools.has(entry.input.toolName));
  const fileDenied = denied.filter((entry) => !shellTools.has(entry.input.toolName));
  const statusB = gitStatus(repoB);
  console.log(`info: hook calls ${log.hooks.map((entry) => `${entry.input.toolName}:${entry.output?.permissionDecision ?? "none"}`).join(", ")}`);
  check(fileDenied.length > 0, `the hook denied the file-tool write into B (${fileDenied.map((entry) => entry.input.toolName).join(", ")})`);
  check(shellDenied.length > 0, "the hook denied the shell write into B");
  check((log.hookErrors ?? []).length === 0, `the hook ran without errors${log.hookErrors ? `: ${log.hookErrors[0]}` : ""}`);
  check(statusB === "" && !existsSync(join(repoB, "edit.txt")) && !existsSync(join(repoB, "shell.txt")), "repo B is unchanged");
  return { mode: "write", turns: { edit: editTurn, shell: shellTurn }, statusB, log };
}

// --- concurrent -------------------------------------------------------------------------------

async function concurrentCheck() {
  const approveOwn = (dir) => (request) => (request.kind === "read" && inside(request.path, dir) ? { kind: "approve-once" } : undefined);
  const a = await open("A", { workingDirectory: repoA, decidePermission: approveOwn(repoA) });
  const b = await open("B", { workingDirectory: repoB, decidePermission: approveOwn(repoB) });
  const prompt = "Read marker.txt in the current working directory and reply with its exact contents only.";
  const started = Date.now();
  const [turnA, turnB] = await Promise.all([ask(a.session, a.log, prompt), ask(b.session, b.log, prompt)]);
  const elapsed = Date.now() - started;
  await Promise.all([a.session.disconnect().catch(() => undefined), b.session.disconnect().catch(() => undefined)]);

  // Overlap: each session's first event of the turn precedes the other's idle.
  const span = (log) => {
    const times = log.events.filter((event) => event.type !== "session.start").map((event) => Date.parse(event.timestamp));
    return [Math.min(...times), Math.max(...times)];
  };
  const [aStart, aEnd] = span(a.log);
  const [bStart, bEnd] = span(b.log);
  const own = (entry, log) =>
    entry.sessionId === log.sessionId &&
    log.hooks.every((hook) => hook.sessionId === log.sessionId && hook.input.workingDirectory === log.workingDirectory) &&
    log.permissions.every((permission) => permission.sessionId === log.sessionId);
  check(a.session.sessionId !== b.session.sessionId, "two distinct sessions on one client");
  check(aStart < bEnd && bStart < aEnd, `the turns overlapped in time (${elapsed} ms for both)`);
  check(turnA.reply.includes(tokenA) && !turnA.reply.includes(tokenB), "session A replied with A's marker only");
  check(turnB.reply.includes(tokenB) && !turnB.reply.includes(tokenA), "session B replied with B's marker only");
  check(own({ sessionId: a.log.sessionId }, a.log) && own({ sessionId: b.log.sessionId }, b.log), "hook and permission calls carry their own session's id and working directory");
  const leaked = [a.log, b.log].flatMap((log) => log.events.filter((event) => JSON.stringify(event.data ?? {}).includes(log === a.log ? repoB : repoA)));
  check(leaked.length === 0, "no event of one session names the other session's repo");
  return { mode: "concurrent", elapsedMs: elapsed, turns: { A: turnA, B: turnB }, logs: { A: a.log, B: b.log } };
}

// --- guard (offline) --------------------------------------------------------------------------

function guard() {
  const cwd = "/work/repo-a";
  const cases = [
    { command: "echo x > /work/repo-b/f", caught: true },
    { command: "echo x | tee /work/repo-b/f", caught: true },
    { command: "cd /work/repo-b && touch f", caught: true },
    { command: "touch /work/repo-b/f", caught: false },
    { command: "cp README.md /work/repo-b/f", caught: false },
    { command: "python3 -c \"open('/work/repo-b/f','w')\"", caught: false },
    { command: "git -C /work/repo-b commit -am x", caught: false },
  ];
  for (const { command, caught } of cases) {
    const flagged = shellPaths(command, cwd).some((entry) => entry.path === undefined || !inside(resolve(entry.path), cwd));
    check(flagged === caught, `shellPaths ${flagged ? "flags" : "misses"} \`${command}\``);
  }
}
