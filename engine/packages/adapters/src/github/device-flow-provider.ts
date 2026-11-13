import {
  err,
  gitHubAuthRequired,
  gitHubRequestFailed,
  ok,
  type GitHubAuthResult,
  type GitHubCredentialProvider,
  type GitHubHost,
} from "@pica/core";
import { errorMessage, readJson, type GitHubFetch } from "./http.ts";

export interface DeviceCodePrompt {
  readonly host: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresInSeconds: number;
}

export interface DeviceFlowProviderOptions {
  // Shows the user the code to enter at the verification page.
  readonly present: (prompt: DeviceCodePrompt) => void;
  readonly sleep: (ms: number) => Promise<void>;
  readonly fetch?: GitHubFetch;
}

interface DeviceCode {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresIn: number;
  readonly interval: number;
}

const grantType = "urn:ietf:params:oauth:grant-type:device_code";
// RFC 8628 §3.5: on slow_down the client adds 5 seconds to its polling interval.
const slowDownSeconds = 5;

export function createDeviceFlowCredentialProvider(options: DeviceFlowProviderOptions): GitHubCredentialProvider {
  return {
    kind: "device_flow",
    async token(request) {
      const clientId = request.host.oauthClientId;
      if (!request.interactive || clientId === null) {
        return ok(null);
      }
      const code = await requestDeviceCode(options, request.host, clientId, request.scopes);
      if (!code.ok) {
        return code;
      }
      options.present({
        host: request.host.host,
        userCode: code.value.userCode,
        verificationUri: code.value.verificationUri,
        expiresInSeconds: code.value.expiresIn,
      });
      return pollForToken(options, request.host, clientId, code.value);
    },
  };
}

async function requestDeviceCode(
  options: DeviceFlowProviderOptions,
  host: GitHubHost,
  clientId: string,
  scopes: readonly string[],
): GitHubAuthResult<DeviceCode> {
  const body = await postForm(options, host, "/login/device/code", { client_id: clientId, scope: scopes.join(" ") });
  if (!body.ok) {
    return body;
  }
  const fields = body.value;
  const { device_code, user_code, verification_uri, expires_in, interval } = fields;
  if (typeof device_code !== "string" || typeof user_code !== "string" || typeof verification_uri !== "string") {
    return err(gitHubRequestFailed(host, `${host.host} did not return a device code`));
  }
  return ok({
    deviceCode: device_code,
    userCode: user_code,
    verificationUri: verification_uri,
    expiresIn: typeof expires_in === "number" ? expires_in : 900,
    interval: typeof interval === "number" ? interval : 5,
  });
}

async function pollForToken(
  options: DeviceFlowProviderOptions,
  host: GitHubHost,
  clientId: string,
  code: DeviceCode,
): GitHubAuthResult<string> {
  let interval = code.interval;
  // Elapsed time is the sum of the waits, so the deadline does not depend on the wall clock.
  for (let waited = 0; waited < code.expiresIn; waited += interval) {
    await options.sleep(interval * 1000);
    const body = await postForm(options, host, "/login/oauth/access_token", {
      client_id: clientId,
      device_code: code.deviceCode,
      grant_type: grantType,
    });
    if (!body.ok) {
      return body;
    }
    if (typeof body.value.access_token === "string") {
      return ok(body.value.access_token);
    }
    const reply = body.value.error;
    if (reply === "slow_down") {
      interval = typeof body.value.interval === "number" ? body.value.interval : interval + slowDownSeconds;
    } else if (reply !== "authorization_pending") {
      return err(pollFailure(host, reply));
    }
  }
  return err(gitHubAuthRequired(host, `The sign-in code for ${host.host} expired before it was entered.`));
}

function pollFailure(host: GitHubHost, reply: unknown) {
  if (reply === "expired_token") {
    return gitHubAuthRequired(host, `The sign-in code for ${host.host} expired before it was entered.`);
  }
  if (reply === "access_denied") {
    return gitHubAuthRequired(host, `Sign-in to ${host.host} was cancelled.`);
  }
  return gitHubRequestFailed(host, `${host.host} device flow failed: ${String(reply)}`);
}

async function postForm(
  options: DeviceFlowProviderOptions,
  host: GitHubHost,
  path: string,
  form: Record<string, string>,
): GitHubAuthResult<Record<string, unknown>> {
  const doFetch = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${host.webBaseUrl}${path}`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": "pica" },
      body: new URLSearchParams(form).toString(),
    });
  } catch (error) {
    return err(gitHubRequestFailed(host, `could not reach ${host.webBaseUrl}: ${errorMessage(error)}`));
  }
  const body = await readJson(response);
  if (!response.ok || typeof body !== "object" || body === null) {
    return err(gitHubRequestFailed(host, `${host.host} answered ${path} with HTTP ${String(response.status)}`, response.status));
  }
  return ok(body as Record<string, unknown>);
}
