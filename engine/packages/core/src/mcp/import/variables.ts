import type { McpSecretReference } from "../secret-reference.ts";
import { mcpSecretPlaceholder, parseMcpSecretReference } from "../secret-reference.ts";
import type { NoteSink } from "./foreign.ts";

export type Rewrite = string | { readonly issue: string };

const envVariablePattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)(:-([^}]*))?\}/g;
const vscodeVariablePattern = /\$\{([^}]*)\}/g;

// `.mcp.json` and the Copilot CLI expand `${VAR}` and `${VAR:-default}` from the environment.
export function rewriteEnvVariables(text: string, keyPath: string, note: NoteSink): string {
  return text.replace(envVariablePattern, (_match, name: string, fallback: string | undefined) => {
    if (fallback !== undefined) {
      note(keyPath, `default for \${${name}} dropped; set ${name} in the environment or the keychain`);
    }
    return mcpSecretPlaceholder({ provider: "env", name });
  });
}

export interface VsCodeVariableContext {
  readonly root?: string;
  readonly home?: string;
}

// VS Code: `${env:X}` reads the environment, `${input:X}` prompts and stores the answer (Pica keeps
// it in the keychain under the input id), `${workspaceFolder}` and `${userHome}` are paths.
export function rewriteVsCodeVariables(text: string, context: VsCodeVariableContext): Rewrite {
  const issues: string[] = [];
  const rewritten = text.replace(vscodeVariablePattern, (match, body: string) => {
    const replacement = vscodeVariable(body, context);
    if (replacement === undefined) {
      issues.push(`unsupported VS Code variable ${match}`);
      return match;
    }
    return replacement;
  });
  return issues.length > 0 ? { issue: issues.join("; ") } : rewritten;
}

function vscodeVariable(body: string, context: VsCodeVariableContext): string | undefined {
  if (body === "workspaceFolder") {
    return context.root;
  }
  if (body === "userHome") {
    return context.home;
  }
  const reference = body.startsWith("env:")
    ? referenceTo("env", body.slice("env:".length))
    : body.startsWith("input:")
      ? referenceTo("keychain", body.slice("input:".length))
      : undefined;
  return reference === undefined ? undefined : mcpSecretPlaceholder(reference);
}

function referenceTo(provider: McpSecretReference["provider"], name: string): McpSecretReference | undefined {
  return parseMcpSecretReference(`${provider}:${name}`);
}

// Formats that expand nothing (Claude Desktop, Codex) keep the text as written.
export function keepText(text: string): string {
  return text;
}

export interface CursorVariableContext extends VsCodeVariableContext {
  readonly separator?: string;
}

// Cursor: `${env:X}`, `${userHome}`, `${workspaceFolder}`, `${workspaceFolderBasename}`,
// `${pathSeparator}` and `${/}` (docs.cursor.com/context/model-context-protocol, "Config interpolation").
export function rewriteCursorVariables(text: string, context: CursorVariableContext): Rewrite {
  return rewritePlaceholders(text, (body) => {
    if (body === "workspaceFolderBasename") {
      return context.root?.split("/").filter((part) => part !== "").at(-1);
    }
    if (body === "pathSeparator" || body === "/") {
      return context.separator ?? "/";
    }
    return body.startsWith("input:") ? undefined : vscodeVariable(body, context);
  }, "Cursor");
}

// Windsurf: `${env:X}`; `${file:/path}` reads a file, which Pica does not do
// (docs.windsurf.com/windsurf/cascade/mcp, "Config interpolation").
export function rewriteWindsurfVariables(text: string): Rewrite {
  return rewritePlaceholders(
    text,
    (body) => (body.startsWith("env:") ? placeholderFor("env", body.slice("env:".length)) : undefined),
    "Windsurf",
  );
}

// Gemini CLI expands `$VAR` and `${VAR}` in settings.json (github.com/google-gemini/gemini-cli,
// docs/get-started/configuration.md, "Environment variable references").
const shellVariablePattern = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;

export function rewriteShellVariables(text: string): string {
  return text.replace(shellVariablePattern, (match, braced: string | undefined, bare: string | undefined, offset: number) => {
    if (text.startsWith("${secret:", offset)) {
      return match;
    }
    return mcpSecretPlaceholder({ provider: "env", name: braced ?? bare ?? "" });
  });
}

// A pasted snippet may come from any platform: `${env:X}` and `${input:X}` (VS Code, Cursor,
// Windsurf), `${X}` and `${X:-default}` (Claude Code, Copilot CLI), and Pica's own `${secret:…}`.
export function rewriteAnyVariables(text: string, keyPath: string, note: NoteSink): Rewrite {
  return rewritePlaceholders(text, (body) => {
    if (body.startsWith("secret:")) {
      return `\${${body}}`;
    }
    if (body.startsWith("env:") || body.startsWith("input:")) {
      return vscodeVariable(body, {});
    }
    const env = /^([A-Za-z_][A-Za-z0-9_]*)(:-.*)?$/.exec(body);
    if (env === null) {
      return undefined;
    }
    if (env[2] !== undefined) {
      note(keyPath, `default for \${${env[1] ?? ""}} dropped; set ${env[1] ?? ""} in the environment or the keychain`);
    }
    return placeholderFor("env", env[1] ?? "");
  }, "snippet");
}

function rewritePlaceholders(text: string, replace: (body: string) => string | undefined, platform: string): Rewrite {
  const issues: string[] = [];
  const rewritten = text.replace(vscodeVariablePattern, (match, body: string) => {
    const replacement = replace(body);
    if (replacement === undefined) {
      issues.push(`unsupported ${platform} variable ${match}`);
      return match;
    }
    return replacement;
  });
  return issues.length > 0 ? { issue: issues.join("; ") } : rewritten;
}

function placeholderFor(provider: McpSecretReference["provider"], name: string): string | undefined {
  const reference = referenceTo(provider, name);
  return reference === undefined ? undefined : mcpSecretPlaceholder(reference);
}
