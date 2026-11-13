import { describe, expect, it } from "vitest";
import { createLoopbackBrowser } from "../../src/index.ts";

async function listening(): Promise<{ redirectUri: string; wait: () => Promise<unknown>; close: () => void }> {
  const browser = createLoopbackBrowser({ open: () => undefined });
  const redirect = await browser.listen();
  if (!redirect.ok) {
    throw new Error(redirect.error.message);
  }
  return redirect.value;
}

describe("loopback redirect", () => {
  it("listens on 127.0.0.1 and hands back the code and state", async () => {
    const redirect = await listening();
    expect(redirect.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    const response = await fetch(`${redirect.redirectUri}?code=abc&state=xyz`);
    expect(response.status).toBe(200);
    expect(await redirect.wait()).toEqual({ ok: true, value: { code: "abc", state: "xyz" } });
    redirect.close();
  });

  it("reports a denied authorization", async () => {
    const redirect = await listening();
    await fetch(`${redirect.redirectUri}?error=access_denied&state=xyz`);
    expect(await redirect.wait()).toEqual({
      ok: false,
      error: { kind: "rejected", message: "authorization was not granted (access_denied)" },
    });
    redirect.close();
  });

  it("is cancelled by close", async () => {
    const redirect = await listening();
    redirect.close();
    expect(await redirect.wait()).toEqual({ ok: false, error: { kind: "cancelled", message: "sign-in was cancelled" } });
  });
});
