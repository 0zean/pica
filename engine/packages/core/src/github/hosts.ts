// One GitHub server Pica can authenticate against (Q-02: all three deployments): github.com,
// GitHub Enterprise Cloud with data residency (`<subdomain>.ghe.com`), or a GitHub Enterprise
// Server instance on its own host.
export interface GitHubHostSettings {
  readonly host: string;
  readonly webBaseUrl?: string;
  readonly apiBaseUrl?: string;
  readonly oauthClientId?: string;
  readonly patSecretRef?: string;
}

export interface GitHubHost {
  readonly host: string;
  readonly webBaseUrl: string;
  readonly apiBaseUrl: string;
  readonly oauthClientId: string | null;
  readonly patSecretRef: string;
}

export const githubDotCom = "github.com";

export function resolveGitHubHost(settings: GitHubHostSettings): GitHubHost {
  const host = settings.host.toLowerCase();
  const webBaseUrl = trimTrailingSlash(settings.webBaseUrl ?? `https://${host}`);
  return {
    host,
    webBaseUrl,
    apiBaseUrl: trimTrailingSlash(settings.apiBaseUrl ?? defaultApiBaseUrl(host)),
    oauthClientId: settings.oauthClientId ?? null,
    patSecretRef: settings.patSecretRef ?? `github/${host}/pat`,
  };
}

export const dataResidencySuffix = ".ghe.com";

// github.com and GHE.com serve the REST API on an `api.` subdomain; GitHub Enterprise Server serves
// it under /api/v3 on the instance host.
function defaultApiBaseUrl(host: string): string {
  if (host === githubDotCom) return "https://api.github.com";
  if (host.endsWith(dataResidencySuffix)) return `https://api.${host}`;
  return `https://${host}/api/v3`;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
