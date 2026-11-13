import type { PicaMcpFileValue, PicaMcpServerEntry } from "@pica/protocol";
import type { ConfigIssue } from "../config/errors.ts";
import { scanMcpSecretPlaceholders } from "./secret-reference.ts";

// Detection rules are listed in docs/secret-references.md. Messages never include the value.
export const inlineSecretMessage =
  'inline secret; store it as a secret and write a reference such as "${secret:keychain:<name>}" ' +
  'or "${secret:env:<VARIABLE>}" instead (docs/secret-references.md)';

const sensitiveWords = new Set([
  "token",
  "secret",
  "password",
  "passwd",
  "pwd",
  "apikey",
  "key",
  "pat",
  "credential",
  "credentials",
  "authorization",
  "auth",
  "cookie",
]);
const nonSecretSuffixes = new Set(["path", "file", "dir", "url", "uri", "id", "name", "mode", "type", "host", "site"]);
const authSchemes = /^(bearer|basic|token|apikey|api-key)$/i;

const tokenPatterns: readonly RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bglpat-[A-Za-z0-9_-]{20,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bpk_[0-9]+_[A-Za-z0-9]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export function findMcpInlineSecrets(entry: PicaMcpServerEntry, keyPath: readonly string[]): ConfigIssue[] {
  const found: string[][] = [];
  const check = (path: string[], value: string, sensitive: boolean): void => {
    if (isInlineSecret(value, sensitive)) {
      found.push(path);
    }
  };
  if (entry.type === "stdio") {
    check([...keyPath, "command"], entry.command, false);
    if (entry.cwd !== undefined) {
      check([...keyPath, "cwd"], entry.cwd, false);
    }
    checkArgs(entry.args ?? [], [...keyPath, "args"], check);
    checkRecord(entry.env ?? {}, [...keyPath, "env"], check);
  } else {
    if (urlCarriesSecret(entry.url)) {
      found.push([...keyPath, "url"]);
    }
    checkRecord(entry.headers ?? {}, [...keyPath, "headers"], check);
  }
  return found.map((path) => ({ keyPath: path.join("."), message: inlineSecretMessage }));
}

type Check = (path: string[], value: string, sensitive: boolean) => void;

function checkRecord(record: Readonly<Record<string, PicaMcpFileValue>>, path: string[], check: Check): void {
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") {
      check([...path, key], value, isSensitiveMcpName(key));
    }
  }
}

// `--token=abc` and `--token abc` both carry a secret; the flag name decides.
function checkArgs(args: readonly string[], path: string[], check: Check): void {
  args.forEach((arg, index) => {
    const flag = /^--?([A-Za-z0-9_-]+)(=(.*))?$/.exec(arg);
    if (flag !== null && flag[3] !== undefined) {
      check([...path, String(index)], flag[3], isSensitiveMcpName(flag[1] ?? ""));
      return;
    }
    const previous = index > 0 ? /^--?([A-Za-z0-9_-]+)$/.exec(args[index - 1] ?? "") : null;
    check([...path, String(index)], arg, previous !== null && isSensitiveMcpName(previous[1] ?? ""));
  });
}

function isInlineSecret(value: string, sensitive: boolean): boolean {
  const { literal } = scanMcpSecretPlaceholders(value);
  if (tokenPatterns.some((pattern) => pattern.test(literal))) {
    return true;
  }
  const remainder = literal.trim();
  return sensitive && remainder !== "" && !authSchemes.test(remainder);
}

export function isSensitiveMcpName(name: string): boolean {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
  const last = words.at(-1);
  if (last === undefined || nonSecretSuffixes.has(last)) {
    return false;
  }
  return words.some((word) => sensitiveWords.has(word)) || /(token|secret|password)$/.test(last);
}

function urlCarriesSecret(text: string): boolean {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.password !== "" || tokenPatterns.some((pattern) => pattern.test(text))) {
    return true;
  }
  return [...url.searchParams].some(([name, value]) => value !== "" && isSensitiveMcpName(name));
}
