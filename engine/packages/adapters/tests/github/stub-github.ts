import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  resolveGitHubHost,
  type GitHubCredentialRequest,
  type GitHubHost,
  type GitHubHostSettings,
} from "@pica/core";
import type { GitHubCommandRunner, SecretsGetCall } from "../../src/index.ts";

export interface StubReply {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: string;
}

export type StubRoute = (request: RecordedRequest) => StubReply;

export interface StubGitHub {
  readonly url: string;
  readonly requests: RecordedRequest[];
  close(): Promise<void>;
}

// A local stand-in for a GitHub server. Routes are keyed by "METHOD /path".
export async function startStubGitHub(routes: Record<string, StubRoute>): Promise<StubGitHub> {
  const requests: RecordedRequest[] = [];
  const server = createServer((incoming, outgoing) => {
    void readBody(incoming).then((body) => {
      const request: RecordedRequest = {
        method: incoming.method ?? "GET",
        path: incoming.url ?? "/",
        authorization: incoming.headers.authorization,
        body,
      };
      requests.push(request);
      const route = routes[`${request.method} ${request.path}`];
      const reply = route === undefined ? { status: 404, body: { message: "Not Found" } } : route(request);
      outgoing.writeHead(reply.status ?? 200, { "content-type": "application/json", ...reply.headers });
      outgoing.end(JSON.stringify(reply.body ?? {}));
    });
  });
  await listen(server);
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

// A host whose API and web endpoints both point at the stub, as a GitHub Enterprise host would be configured.
export function stubHost(stub: StubGitHub, settings: Partial<GitHubHostSettings> = {}): GitHubHost {
  return resolveGitHubHost({ host: "ghe.example.test", apiBaseUrl: `${stub.url}/api/v3`, webBaseUrl: stub.url, ...settings });
}

export function credentialRequest(host: GitHubHost, overrides: Partial<GitHubCredentialRequest> = {}): GitHubCredentialRequest {
  return { host, scopes: [], interactive: false, ...overrides };
}

// `GET /api/v3/user` answering for the given tokens; any other token is rejected with 401.
export function userRoute(tokens: Record<string, { login: string; scopes?: string }>): StubRoute {
  return (request) => {
    const token = request.authorization?.replace(/^Bearer /, "") ?? "";
    const user = tokens[token];
    if (user === undefined) {
      return { status: 401, body: { message: "Bad credentials" } };
    }
    return {
      headers: user.scopes === undefined ? {} : { "x-oauth-scopes": user.scopes },
      body: { login: user.login },
    };
  };
}

export interface FakeGh {
  readonly run: GitHubCommandRunner;
  readonly calls: string[][];
}

// `gh auth token` answering with the token, or, for "logged_out" and "not_installed", exit 1 and null.
export function fakeGh(token: string): FakeGh {
  const calls: string[][] = [];
  const run: GitHubCommandRunner = (command, args) => {
    calls.push([command, ...args]);
    if (token === "not_installed") {
      return Promise.resolve(null);
    }
    if (token === "logged_out") {
      return Promise.resolve({ exitCode: 1, stdout: "" });
    }
    return Promise.resolve({ exitCode: 0, stdout: `${token}\n` });
  };
  return { run, calls };
}

export interface FakeSecrets {
  readonly call: SecretsGetCall;
  readonly refs: string[];
}

// The client side of `secrets.get`, holding the given secrets and answering `secret_unresolved` otherwise.
export function fakeSecrets(values: Record<string, string>): FakeSecrets {
  const refs: string[] = [];
  const call: SecretsGetCall = ({ secretRef }) => {
    refs.push(secretRef);
    const value = values[secretRef];
    return Promise.resolve(
      value === undefined
        ? { ok: false, code: "secret_unresolved", message: `no secret named ${secretRef}` }
        : { ok: true, result: { value } },
    );
  };
  return { call, refs };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}
