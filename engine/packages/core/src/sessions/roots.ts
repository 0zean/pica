import type { Repo, Session } from "../store/index.ts";

export interface SessionRootInfo {
  readonly path: string;
  readonly access: "write" | "reference";
  readonly repoId: string | null;
}

// A-10: the directories a session works in, write roots first, so the first is where its agent runs.
// Until R-10's worktrees are reported, a repo's root is its checkout, matched here by path.
export function sessionRoots(
  session: Pick<Session, "writeRoots" | "referenceRoots">,
  repos: readonly Pick<Repo, "id" | "localPath">[],
): SessionRootInfo[] {
  const repoAt = (path: string): string | null => repos.find((repo) => repo.localPath === path)?.id ?? null;
  return [
    ...session.writeRoots.map((path) => ({ path, access: "write" as const, repoId: repoAt(path) })),
    ...session.referenceRoots.map((path) => ({ path, access: "reference" as const, repoId: repoAt(path) })),
  ];
}
