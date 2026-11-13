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
