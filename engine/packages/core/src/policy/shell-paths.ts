import { joinPath, resolvePath } from "./paths.ts";

// What a shell command touches beyond its arguments: the directories it runs in and the files it
// writes by redirection or `tee`. `path` is absolute but not normalized, or `undefined` when it
// depends on something only the shell knows (`$VAR`, `~`, `cd -`).
export interface ShellPath {
  readonly role: "working directory" | "write target";
  readonly raw: string;
  readonly path: string | undefined;
}

type Token =
  | { readonly kind: "word"; readonly value: string; readonly dynamic: boolean }
  | { readonly kind: "separator" }
  | { readonly kind: "redirect"; readonly duplicate: boolean };

const separators = new Set([";", "|", "&", "\n", "(", ")"]);
const changeDirectory = new Set(["cd", "pushd"]);
const redirectSuffixes = new Set([">", "|", "&"]);
const deviceTargets = new Set(["/dev/null", "/dev/stdout", "/dev/stderr"]);

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
    } else if (program?.value === "tee") {
      for (const arg of args.filter((word) => !word.value.startsWith("-"))) {
        found.push({ role: "write target", raw: arg.value, path: located(arg, current) });
      }
    }
  }
  return found.filter((entry) => entry.path === undefined || !deviceTargets.has(resolvePath("/", entry.path)));
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
