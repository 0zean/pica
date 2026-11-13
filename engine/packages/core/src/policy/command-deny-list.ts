import type { CommandRule } from "./types.ts";

export const defaultCommandDenyList: readonly CommandRule[] = [
  { id: "sudo", pattern: /(^|[;&|]\s*)sudo\b/, reason: "Commands may not run with sudo" },
  { id: "rm-root", pattern: /\brm\s+(-[a-zA-Z]*\s+)*(\/|~)(\s|$)/, reason: "Removing the root or home directory is blocked" },
  { id: "git-push-force", pattern: /\bgit\s+push\b.*(\s--force\b|\s-f\b)/, reason: "Force pushes are blocked" },
  { id: "pipe-to-shell", pattern: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/, reason: "Piping a download into a shell is blocked" },
];
