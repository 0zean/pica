import { describe, expect, it } from "vitest";
import { createSecretScrubber, createStructuredLog } from "../../src/index.ts";

const token = "ghp_0123456789abcdefghijABCDEFGHIJ012345";

describe("structured engine log", () => {
  it("writes one scrubbed JSON object per line and keeps the same lines for diagnostics", () => {
    const written: string[] = [];
    const log = createStructuredLog({
      write: (line) => written.push(line),
      clock: () => "2026-11-14T09:00:00.000Z",
      redactor: createSecretScrubber(),
    });
    log.logger("picad").warn(`login failed for ${token}`);
    log.logger("mcp").info("datadog ready");

    expect(written.map((line) => JSON.parse(line) as unknown)).toEqual([
      { ts: "2026-11-14T09:00:00.000Z", level: "warn", component: "picad", msg: "login failed for [redacted]" },
      { ts: "2026-11-14T09:00:00.000Z", level: "info", component: "mcp", msg: "datadog ready" },
    ]);
    expect(written.join("\n")).not.toContain(token);
    expect(log.recent()).toEqual(written);
  });

  it("keeps only the most recent lines", () => {
    const log = createStructuredLog({ write: () => undefined, clock: () => "t", redactor: createSecretScrubber(), capacity: 2 });
    const logger = log.logger("picad");
    for (const message of ["one", "two", "three"]) {
      logger.error(message);
    }
    expect(log.recent().map((line) => (JSON.parse(line) as { msg: string }).msg)).toEqual(["two", "three"]);
  });
});
