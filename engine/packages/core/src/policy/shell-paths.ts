import { joinPath, resolvePath } from "./paths.ts";

// What a shell command touches: the directories it runs in, the files it writes by redirection,
// `tee`, `touch`, or as the destination of `cp`, `mv` and `install`, and the paths named in its
// arguments. A command is not parsed for what it does with an
// argument, so every path argument may be written, except for the read-only commands below.
// `path` is absolute but not normalized, or `undefined` when it depends on something only the
// shell knows (`$VAR`, `~`, `cd -`).
export interface ShellPath {
  readonly role: "working directory" | "write target" | "path argument" | "read argument";
  readonly raw: string;
  readonly path: string | undefined;
  // Set on the file arguments of `cat`, `less` and `more`, which print a whole file.
  readonly printsWhole?: true;
}

type Token =
  | { readonly kind: "word"; readonly value: string; readonly dynamic: boolean }
  | { readonly kind: "separator" }
  | { readonly kind: "redirect"; readonly duplicate: boolean };

const separators = new Set([";", "|", "&", "\n", "(", ")"]);
const changeDirectory = new Set(["cd", "pushd"]);
const redirectSuffixes = new Set([">", "|", "&"]);
const deviceTargets = new Set(["/dev/null", "/dev/stdout", "/dev/stderr"]);
const printOnly = new Set(["echo", "printf"]);
const printsWholeFiles = new Set(["cat", "less", "more"]);
// Programs whose last path argument is a file they write; `touch` writes every one.
const copiesTo = new Set(["cp", "mv", "install"]);
const readOnly = new Set(["cat", "head", "tail", "less", "more", "wc", "ls", "tree", "du", "stat", "file", "diff", "grep", "egrep", "fgrep", "rg", "find"]);
const findWrites = new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"]);
// Programs whose `-C <dir>` makes them run in `<dir>`.
const directoryOption = new Set(["git", "make", "tar"]);
// An absolute path inside a larger argument, such as an inline script. The look-behind skips the
// inner slashes of words like `s/a/b/`, `a/b` and `https://host/a`.
const embeddedAbsolute = /(?<![\w.~:/$-])\/[^\s'"`,;()]+/g;

export function shellPaths(command: string, cwd: string): readonly ShellPath[] {
  const found: ShellPath[] = [{ role: "working directory", raw: cwd, path: cwd }];
  // `undefined` once a `cd` went somewhere unknown: later relative paths are unknown too.
  let current: string | undefined = cwd;
  for (const { words, writes } of commands(tokenize(command))) {
    for (const word of writes) {
      found.push({ role: "write target", raw: word.value, path: located(word, current) });
    }
    const [program, ...args] = words;
    if (program !== undefined && changeDirectory.has(program.value)) {
      const target = args.find((arg) => !arg.value.startsWith("-") || arg.value === "-");
      const path: string | undefined = target === undefined || target.value === "-" ? undefined : located(target, current);
      found.push({ role: "working directory", raw: target?.value ?? "~", path });
      current = path === undefined ? undefined : resolvePath("/", path);
    } else if (program?.value === "tee" || program?.value === "touch") {
      for (const arg of args.filter((word) => !word.value.startsWith("-"))) {
        found.push({ role: "write target", raw: arg.value, path: located(arg, current) });
      }
    } else if (program !== undefined && copiesTo.has(program.value)) {
      found.push(...copyPaths(program.value, args, current));
    } else if (program !== undefined) {
      found.push(...argumentPaths(program.value, args, current));
    }
  }
  return found.filter((entry) => entry.path === undefined || !deviceTargets.has(resolvePath("/", entry.path)));
}

function argumentPaths(program: string, args: readonly Word[], cwd: string | undefined): ShellPath[] {
  if (printOnly.has(program)) {
    return [];
  }
  if (printsWholeFiles.has(program)) {
    return args
      .filter((arg) => !arg.value.startsWith("-") && !(arg.dynamic && !arg.value.includes("/")))
      .map((arg) => ({ role: "read argument", raw: arg.value, path: located(arg, cwd), printsWhole: true }));
  }
  const role = isReadOnly(program, args) ? "read argument" : "path argument";
  const found: ShellPath[] = [];
  let base = cwd;
  let directoryNext = false;
  for (const [index, arg] of args.entries()) {
    if (directoryNext) {
      base = located(arg, base);
      found.push({ role: "working directory", raw: arg.value, path: base });
      directoryNext = false;
    } else if (arg.value === "-C" && index + 1 < args.length && directoryOption.has(program)) {
      directoryNext = true;
    } else {
      found.push(...pathsIn(arg, base, role));
    }
  }
  return found;
}

function copyPaths(program: string, args: readonly Word[], cwd: string | undefined): ShellPath[] {
  const operands = args.filter((arg) => !arg.value.startsWith("-"));
  const destination = operands.at(-1);
  const sources = argumentPaths(program, operands.slice(0, -1), cwd);
  return destination === undefined
    ? sources
    : [...sources, { role: "write target", raw: destination.value, path: located(destination, cwd) }];
}

function isReadOnly(program: string, args: readonly Word[]): boolean {
  return readOnly.has(program) && !(program === "find" && args.some((arg) => findWrites.has(arg.value)));
}

// The value of `--name=value` or `NAME=value`, or the whole word; nothing for a bare option.
function pathsIn(arg: Word, cwd: string | undefined, role: ShellPath["role"]): ShellPath[] {
  const assignment = /^(--?[\w-]+|[A-Za-z_]\w*)=/.exec(arg.value);
  if (assignment === null && arg.value.startsWith("-")) {
    return [];
  }
  const value = arg.value.slice(assignment?.[0].length ?? 0);
  const candidates = value.startsWith("/") ? [value] : [value, ...(value.match(embeddedAbsolute) ?? [])];
  return candidates
    .filter((candidate) => candidate.includes("/") || candidate === ".." || (arg.dynamic && candidate.startsWith("~")))
    .map((candidate) => ({ role, raw: candidate, path: located({ ...arg, value: candidate }, cwd) }));
}

interface SimpleCommand {
  readonly words: Word[];
  readonly writes: Word[];
}

function commands(tokens: readonly Token[]): readonly SimpleCommand[] {
  let current: SimpleCommand = { words: [], writes: [] };
  const result = [current];
  let redirect: Redirect | undefined;
  for (const token of tokens) {
    const pending = redirect;
    redirect = undefined;
    if (pending !== undefined && token.kind === "word") {
      if (!(pending.duplicate && /^(\d+|-)$/.test(token.value))) {
        current.writes.push(token);
      }
    } else if (token.kind === "separator") {
      current = { words: [], writes: [] };
      result.push(current);
    } else if (token.kind === "redirect") {
      redirect = token;
    } else {
      current.words.push(token);
    }
  }
  return result;
}

type Redirect = Extract<Token, { kind: "redirect" }>;
type Word = Extract<Token, { kind: "word" }>;

function located(word: Word, cwd: string | undefined): string | undefined {
  if (word.dynamic || (cwd === undefined && !word.value.startsWith("/"))) {
    return undefined;
  }
  return joinPath(cwd ?? "/", word.value);
}

function tokenize(command: string): readonly Token[] {
  const tokens: Token[] = [];
  let word: { value: string; dynamic: boolean; quoted: boolean } | undefined;
  const flush = (): void => {
    if (word !== undefined) {
      tokens.push({ kind: "word", value: word.value, dynamic: word.dynamic });
      word = undefined;
    }
  };
  const append = (text: string, dynamic: boolean, quoted: boolean): void => {
    word ??= { value: "", dynamic: false, quoted: false };
    word.dynamic ||= dynamic || (!quoted && word.value === "" && text.startsWith("~"));
    word.quoted ||= quoted;
    word.value += text;
  };
  for (let index = 0; index < command.length; index += 1) {
    const char = command.charAt(index);
    if (char === "'" || char === '"') {
      const end = command.indexOf(char, index + 1);
      const text = command.slice(index + 1, end === -1 ? undefined : end);
      append(text, char === '"' && /[$`]/.test(text), true);
      index = end === -1 ? command.length : end;
    } else if (char === "\\") {
      append(command.charAt(index + 1), false, true);
      index += 1;
    } else if (char === ">" || (char === "&" && command.charAt(index + 1) === ">")) {
      if (word !== undefined && !word.quoted && /^\d+$/.test(word.value)) {
        word = undefined;
      }
      flush();
      const duplicate = char === ">" && command.charAt(index + 1) === "&";
      index += redirectLength(command, index) - 1;
      tokens.push({ kind: "redirect", duplicate });
    } else if (char === "<" || char === " " || char === "\t") {
      flush();
    } else if (separators.has(char)) {
      flush();
      tokens.push({ kind: "separator" });
    } else {
      append(char, char === "$" || char === "`", false);
    }
  }
  flush();
  return tokens;
}

// `>`, `>>`, `>|`, `>&`, `&>`, `&>>`.
function redirectLength(command: string, start: number): number {
  const length = command.charAt(start) === "&" ? 2 : 1;
  return redirectSuffixes.has(command.charAt(start + length)) ? length + 1 : length;
}
