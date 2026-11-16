# App shell and engine supervision (A-01)

`app/Packages/AppShell` holds what the app does at launch: it takes the single-instance lock, starts and supervises
`picad`, and keeps an `@Observable` store (`AppModel`) of the engine's status for the window. The app target
(`app/Pica/PicaApp.swift`) only composes it. The tests in `app/Packages/AppShell/Tests/AppShellTests` and
`app/PicaUITests` check the rules on this page.

## Where things live

| What | Path |
|---|---|
| Socket | `PICA_SOCKET` if set (`picad` reads the same variable), else `~/Library/Application Support/Pica/run/picad.sock`, the CLI's default too |
| Engine log | `picad.log` next to the socket; the engine's stderr (JSON lines, H-04) is appended to it |
| Single-instance lock | `app.lock` next to the socket |

## Which engine runs

- **Bundled** (the default): `Contents/Helpers/node` runs `Contents/Resources/engine/picad.mjs`, with
  `COPILOT_CLI_PATH` set to `Contents/Resources/copilot/prebuilds/darwin-arm64/copilot-runtime` (S-05). H-06 puts these
  files into the bundle. Nothing is written inside the bundle.
- **Development**: when `PICA_ENGINE_ENTRY` names a TypeScript entry, the Node at `PICA_NODE` runs it with
  `--experimental-strip-types`. To run the app from Xcode against the source engine, set both in the scheme's
  environment, for example `PICA_ENGINE_ENTRY=<repo>/engine/packages/server/src/main.ts` and `PICA_NODE=$(which node)`.

A missing engine is reported as `engine_not_found` without starting anything.

## Supervision

1. At launch the supervisor first connects to the socket. An engine that is already listening, such as one the CLI
   started (§4.1), is used as it is.
2. Otherwise it starts the engine with `--socket <path>` and waits for the `{"ready":true,...}` line on stdout,
   up to 10 s. If the engine exits first, the status is `engine_start_failed`, with the exit code and the last line
   the engine logged in this run (E-11 names the file and key path that could not be opened) and the log's path. No
   ready line in time is `engine_start_timeout`, and the engine is killed.
3. A failed start is retried after 250 ms, 500 ms, 1 s, 2 s (the last repeats). After 3 failed starts in a row the
   status is `.failed`; the window offers Try Again, which resets the count.
4. When the engine dies, the `EngineClient` sees the socket close, reports `.reconnecting`, and reconnects by itself
   (A-02), resuming every event stream at `seq + 1`. The supervisor starts a new engine at once: when the one it
   started exits, or, for an engine it did not start, when the client starts reconnecting. The app's client retries
   the local socket after 50 ms, 100 ms, then every 250 ms, so it finds the new engine soon after its ready line.
   The test kills the engine with SIGKILL and requires the window to be back to connected within 2 s; it takes
   about 0.43 s on the reference machine.
5. On quit the app sends SIGTERM to the engine it started. `picad` closes its listener and store and exits.

## Protocol mismatch

The engine refuses an `engine.hello` of another major version with `protocol_version_mismatch`, whose details carry
`engine` and `client` versions (E-05). The supervisor stops for good: it stops the engine it started, does not
restart it, and the window shows a blocking panel that names both versions ("Pica speaks protocol 1.0, but the
engine speaks protocol 2.0") with the code and a Quit button. This applies on the first connection and on any
reconnect, for example when an update replaced the engine under a running app. Tests set
`EngineClient.Configuration.protocolVersion` to make the app speak 2.0 to the real engine.

## Window states

| Status | Window |
|---|---|
| `starting` | Banner "Starting the engine…"; the window is usable |
| `connected` | No banner |
| `reconnecting` | Banner "Reconnecting to the engine…"; the window is usable |
| `incompatible` | Blocking panel naming both protocol versions, code `protocol_version_mismatch`, Quit |
| `failed` | Blocking panel with the failure's message and code, Try Again and Quit |

The window never waits for the engine: it appears with the `starting` banner.

## Single instance

The app takes an exclusive `flock` on `app.lock` before anything else. A second copy, including one started with
`open -n`, cannot take it: it activates the running copy and exits. The kernel drops the lock when the process
exits, so a crash leaves nothing to clean up.

## Cold launch budget

§9 sets cold launch to interactive window under 1.0 s. With `PICA_LAUNCH_METRICS_PATH` set, the app writes the time
from the kernel's process start time (`sysctl(KERN_PROC_PID)`) to the first run-loop turn after the window appeared.
`LaunchPerformanceTests` (run by `make app-ui-test-pica`) launches Pica five times, each a new process with its own
data directory, against `picad` with a FakeRuntime, checks the window exists and is hittable, and requires the
median to be under 1.0 s and no more than `toleranceSeconds` above the baseline in
`app/PicaUITests/LaunchBaseline.json`. Change the baseline only for an accepted change, and record the machine and
samples with it.
