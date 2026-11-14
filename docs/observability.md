# Observability

H-04 covers three pieces: structured engine logs, the diagnostics bundle, and an optional OpenTelemetry export of usage metrics. Export is **off by default**. With no exporter configured, the engine opens no outbound connection of its own.

## Structured logs

`createStructuredLog({ write, clock, redactor, capacity? })` (`core/src/observability/structured-log.ts`) writes one JSON object per line:

```json
{"ts":"2026-11-14T09:00:00.000Z","level":"warn","component":"picad","msg":"…"}
```

Each message goes through the H-03 scrubber before it is written or kept. `logger(component)` returns the engine's `Logger` shape. `recent()` returns the last `capacity` lines (500 by default) for the diagnostics bundle. `picad` (`server/src/main.ts`) logs this way to stderr, and supervisors send stderr to `picad.log`.

## Diagnostics bundle

`collectDiagnostics({ store, generatedAt, environment, config, logs, maxSessions? })` (`core/src/observability/diagnostics.ts`) gathers the 20 most recently updated sessions, or `maxSessions` of them, together with their events. It passes them to H-03's `buildDiagnosticsBundle`, so content fields are omitted and everything else is scrubbed (see [redaction.md](redaction.md)). A failed store read does not fail the bundle. It is recorded under `environment.collectionErrors` instead.

`writeDiagnosticsFile(path, bundle)` (`adapters/src/observability/`) writes the bundle as pretty JSON with mode 0600. It never overwrites an existing file (`diagnostics.exists`).

## Usage metrics over OTLP

- **Source.** `meteredUsage(usageRepository, meter)` wraps the repository that C-08's ledger writes to. Only records the store accepted reach the meter, so the exported totals are the ledger's totals.
- **Metrics.** The metrics are cumulative monotonic sums (temporality 2). Since the engine started, the meter accumulates one point per `pica.agent` × `pica.model` × `pica.tier`:
  - `pica.usage.calls` (`{call}`, int)
  - `pica.usage.tokens` (`{token}`, int, with `pica.token.type` = `input` | `cached_input` | `output`)
  - `pica.usage.credits` (`{credit}`, double, rounded like `usage.rollup`)

  The resource carries `service.name=picad` and, when given, `service.version`.
- **Encoding.** `usageMetricsRequest(...)` encodes an OTLP/JSON `ExportMetricsServiceRequest`. 64-bit integers are written as decimal strings.
- **Transport.** `createOtlpHttpTransport({ endpoint, headers?, timeoutMs?, fetch? })` POSTs the request with `content-type: application/json`. The endpoint is used as given, for example `http://localhost:4318/v1/metrics`. Errors are typed: `metrics.rejected` for a non-2xx answer and `metrics.export_failed` for a network failure or timeout.
- **Driver.** `createUsageMetricsExporter({ transport, clock?, intervalMs?, serviceVersion? })` (`server/src/metrics-export.ts`) is passed to the engine as `sessions.metricsExport`. The engine then starts it: it exports every 60 s on an unref'd timer and logs failures as warnings. The caller calls `stop()` on shutdown, which sends a final export. Nothing is sent while no usage has been recorded.

### Why no OpenTelemetry SDK

The SDK path needs `@opentelemetry/sdk-metrics`, `exporter-metrics-otlp-http`, `resources` and `api`, together with their transitive dependencies. That is all to emit three counters that the ledger already aggregates. The OTLP/JSON shape is small and stable, so a hand-written encoder behind the `MetricsTransport` port is simpler and adds no dependency (§8).

## Not wired yet

`picad` starts without sessions (see E-10), so it has no exporter, and no RPC returns a bundle yet. Whoever wires sessions into `main.ts` should do two things:

- When the user has configured an endpoint, build `createUsageMetricsExporter({ transport: createOtlpHttpTransport(...) })` and call `stop()` on SIGTERM.
- Expose `collectDiagnostics` + `writeDiagnosticsFile` through a `diagnostics.*` method and `pica diagnostics`.

## Tests

- `server/tests/observability/no-outbound.test.ts` stubs every Node network entry point: `net.Socket#connect` for anything that is not a Unix socket, plus `tls`, `http`, `https`, `dgram`, `dns.lookup` and `fetch`. With export disabled, it runs a multi-agent fixture session, writes structured logs, and collects and writes a bundle, and it asserts that nothing went out. A control case checks that the stub catches a TCP connect and the exporter's request.
- `server/tests/observability/metrics-export.test.ts` exports the same fixture through the OTLP transport with a stubbed fetch. It checks that the per-agent and per-model sums equal `usage.rollup`.
