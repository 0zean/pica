import type { McpPresetIssue, PicaMcpServerEntry } from "@pica/protocol";
import { githubDotCom, resolveGitHubHost } from "../github/hosts.ts";
import type { GitHubHost } from "../github/hosts.ts";
import { mcpSecretPlaceholder, parseMcpSecretReference } from "../mcp/secret-reference.ts";
import { parameter } from "./parameters.ts";
import type { McpPresetParameterSpec, McpPresetValues } from "./parameters.ts";

// Endpoints and auth are the ones recorded in PLAN.md §2.2; nothing else is assumed.

export interface McpPresetContext {
  // D-20: the configured GitHub host. Absent means github.com.
  readonly githubHost?: GitHubHost;
}

export interface McpPresetSpec {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  parameters(context: McpPresetContext): readonly McpPresetParameterSpec[];
  // Receives validated values with defaults applied.
  entry(values: McpPresetValues, context: McpPresetContext): PicaMcpServerEntry | readonly McpPresetIssue[];
}

export const githubCopilotMcpUrl = "https://api.githubcopilot.com/mcp/";

function githubHost(context: McpPresetContext): GitHubHost {
  return context.githubHost ?? resolveGitHubHost({ host: githubDotCom });
}

function bearer(reference: string): string {
  const parsed = parseMcpSecretReference(reference);
  // Validation has already parsed it; the fallback keeps the types honest.
  return parsed === undefined ? "" : `Bearer ${mcpSecretPlaceholder(parsed)}`;
}

const github: McpPresetSpec = {
  id: "github",
  name: "GitHub",
  description: "GitHub's remote MCP server, signed in with Copilot or a personal access token.",
  parameters: (context) => {
    const host = githubHost(context);
    const onDotCom = host.host === githubDotCom;
    return [
      parameter({
        name: "auth",
        label: "Sign-in",
        description: "copilot: the Copilot sign-in, which the runtime attaches itself. pat: a personal access token.",
        kind: "choice",
        required: true,
        default: "copilot",
        choices: ["copilot", "pat"],
      }),
      parameter({
        name: "patSecretRef",
        label: "Personal access token",
        description: "Secret reference to the token, sent as Authorization: Bearer.",
        kind: "secretRef",
        required: true,
        default: `keychain:${host.patSecretRef}`,
        onlyWhen: { parameter: "auth", values: ["pat"] },
      }),
      parameter({
        name: "url",
        label: "Server URL",
        description: onDotCom
          ? `Defaults to ${githubCopilotMcpUrl}.`
          : `The MCP endpoint for ${host.host}. Pica does not know it, so it must be given.`,
        kind: "url",
        required: !onDotCom,
        default: onDotCom ? githubCopilotMcpUrl : null,
        missing: `is required: Pica does not know the GitHub MCP endpoint for ${host.host}; give the server URL`,
      }),
    ];
  },
  entry: (values) => ({
    name: "GitHub",
    type: "http",
    url: values["url"] ?? githubCopilotMcpUrl,
    ...(values["auth"] === "pat" ? { headers: { Authorization: bearer(values["patSecretRef"] ?? "") } } : {}),
  }),
};

const datadog: McpPresetSpec = {
  id: "datadog",
  name: "Datadog",
  description: "Datadog's remote MCP server for one Datadog site, with OAuth or API and application keys.",
  parameters: () => [
    parameter({
      name: "site",
      label: "Datadog site",
      description: "The site host your organization uses; the server is https://mcp.<site>/api/unstable/mcp-server/mcp.",
      kind: "hostname",
      required: true,
      default: "datadoghq.com",
      examples: ["datadoghq.com", "us3.datadoghq.com", "datadoghq.eu"],
    }),
    parameter({
      name: "auth",
      label: "Sign-in",
      description: "oauth: sign in in the browser. apiKey: DD-API-KEY and DD-APPLICATION-KEY headers.",
      kind: "choice",
      required: true,
      default: "oauth",
      choices: ["oauth", "apiKey"],
    }),
    parameter({
      name: "apiKeySecretRef",
      label: "API key",
      description: "Secret reference to the API key, sent as DD-API-KEY.",
      kind: "secretRef",
      required: true,
      onlyWhen: { parameter: "auth", values: ["apiKey"] },
    }),
    parameter({
      name: "applicationKeySecretRef",
      label: "Application key",
      description: "Secret reference to the application key, sent as DD-APPLICATION-KEY.",
      kind: "secretRef",
      required: true,
      onlyWhen: { parameter: "auth", values: ["apiKey"] },
    }),
  ],
  entry: (values) => {
    const site = values["site"] ?? "";
    if (site.startsWith("mcp.")) {
      return [{ parameter: "site", message: "must be the site host without the mcp. prefix, for example datadoghq.com" }];
    }
    return {
      name: "Datadog",
      type: "http",
      url: `https://mcp.${site}/api/unstable/mcp-server/mcp`,
      ...(values["auth"] === "apiKey"
        ? {
            headers: {
              "DD-API-KEY": { secretRef: values["apiKeySecretRef"] ?? "" },
              "DD-APPLICATION-KEY": { secretRef: values["applicationKeySecretRef"] ?? "" },
            },
          }
        : {}),
    };
  },
};

const clickup: McpPresetSpec = {
  id: "clickup",
  name: "ClickUp",
  description: "ClickUp's remote MCP server, with browser OAuth.",
  parameters: () => [],
  entry: () => ({ name: "ClickUp", type: "http", url: "https://mcp.clickup.com/mcp" }),
};

const snowflake: McpPresetSpec = {
  id: "snowflake",
  name: "Snowflake",
  description: "A Snowflake-managed MCP server an admin created with CREATE MCP SERVER, with a programmatic access token.",
  parameters: () => [
    parameter({
      name: "accountUrl",
      label: "Account URL",
      description: "The account's URL, for example https://<org>-<account>.snowflakecomputing.com.",
      kind: "url",
      required: true,
      examples: ["https://myorg-myaccount.snowflakecomputing.com"],
    }),
    parameter({ name: "database", label: "Database", description: "The database that holds the MCP server.", kind: "identifier", required: true }),
    parameter({ name: "schema", label: "Schema", description: "The schema that holds the MCP server.", kind: "identifier", required: true }),
    parameter({ name: "server", label: "MCP server name", description: "The name given to CREATE MCP SERVER.", kind: "identifier", required: true }),
    parameter({
      name: "patSecretRef",
      label: "Programmatic access token",
      description: "Secret reference to the token, sent as Authorization: Bearer.",
      kind: "secretRef",
      required: true,
    }),
  ],
  entry: (values) => {
    const account = new URL(values["accountUrl"] ?? "");
    if (account.pathname !== "/" || account.search !== "" || account.hash !== "") {
      return [{ parameter: "accountUrl", message: "must be the account URL only, without a path, query or fragment" }];
    }
    const path = ["api/v2/databases", values["database"], "schemas", values["schema"], "mcp-servers", values["server"]]
      .map((part) => part ?? "")
      .join("/");
    return {
      name: "Snowflake",
      type: "http",
      url: `${account.origin}/${path}`,
      headers: { Authorization: bearer(values["patSecretRef"] ?? "") },
    };
  },
};

// Sorted by id. Listing a preset enables nothing (D-18).
export const mcpPresetSpecs: readonly McpPresetSpec[] = [clickup, datadog, github, snowflake];
