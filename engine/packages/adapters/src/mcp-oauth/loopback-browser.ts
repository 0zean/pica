import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { err, ok, type McpOAuthBrowser, type McpOAuthRedirect, type McpOAuthResult } from "@pica/core";
import { errorMessage } from "./json.ts";

export interface LoopbackBrowserOptions {
  // Opens the authorization page for the user, for example with macOS `open`.
  readonly open: (url: string) => void;
  // How long to wait for the redirect before giving up.
  readonly timeoutMs?: number;
}

const callbackPath = "/callback";
const defaultTimeoutMs = 5 * 60_000;
const donePage = "<!doctype html><title>Pica</title><p>Signed in. You can close this window.</p>";

// RFC 8252 §7.3: a loopback redirect on an ephemeral port.
export function createLoopbackBrowser(options: LoopbackBrowserOptions): McpOAuthBrowser {
  return {
    open: options.open,
    listen: () => listen(options.timeoutMs ?? defaultTimeoutMs),
  };
}

function listen(timeoutMs: number): McpOAuthResult<McpOAuthRedirect> {
  return new Promise((resolve) => {
    let settle: ((result: Awaited<ReturnType<McpOAuthRedirect["wait"]>>) => void) | undefined;
    const answer = new Promise<Awaited<ReturnType<McpOAuthRedirect["wait"]>>>((done) => {
      settle = done;
    });
    const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== callbackPath) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(donePage);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state") ?? "";
      settle?.(
        code === null
          ? err({ kind: "rejected", message: `authorization was not granted (${url.searchParams.get("error") ?? "no code"})` })
          : ok({ code, state }),
      );
    });
    const timer = setTimeout(() => {
      settle?.(err({ kind: "cancelled", message: "no authorization arrived in time" }));
    }, timeoutMs);
    timer.unref();
    const close = (): void => {
      clearTimeout(timer);
      settle?.(err({ kind: "cancelled", message: "sign-in was cancelled" }));
      server.close();
      server.closeAllConnections();
    };
    server.once("error", (error) => {
      resolve(err({ kind: "unavailable", message: `could not listen for the redirect: ${errorMessage(error)}` }));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve(ok({ redirectUri: `http://127.0.0.1:${String(port)}${callbackPath}`, wait: () => answer, close }));
    });
  });
}
