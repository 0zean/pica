# Approvals (A-07)

A session that needs the user's approval shows a card in its timeline with the choices **Allow Once**, **Always
Allow** and **Deny**. While Pica is in the background, a system notification says so. "Always Allow" saves a
permission rule in the user's `config.jsonc`, so the next identical request runs without asking.

The checks are `ApprovalsUITests` (`app/PicaUITests`), `ApprovalTests` (Timeline), `ApprovalNotifierTests`
(AppShell), and on the engine `approvals.test.ts` (production composition), `permission-rules.test.ts` (core) and
`permission-rule-writer.test.ts` (adapters).

## Flow

1. The runtime asks before a tool call (`permission.requested`). The session service records `approval.requested`
   and moves the session to `awaiting_approval`, unless a permission rule answers it (below).
2. The timeline turns `approval.requested` into a card. A-05 already drew the row; A-07 adds the choices and the
   call it is for: the tool and its command, path or url, taken from the `tool.started` the card follows.
3. A click sends `approval.resolve` with `allow_once`, `allow_always` or `deny`. The card shows "Sending your
   choice…" and keeps its buttons disabled until `approval.resolved` arrives, which every client sees. If the
   engine refuses the choice, the card stays pending and shows the reason.
4. The sidebar already sorts `awaiting_approval` sessions to the top (A-04). The notifier posts or withdraws the
   system notification from `session.changed`.

A budget approval (`budget.exhausted`) gets the same card with **Raise Budget** and **Stop**: allowing raises the
session's limit by the configured session budget, as `approval.resolve` does without `budgetCredits`. It has no
"always".

The app goes through `ResolveApprovalAction` in the environment. `SessionTimelineScreen` supplies one that calls the
engine; without one, as in snapshots of a single event, the choices are drawn disabled.

## Permission rules

"Always allow" needs a rule format for built-in tools, which the config did not have (`permissions.mcpTools` covers
only MCP tools by name) and a way to write it, which the engine did not have (`config.set` is in the protocol but no
handler implements it, and a generic key-path setter would have to merge arrays). So the engine writes the rule itself
when it resolves an `allow_always`, and the protocol's only change is the new config key. `approval.resolve` keeps its
shape.

```jsonc
// ~/Library/Application Support/Pica/config.jsonc
{
  "permissions": {
    "tools": [
      { "tool": "bash", "match": "npm test", "permission": "allow" },
      { "tool": "edit", "permission": "deny" }
    ]
  }
}
```

- **Identity.** Two requests are the same when they name the same tool and the same *subject*: the call's
  `command` (shell), else its `path` (file tools), else its `url`. Other arguments, such as an edit's text, are not
  compared, so "always allow" on an edit of `src/a.ts` allows later edits of that file. A call with none of the three
  gets a rule without `match`, which answers every call of that tool; the card's tooltip says which.
- **Precedence.** A rule with `match` beats one without; at the same level `deny` beats `allow`.
- **What a rule can answer.** Only the runtime's permission prompts. A call Pica's policy denies (managed policy,
  safety, cost gates) never reaches a prompt, so no rule can allow it.
- **When a rule answers.** The service resolves the prompt at once and records a `policy.decision` with
  `ruleId: "permission.rule"`, so the timeline attaches it to the tool row and the audit log has it. No approval is
  recorded and the session never enters `awaiting_approval`.
- **Writing.** `appendPermissionRule` (adapters) edits the user layer in place with `jsonc-parser`, so comments and
  formatting survive. It writes nothing when the file does not parse or validate, or when the same rule is already
  there, and replaces the file atomically. The rule is written before the approval is resolved: if it cannot be
  written, `approval.resolve` fails with "the permission rule was not saved" and the approval stays pending, so the
  user can still allow it once or deny it.
- **Reading.** Rules are read from the config on every prompt, as the read gate reads its settings, so a rule
  applies to running sessions at once and a hand edit applies too.

Rules are written to the user layer only, so they apply to every workspace. Workspace and repo config layers are not
composed per session yet (E-11).

## Notifications

`ApprovalNotifier` (AppShell) follows `session.changed`. When a session enters `awaiting_approval` it posts one
notification, titled "Approval needed", with the session's title and the first pending request's summary
(`approval.list`). When the session leaves that state, the notification is withdrawn. It is identified by the
session, so a later request replaces it. Clicking it selects the session and brings Pica to the front.

- **Frontmost.** While Pica is the active app it posts nothing: the session sorts to the top of the sidebar and the
  card is in the timeline, so a banner would only cover the window. A notification that arrives just as Pica
  becomes active is listed in Notification Center, not shown as a banner.
- **Permission.** `UserNotificationPoster` asks for notification permission the first time it has something to
  post, not at launch. `PICA_NOTIFICATIONS=off` turns notifications off; the UI tests set it, so no test meets the
  system prompt. The notifier's decisions are unit-tested with a recording poster.
- **Layering.** The notifier is part of AppShell, built in `AppLaunch`, and depends only on `EngineClient`; AppShell
  still depends on no feature package.

## Testing

`fake-picad`'s `approvals` scenario (`PICA_TEST_SCENARIO=approvals`) plays five turns: four run `npm test` and the
fifth `npm run lint`. FakeRuntime's tool-call step takes `asks`, which makes the runtime ask the host before the call
when the hook allowed it, as Copilot's own permission flow does. `ApprovalsUITests` allows the first turn once,
denies the second and always allows the third through the cards, then checks that the fourth runs without a card,
that `config.jsonc` holds `{ "tool": "bash", "match": "npm test", "permission": "allow" }`, and that the fifth
asks again. The engine test plays the same scenario over the production composition, and also checks that a comment
in the user's config survives and that an unwritable config keeps the approval pending.

## Limits

- In the production composition no Pica policy rule answers `ask` for a call yet: the read gate only decides reads,
  and the `permission.ask` and shell-scope rules are not composed into `onPreToolUse` (E-11's "not composed yet"
  list). So approvals come from the runtime's own permission requests and from budgets. S-04 found that a hook's
  `allow` may skip Copilot's own request, in which case tool-call approvals do not reach the user today. Composing
  the permission-mode rules is a follow-up; the cards, notifications and rules here work for whatever asks.
- A managed policy that locks `permissions.tools` makes the user's rules ignored; "always allow" still writes one.
- A pending approval identical to one just always-allowed, in another session, still waits for its own answer.
