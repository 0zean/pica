import { parseArgs } from "node:util";
import type { ParseArgsConfig } from "node:util";
import { RoutingProfile, SendMode, UsageGroupBy } from "@pica/protocol";
import type * as z from "zod";
import { UsageError } from "./errors.ts";

export type UsageGrouping = z.output<typeof UsageGroupBy>;

export type Command =
  | { readonly kind: "help" }
  | {
      readonly kind: "session.new";
      readonly workspaceId: string;
      readonly writeRepoIds: readonly string[];
      readonly referenceRepoIds: readonly string[];
      readonly routingProfile: z.output<typeof RoutingProfile> | undefined;
      readonly budgetCredits: number | undefined;
      readonly prompt: string | undefined;
    }
  | { readonly kind: "session.send"; readonly sessionId: string; readonly text: string; readonly mode: z.output<typeof SendMode> }
  | { readonly kind: "session.attach"; readonly sessionId: string; readonly afterSeq: number; readonly follow: boolean }
  | { readonly kind: "session.list"; readonly workspaceId: string | undefined }
  | { readonly kind: "workspace.create"; readonly name: string }
  | { readonly kind: "workspace.list" }
  | { readonly kind: "repo.add"; readonly path: string; readonly workspaceId: string | undefined }
  | { readonly kind: "repo.list"; readonly workspaceId: string | undefined }
  | {
      readonly kind: "usage";
      readonly sessionId: string | undefined;
      readonly workspaceId: string | undefined;
      readonly groupBy: UsageGrouping;
    };

export interface Invocation {
  readonly command: Command;
  readonly json: boolean;
  readonly socketPath: string | undefined;
}

export const HELP = `Usage: pica [--json] [--socket <path>] <command>

Commands:
  session new --workspace <id> --repo <id>... [--reference <id>...]
              [--profile off|balanced|strict] [--budget <credits>] [<prompt>]
      Create a session. With a prompt, run it and print the turn.
  session send <session-id> [--mode send|steer|queue] <text>
      Send a message and print the turn it starts.
  session attach <session-id> [--after <seq>] [--follow]
      Print the session's events after <seq> (default 0), then the running turn if there is one.
      --follow keeps printing until the session ends.
  session list [--workspace <id>]
  workspace create <name>
  workspace list
  repo add <path> [--workspace <id>]
      Register a local git checkout in place; --workspace also pins it to that workspace.
  repo list [--workspace <id>]
  usage [--session <id>] [--workspace <id>] [--by session|agent|model|workspace|day]
      Calls, tokens and credits from the engine's usage ledger, with the estimated savings.

Options:
  --json           Machine-readable output: one JSON object per line.
  --socket <path>  Engine socket (default: $PICA_SOCKET, then the app's socket).

pica starts picad when none is listening and reuses the one that is.

Exit codes: 0 ok, 2 usage error, 3 engine error, 4 session failure.
`;

const globalOptions = {
  json: { type: "boolean" },
  socket: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const satisfies ParseArgsConfig["options"];

// Commands named by two words, such as `session new`.
const groups: ReadonlySet<string> = new Set(["session", "workspace", "repo"]);
const sendModes = SendMode.options;
const groupings = UsageGroupBy.options;

export function parseInvocation(argv: readonly string[]): Invocation {
  const [first, second] = commandWords(argv);
  const route = first !== undefined && groups.has(first) ? `${first} ${second ?? ""}` : (first ?? "help");
  const parsed = parse(route, argv);
  const values = parsed.values;
  const positionals = parsed.positionals.slice(route.includes(" ") ? 2 : 1);
  const socketPath = stringValue(values["socket"]);
  const json = values["json"] === true;
  if (values["help"] === true) {
    return { command: { kind: "help" }, json, socketPath };
  }
  return { command: buildCommand(route, values, positionals), json, socketPath };
}

// The command words come before any command option, so only `--socket` can carry a value ahead of them.
function commandWords(argv: readonly string[]): string[] {
  const words: string[] = [];
  for (let index = 0; index < argv.length && words.length < 2; index++) {
    const arg = argv[index] ?? "";
    if (arg === "--socket") {
      index++;
    } else if (!arg.startsWith("-")) {
      words.push(arg);
    }
  }
  return words;
}

type Values = Record<string, string | boolean | (string | boolean)[] | undefined>;

function parse(route: string, argv: readonly string[]): { values: Values; positionals: string[] } {
  const options = { ...globalOptions, ...commandOptions(route) };
  try {
    const { values, positionals } = parseArgs({ args: [...argv], options, allowPositionals: true, strict: true });
    return { values, positionals };
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

function commandOptions(route: string): ParseArgsConfig["options"] {
  switch (route) {
    case "session new":
      return {
        workspace: { type: "string" },
        repo: { type: "string", multiple: true },
        reference: { type: "string", multiple: true },
        profile: { type: "string" },
        budget: { type: "string" },
      };
    case "session send":
      return { mode: { type: "string" } };
    case "session attach":
      return { after: { type: "string" }, follow: { type: "boolean" } };
    case "session list":
    case "repo add":
    case "repo list":
      return { workspace: { type: "string" } };
    case "usage":
      return { session: { type: "string" }, workspace: { type: "string" }, by: { type: "string" } };
    default:
      return {};
  }
}

function buildCommand(route: string, values: Values, positionals: readonly string[]): Command {
  switch (route) {
    case "help":
      return { kind: "help" };
    case "session new":
      return sessionNew(values, positionals);
    case "session send": {
      const [sessionId, ...words] = positionals;
      return {
        kind: "session.send",
        sessionId: required(sessionId, "a session id"),
        text: required(words.join(" ") || undefined, "the message text"),
        mode: oneOf(stringValue(values["mode"]) ?? "send", sendModes, "--mode"),
      };
    }
    case "session attach":
      noExtra(positionals.slice(1));
      return {
        kind: "session.attach",
        sessionId: required(positionals[0], "a session id"),
        afterSeq: count(stringValue(values["after"]) ?? "0", "--after"),
        follow: values["follow"] === true,
      };
    case "session list":
      noExtra(positionals);
      return { kind: "session.list", workspaceId: stringValue(values["workspace"]) };
    case "workspace create":
      return { kind: "workspace.create", name: required(positionals.join(" ") || undefined, "the workspace name") };
    case "workspace list":
      noExtra(positionals);
      return { kind: "workspace.list" };
    case "repo add":
      noExtra(positionals.slice(1));
      return { kind: "repo.add", path: required(positionals[0], "a repository path"), workspaceId: stringValue(values["workspace"]) };
    case "repo list":
      noExtra(positionals);
      return { kind: "repo.list", workspaceId: stringValue(values["workspace"]) };
    case "usage":
      noExtra(positionals);
      return {
        kind: "usage",
        sessionId: stringValue(values["session"]),
        workspaceId: stringValue(values["workspace"]),
        groupBy: oneOf(stringValue(values["by"]) ?? "model", groupings, "--by"),
      };
    default:
      throw new UsageError(`Unknown command "${route.trim()}". Run \`pica help\`.`);
  }
}

function sessionNew(values: Values, positionals: readonly string[]): Command {
  const writeRepoIds = stringList(values["repo"]);
  if (writeRepoIds.length === 0) {
    throw new UsageError("session new needs at least one --repo.");
  }
  const budget = stringValue(values["budget"]);
  const profile = stringValue(values["profile"]);
  return {
    kind: "session.new",
    workspaceId: required(stringValue(values["workspace"]), "--workspace"),
    writeRepoIds,
    referenceRepoIds: stringList(values["reference"]),
    routingProfile: profile === undefined ? undefined : oneOf(profile, RoutingProfile.options, "--profile"),
    budgetCredits: budget === undefined ? undefined : credits(budget),
    prompt: positionals.join(" ") || undefined,
  };
}

function stringValue(value: Values[string]): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringList(value: Values[string]): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function required(value: string | undefined, what: string): string {
  if (value === undefined || value === "") {
    throw new UsageError(`Missing ${what}.`);
  }
  return value;
}

function noExtra(positionals: readonly string[]): void {
  if (positionals.length > 0) {
    throw new UsageError(`Unexpected argument "${positionals.join(" ")}".`);
  }
}

function oneOf<T extends string>(value: string, allowed: readonly T[], flag: string): T {
  const match = allowed.find((option) => option === value);
  if (match === undefined) {
    throw new UsageError(`${flag} must be one of ${allowed.join(", ")}; got "${value}".`);
  }
  return match;
}

function count(value: string, flag: string): number {
  if (!/^\d+$/.test(value)) {
    throw new UsageError(`${flag} must be a whole number; got "${value}".`);
  }
  return Number(value);
}

function credits(value: string): number {
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isFinite(parsed) || parsed < 0) {
    throw new UsageError(`--budget must be a non-negative number; got "${value}".`);
  }
  return parsed;
}
