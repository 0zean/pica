import { err, ok, type Result } from "../result.ts";
import { repoRegistryError, type RepoRegistryError } from "./errors.ts";

// A Repo's identity (PLAN.md §4.4). Hosted remotes become `https://<host>/<path>` in lower case, so the
// ssh, scp-style and https spellings of one repository agree. Local remotes become `file://<path>` and
// keep their case, because a local filesystem may be case-sensitive.
export interface NormalizedRemote {
  readonly url: string;
  readonly host: string | null;
  readonly segments: readonly string[];
}

const schemeUrl = /^[a-z][a-z0-9+.-]*:\/\//i;
const scpLike = /^(?:[^@/:]+@)?([^/:]+):(.+)$/;
const hostedSchemes = new Set(["https:", "http:", "ssh:", "git:", "git+ssh:", "ssh+git:"]);

export function normalizeRemoteUrl(raw: string): Result<NormalizedRemote, RepoRegistryError> {
  const text = raw.trim();
  if (schemeUrl.test(text)) {
    return fromSchemeUrl(text);
  }
  if (text.startsWith("/")) {
    return local(text, raw);
  }
  const scp = scpLike.exec(text);
  if (scp !== null) {
    return hosted(scp[1] ?? "", scp[2] ?? "", raw);
  }
  return invalid(raw, "it is not a URL, an scp-style address, or an absolute path");
}

function fromSchemeUrl(text: string): Result<NormalizedRemote, RepoRegistryError> {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return invalid(text, "it does not parse as a URL");
  }
  const path = decodePath(url.pathname);
  if (path === undefined) {
    return invalid(text, "its path has a malformed escape");
  }
  if (url.protocol === "file:") {
    return local(path, text);
  }
  if (!hostedSchemes.has(url.protocol)) {
    return invalid(text, `the scheme ${url.protocol} is not supported`);
  }
  return hosted(url.hostname, path, text);
}

function decodePath(path: string): string | undefined {
  try {
    return decodeURIComponent(path);
  } catch {
    return undefined;
  }
}

function hosted(host: string, path: string, raw: string): Result<NormalizedRemote, RepoRegistryError> {
  const segments = repoSegments(path.toLowerCase());
  if (host === "" || segments === undefined) {
    return invalid(raw, "it names no repository path");
  }
  const lowerHost = host.toLowerCase();
  return ok({ url: `https://${lowerHost}/${segments.join("/")}`, host: lowerHost, segments });
}

function local(path: string, raw: string): Result<NormalizedRemote, RepoRegistryError> {
  const segments = repoSegments(path);
  if (segments === undefined) {
    return invalid(raw, "it names no repository path");
  }
  return ok({ url: `file:///${segments.join("/")}`, host: null, segments });
}

function repoSegments(path: string): string[] | undefined {
  const segments = path.split("/").filter((segment) => segment !== "");
  const last = segments.pop()?.replace(/\.git$/, "");
  if (last === undefined || last === "") {
    return undefined;
  }
  segments.push(last);
  return segments.some((segment) => segment === "." || segment === "..") ? undefined : segments;
}

function invalid(raw: string, reason: string): Result<never, RepoRegistryError> {
  return err(repoRegistryError("repo.invalid_url", `"${raw}" is not a repository URL: ${reason}`));
}

// PLAN.md §6: managed clones live at `<managed root>/<org>/<repo>`.
export function managedClonePath(managedRoot: string, remote: NormalizedRemote): string {
  const [org, repo] = remote.segments.length >= 2 ? remote.segments.slice(-2) : [remote.host ?? "local", ...remote.segments];
  return `${managedRoot.replace(/\/+$/, "")}/${org ?? ""}/${repo ?? ""}`;
}

export function isInsideDirectory(path: string, directory: string): boolean {
  const root = directory.replace(/\/+$/, "");
  return path.startsWith(`${root}/`) && !path.slice(root.length).split("/").includes("..");
}
