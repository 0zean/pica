# Reliability (H-05)

What the engine and the app do when the database is damaged, the disk fills, the engine is killed, or the engine
keeps crashing. Each rule below has a test; the paths are at the end.

## Damaged database

`picad` opens `~/Library/Application Support/Pica/pica.db` through `openRecoveringSqliteStore`
(`engine/packages/adapters/src/store/recovery.ts`).

1. Every open runs `PRAGMA quick_check` before anything writes to the file (the switch to WAL would rewrite a
   damaged header). A file that is not a database (`SQLITE_NOTADB`), damage SQLite raises (`SQLITE_CORRUPT`), and
   problems the check reports are all `store.corrupt`.
2. On `store.corrupt` the engine renames the file to `pica.db.corrupt-<UTC time>` (for example
   `pica.db.corrupt-20261121T101500Z`, then `-2`, `-3`… when that name is taken), moves any `-wal`, `-shm` and
   `-journal` files with it, and opens a new empty database. Nothing is deleted. SQLite may already have checkpointed
   or removed a WAL when it closed the connection that found the damage; whatever is left moves with the backup and
   never reaches the new database.
3. Only damage is recovered. A busy database, one whose schema is newer than the engine (`store.schema_too_new`),
   or one that cannot be read still stops `picad` before its ready line, as E-11 specifies.
4. The engine logs a warning naming the backup, and `engine.health` returns it for as long as this engine runs:

   ```json
   { "status": "ok", "uptimeMs": 812, "sessionsRunning": 0,
     "storeRecovery": { "backupPath": "/Users/me/Library/Application Support/Pica/pica.db.corrupt-20261121T101500Z",
                        "reason": "database disk image is malformed", "at": "2026-11-21T10:15:00.123Z" } }
   ```

   `storeRecovery` is an optional field, so the protocol version is unchanged. An engine started later on the new
   database reports none.
5. The app asks `engine.health` each time it connects. When `storeRecovery` is present, the main window shows a
   notice ("Pica's database was damaged", with the backup path, selectable) above the content, which stays usable.
   Dismiss hides it for that backup.

The cost of the check is one read of every page at start; it is part of the engine start budget (§9, < 1.5 s).

## Disk full

SQLite reports a full disk as `SQLITE_FULL`, which the store maps to `store.full`. The write that failed is rolled
back, so the log and the rest of the database stay as they were.

When an event append (or a session state write) for a session returns `store.full`, the session service
(`engine/packages/core/src/sessions/storage-full.ts`):

1. stops listening to the session's runtime and closes it, so nothing more is appended for it;
2. tries to append `session.error { code: "storage_full" }` and move the session to `failed`, which broadcasts
   `session.changed`;
3. remembers the failure, so the session reads as `failed` and `session.send` and `session.abort` on it answer
   the RPC error `storage_full` (`details.reason: "session.storage_full"`), even when step 2 could not be written.

Every event appended before the failure stays readable: `events.subscribe` replays it unchanged and in seq order, and
the database passes `PRAGMA integrity_check`. If step 2 could not be written, a restarted engine finds the session as
the store last recorded it and makes it `resumable` like any session the previous engine left live (E-08); the user
can resume it once there is space.

Only a live session (one with a runtime) is failed. A write for a session without one, such as the
`session.aborted {reason: "engine"}` a starting engine appends while recovering sessions, returns `storage_full` to
its caller and leaves the session as it was, so it can be resumed once there is space.

The failure is per session: other sessions fail only when one of their own writes hits the full disk. The usage
ledger and the audit log are not covered here; their writes fail with their own errors.

**Simulation.** The tests cap the database with `PRAGMA max_page_count` (`openSqliteStore(path, { maxPageCount })`),
which makes SQLite fail writes with the same `SQLITE_FULL` a full disk gives, on Linux CI as on macOS. A second test
makes every write fail, including the failure's own, to check step 3.

## Kill and resume

Appends are synchronous and each commits in its own transaction (WAL, `synchronous = NORMAL`), and an event is sent to
clients only after its commit. So an engine killed with SIGKILL at any point loses no event a client received: E-03's
crash tests check the store, and H-05's cycle test checks the whole path.

`kill-resume-cycles.test.ts` starts a `picad` with a FakeRuntime as its own process, sends a turn, SIGKILLs the
engine after a different number of the turn's events each cycle (from the first to the hanging tool call), restarts
it, checks the log against every event any client received, resumes the session and sends again. At the end it replays
the whole log: seqs run 1…n with no gap, and every received event is there, unchanged.

| Where | Cycles | Time |
|---|---|---|
| `make verify` and `make verify UNIT=H-05` on a Mac | 100 | about 40 s |
| CI (`CI` is set) | 25 | a quarter of the local run, more on slower runners |
| Any run with `PICA_KILL_CYCLES=<n>` | n | |

`make verify UNIT=H-05` sets `PICA_KILL_CYCLES=100`, so the unit's check always runs the full hundred.

## Engine crash backoff (app)

A-01 restarts an engine the app started as soon as it exits. H-05 adds a backoff for one that keeps crashing
(`EngineSupervisor`, `docs/app-shell.md`):

- An exit within `crashWindow` (60 s) of the engine's ready line is an early crash. Early crashes in a row wait
  0, 1 s, 2 s, then 4 s (repeating) before the restart. The first restart stays immediate, so a single crash still
  recovers within A-01's 2 s.
- An exit after the engine ran longer than the window starts the count again.
- After 5 early crashes in a row the supervisor stops restarting and the window shows the blocking panel "The engine
  keeps stopping", code `engine_crash_loop`, with the count, the last exit and the log's path. Try Again resets the
  count.
- While the supervisor has given up, the client's own reconnect attempts neither start an engine nor replace the
  panel with the reconnecting banner.

An engine the app did not start (the CLI's) is replaced once when it goes away, as before.

## Tests

| Rule | Test |
|---|---|
| Damaged database kinds, backup naming, WAL files, too-new schema | `engine/packages/adapters/tests/store/recovery.test.ts` |
| `engine.health` reports the backup; a later start does not | `engine/packages/server/tests/reliability/corrupt-database.test.ts` |
| The window shows and dismisses the notice | `app/Packages/AppShell/Tests/AppShellTests/StoreRecoveryTests.swift` |
| Disk full during append | `engine/packages/server/tests/reliability/disk-full.test.ts` |
| Kill-and-resume cycles | `engine/packages/server/tests/reliability/kill-resume-cycles.test.ts` |
| Crash backoff | `app/Packages/AppShell/Tests/AppShellTests/EngineCrashBackoffTests.swift` |

Fixtures: `writeCorruptDatabase(path, kind)` in `@pica/testkit` writes a `not-a-database`, `damaged-pages` or
`truncated` file.
