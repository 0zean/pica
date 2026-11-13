// One GitHub server Pica can authenticate against: github.com or a GitHub Enterprise Server instance.
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

// GitHub Enterprise Server serves its REST API under /api/v3 on the instance host.
function defaultApiBaseUrl(host: string): string {
  return host === githubDotCom ? "https://api.github.com" : `https://${host}/api/v3`;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
