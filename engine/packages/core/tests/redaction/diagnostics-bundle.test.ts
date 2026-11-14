import { SessionEvent } from "@pica/protocol";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDiagnosticsBundle, type DiagnosticsBundle, type PicaSessionEvent } from "../../src/index.ts";

interface Corpus {
  readonly redact: readonly { readonly secrets: readonly string[] }[];
}

// A recorded session in which the agent reads, quotes, and edits fixtures/session-files/billing.ts.txt,
// and the user, a tool, an MCP server, and the engine log all echo secrets from the token corpus.
const fixtures = join(import.meta.dirname, "fixtures");
const read = (name: string): string => readFileSync(join(fixtures, name), "utf8");

const events = read("session.pica.ndjson")
  .split("\n")
  .filter((line) => line !== "")
  // `parse` validates the fixture; its output type is the schema's, not the narrowed union.
  .map((line) => SessionEvent.parse(JSON.parse(line)) as PicaSessionEvent);
const fileContents = read(join("session-files", "billing.ts.txt"));
const secrets = [
  ...(JSON.parse(read("token-corpus.json")) as Corpus).redact.flatMap((entry) => entry.secrets),
  "0000fake0000fake0000fake0000fake",
];

function fixtureBundle(): DiagnosticsBundle {
  return buildDiagnosticsBundle({
    generatedAt: "2026-11-14T11:00:00.000Z",
    environment: { engineVersion: "0.0.0", protocolVersion: "1.0.0", platform: "darwin-arm64" },
    config: {
      mcp: {
        servers: [
          { id: "datadog", env: { DD_API_KEY: { secretRef: "keychain:datadog/api-key" }, DD_APP_KEY: "${secret:keychain:datadog/app-key}" } },
          { id: "clickup", env: { CLICKUP_API_TOKEN: "pasted-by-mistake-0123" } },
        ],
      },
    },
    sessions: [
      {
        session: {
          id: "session-fixture-1",
          title: "Fix billing",
          state: "idle",
          writeRoots: [{ repoId: "acme/app", path: "/worktrees/acme-app-fix-billing", branch: "pica/fix-billing" }],
          lastSeq: events.length,
        },
        events,
      },
    ],
    logs: read("engine.log").split("\n").filter((line) => line !== ""),
  });
}

// Lines long enough to identify the file, plus the identifiers only the file defines.
function fileFragments(): readonly string[] {
  const lines = fileContents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 12);
  return [...lines, "chargeCustomerFixture", "computeRetryLimit", "fixture-marker", "invoiceRetryLimit"];
}

describe("diagnostics bundle for a fixture session", () => {
  const bundle = fixtureBundle();
  const text = JSON.stringify(bundle);

  it("contains no file contents", () => {
    expect(fileFragments().length).toBeGreaterThan(5);
    for (const fragment of fileFragments()) {
      expect(text.includes(fragment), `file contents leaked: ${fragment}`).toBe(false);
    }
  });

  it("contains no secrets", () => {
    for (const secret of [...secrets, "pasted-by-mistake-0123"]) {
      expect(text.includes(secret), `secret leaked: ${secret}`).toBe(false);
      expect(text.includes(JSON.stringify(secret).slice(1, -1)), `secret leaked: ${secret}`).toBe(false);
    }
  });

  it("keeps what is needed to diagnose the session", () => {
    const session = bundle.sessions[0];
    expect(session?.events.map((event) => event.type)).toEqual(events.map((event) => event.type));
    expect(session?.events.map((event) => event.seq)).toEqual(events.map((event) => event.seq));
    const completed = session?.events.find((event) => event.type === "tool.completed");
    expect(completed?.payload).toMatchObject({
      toolName: "view",
      resultBytes: fileContents.length,
      resultPreview: { omitted: "content", chars: fileContents.length },
    });
    const edit = session?.events.find((event) => event.type === "tool.started" && event.payload["toolName"] === "edit");
    expect(edit?.payload["arguments"]).toMatchObject({ omitted: "content", keys: ["path", "old_str", "new_str"] });
    expect(session?.events.find((event) => event.type === "session.error")?.payload["message"]).toBe(
      "MCP server datadog exited: DD_APP_KEY=[redacted] rejected",
    );
    expect(bundle.config).toMatchObject({
      mcp: { servers: [{ env: { DD_APP_KEY: "${secret:keychain:datadog/app-key}" } }, { env: { CLICKUP_API_TOKEN: "[redacted]" } }] },
    });
    expect(bundle.logs).toContain("picad: info: session session-fixture-1 idle");
  });
});
