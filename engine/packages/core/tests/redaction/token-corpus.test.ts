import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMcpSecretRedactor, createSecretScrubber, scrubSecrets, scrubSecretsDeep } from "../../src/index.ts";

interface CorpusEntry {
  readonly format: string;
  readonly text: string;
  readonly secrets: readonly string[];
}

interface Corpus {
  readonly redact: readonly CorpusEntry[];
  readonly preserve: readonly string[];
}

// Every value in the corpus is fake; see fixtures/README.md.
const corpus = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "token-corpus.json"), "utf8")) as Corpus;

function leaks(text: string, secret: string): boolean {
  return text.includes(secret) || text.includes(JSON.stringify(secret).slice(1, -1));
}

describe("token corpus", () => {
  it.each(corpus.redact.map((entry) => [entry.format, entry] as const))("redacts %s", (_format, entry) => {
    const scrubbed = scrubSecrets(entry.text);
    expect(scrubbed).toContain("[redacted]");
    for (const secret of entry.secrets) {
      expect(leaks(scrubbed, secret), `${secret} survived in ${scrubbed}`).toBe(false);
    }
  });

  it("redacts every entry when all of them share one text", () => {
    const scrubbed = scrubSecrets(corpus.redact.map((entry) => entry.text).join("\n"));
    for (const secret of corpus.redact.flatMap((entry) => entry.secrets)) {
      expect(leaks(scrubbed, secret), secret).toBe(false);
    }
  });

  it.each(corpus.preserve.map((text) => [text]))("leaves %s unchanged", (text) => {
    expect(scrubSecrets(text)).toBe(text);
  });

  it("is idempotent", () => {
    for (const entry of corpus.redact) {
      const once = scrubSecrets(entry.text);
      expect(scrubSecrets(once)).toBe(once);
    }
  });

  it("keeps the name of the header or setting that held the secret", () => {
    expect(scrubSecrets("DD_API_KEY=0000fake0000fake0000fake0000fake")).toBe("DD_API_KEY=[redacted]");
    expect(scrubSecrets("Authorization: Bearer fake0bearer1token2value3FAKE4")).toBe("Authorization: Bearer [redacted]");
    expect(scrubSecrets("snowflake://svc:FAKEpass0123@acme/db")).toBe("snowflake://svc:[redacted]@acme/db");
  });

  it("redacts a string under a sensitive key in structured values, but not a secret reference", () => {
    const scrubbed = scrubSecretsDeep({
      env: { DD_API_KEY: "short", GITHUB_TOKEN: "${secret:keychain:github/token}" },
      args: ["--token", `sent ${corpus.redact[0]?.secrets[0] ?? ""}`],
      tokenLimit: 1000,
    });
    expect(scrubbed).toEqual({
      env: { DD_API_KEY: "[redacted]", GITHUB_TOKEN: "${secret:keychain:github/token}" },
      args: ["--token", "sent [redacted]"],
      tokenLimit: 1000,
    });
  });

  it("removes values the engine handled before applying the patterns", () => {
    const known = createMcpSecretRedactor();
    const scrubber = createSecretScrubber(known);
    scrubber.remember("opaque-value-without-a-format");
    expect(scrubber.redact("got opaque-value-without-a-format and ghp_FAKE0000fake1111FAKE2222fake3333FAKE")).toBe(
      "got [redacted] and [redacted]",
    );
  });
});
