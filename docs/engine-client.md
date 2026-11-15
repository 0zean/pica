# EngineClient behavior (A-02)

`app/Packages/EngineClient` is the app's only connection to `picad`. This page specifies what PLAN.md leaves open:
timeouts, cancellation, reconnects, and engine-initiated requests. The tests in
`app/Packages/EngineClient/Tests/EngineClientTests` check exactly these rules.

## Transport

JSON-RPC 2.0, one JSON object per line (NDJSON), over a Unix domain socket (D-04). S-07 measured this at 25,000
events/s with p99 around 0.1 ms, so the client adds no batching or coalescing of its own. A dedicated thread reads with
`read(2)` into a 64 KB buffer, as in the spike. Writes go through a serial queue. A line longer than 8 MiB (the
engine's limit) is treated as a broken connection.

Each incoming line is decoded twice: once for the routing fields (`id`, `method`, and for `events.event` the
`subscriptionId` and `seq`), then as the concrete type. A duplicate event is dropped after the first, cheaper pass.

## Connecting

`connect()` opens the socket and sends `engine.hello` with `ProtocolVersion.current`. It makes one attempt and throws
on failure. Starting and restarting `picad` belongs to A-01.

## Requests

`request(Method.self, params, timeout:)` sends a request and returns the method's typed result.

- **Timeout.** Each request has a timeout, 30 s by default (`Configuration.requestTimeout`), which a call can override.
  The timer runs on the injected clock and starts when the request is registered, just before it is written. When it
  fires, the call throws `EngineClientError.timedOut(method:after:)`. The connection stays open.
- **Cancellation.** If the calling task is cancelled while waiting, the call throws `CancellationError` straight away
  and its timer stops. If the task is already cancelled when it calls `request`, nothing is written. The protocol has
  no cancel message, so the engine still finishes a request that was already written.
- **Late answers.** An answer that arrives after its request timed out or was cancelled is dropped.
- **Lost connection.** Requests waiting when the connection drops throw `.disconnected`. They are not retried, because
  most methods are not idempotent. A request made while there is no connection throws `.notConnected` at once.
- **Close.** `close()` fails waiting requests with `.closed`.
- **Engine errors** throw `.engine(RpcError)`. `EngineClientError.code` gives the stable `ErrorCode` from `data.code`.

## Event streams

`events(sessionId:afterSeq:)` returns an `AsyncThrowingStream<SessionEvent, any Error>` and sends
`events.subscribe {sessionId, afterSeq}`.

- The stream remembers the last `seq` it delivered. Events at or below that `seq` are dropped, so a replay that
  overlaps what was already delivered causes no duplicate.
- The engine replays the log before it answers `events.subscribe` (E-07), so events can arrive before the answer that
  names their subscription. The client holds them until the answer arrives, then delivers them in order.
- After a reconnect, every open stream subscribes again with `afterSeq` set to its last delivered `seq`, so it resumes
  at `seq + 1`. Events tagged with a subscription id from an earlier connection are ignored.
- If the engine refuses a subscription, the stream finishes with that error. `close()` finishes every stream without
  an error. When a consumer stops iterating, the client sends `events.unsubscribe`.

Other notifications are available as `AsyncStream`s through `notifications(Notification.self)`.

## Reconnecting

Once a connection has been established, losing it starts reconnecting. The state goes to `.reconnecting`, the first
attempt is immediate, and later attempts wait `Configuration.reconnectDelays` on the injected clock (100 ms, 250 ms,
500 ms, 1 s, then 2 s repeated). A reconnect counts as done after `engine.hello` and every resubscription succeed, and
then the state becomes `.connected`. If the engine refuses the handshake with `protocol_version_mismatch`, the client
stops trying, moves to `.refused`, and finishes every stream with that error. `connectionStates()` reports each change.

## Engine-initiated requests

The engine asks the app for secrets with `secrets.get {secretRef}` (§4.5). The client answers from its
`SecretBroker`:

- When the secret is found, the client answers `{value}`.
- When it is missing, or the store fails, the client answers error -32000 with `data.code = secret_unresolved` and
  `data.details.secretRef`.
- Bad params get `invalid_params`. Any other engine method gets `method_not_found`.

`secrets.set {secretRef, value}` (M-07) hands the app a secret the engine moved out of an imported MCP entry
([mcp-import.md](mcp-import.md)). The client stores it under the reference, replacing any value there, and answers
`{ok: true}`; when the store fails it answers `secret_unresolved` as above.

`KeychainSecretBroker` reads and writes generic-password items with service `dev.pica.Pica.secrets` and account set
to the secret reference; items it adds are `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. M-03 settles the reference format and how secrets are written. Tests use `InMemorySecretBroker` from
`EngineClientTestSupport` and never touch the Keychain.

## Test support

`EngineClientTestSupport` provides `ScriptedEngineServer` (a real Unix-socket server; a test plays the engine's side
line by line), `ManualClock` (time moves only on `advance(by:)`; `waitForSleepers` lets a test advance past a
deadline that is already set), and `InMemorySecretBroker`.
