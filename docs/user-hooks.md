# User hooks (X-03)

User hooks are shell commands that the engine runs on Pica events. They go under `hooks` in any `config.jsonc` layer:

```jsonc
{
  "hooks": {
    "sessionStart": [{ "command": "direnv allow ." }],
    "sessionEnd": [{ "name": "upload logs", "command": "./scripts/upload-logs", "timeoutSeconds": 10 }],
    "beforeCommit": [{ "name": "lint", "command": "pnpm lint --quiet" }]
  }
}
```

| Event | When | Working directory | Effect of a failure |
|---|---|---|---|
| `sessionStart` | After a new session's runtime is ready, before its first prompt. Resuming a session does not run it. | The session's first write root, or else its first reference root | Logged as an engine warning. The session continues. |
| `sessionEnd` | After the session has moved to `ended`. | Same as `sessionStart` | Logged. |
| `beforeCommit` | Before every commit made through the git service. | The repository | The commit is refused with `git.hook_blocked`. The hook's output is in `stderr`, and the remaining hooks do not run. |

## Running

- Each hook runs with `/bin/sh -c <command>` in its own process group. Hooks for one event run one at a time, in the order they are listed.
- `timeoutSeconds` defaults to 60 and can be at most 600. When a hook is still running at its timeout, the engine kills its whole process group with `SIGKILL` and reports `hook.timed_out`.
- The engine merges stdout and stderr in the order they were written and keeps the last 64 KiB.
- Environment: the engine's own environment, plus `PICA_HOOK_EVENT`. Session hooks also get `PICA_SESSION_ID`. `beforeCommit` hooks also get `PICA_REPO` and `PICA_COMMIT_MESSAGE`.

Failure codes: `hook.failed` (non-zero exit), `hook.timed_out`, `hook.not_started`, and `hook.denied`.

## Hooks and policy

Before the engine runs a hook, the policy (C-03) decides its command as a shell call. The call has tool `hook` and agent `user-hook`, and its roots come from the session or the repository. A `deny` stops the hook from running and counts as a failure, so a denied `beforeCommit` hook blocks the commit. Any other outcome lets the hook run, because the user who configured the hook has already approved it.

A hook only adds checks. Its exit status and output are never read as a policy decision, so a hook cannot allow something that a managed rule denies. An organization can:

- deny particular hook commands with a managed rule that has a `commandPattern`, or deny every hook with `agents: ["user-hook"]`;
- set hooks itself in the managed policy's `config` section, for example `hooks.beforeCommit`. Each event list it sets is locked, so the hooks that users configure for that event are ignored.
