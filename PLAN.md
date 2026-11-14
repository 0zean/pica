# Pica — Development Plan

Source of truth for building Pica. Every unit of work below has an ID, explicit dependencies, and verification checks that pass or fail without judgment. A unit is done only when all of its checks pass.

- Created: 2026-11-12
- Status: planning complete, no code written
- How to update: tick checks as they pass, set the unit's status in the [unit index](#12-unit-index), and record any changed decision in [Decisions](#3-decisions) with a date. Do not silently diverge from this file.

---

## 1. Product

### 1.1 What Pica is

Pica is a native macOS app for running coding agents on enterprise codebases through GitHub Copilot. It has three jobs:

1. **Spend the expensive model only on reasoning.** Bulk reading, boilerplate, and oversized tool output are routed to cheap models by rules the agent cannot ignore.
2. **Treat a team's repositories as one workspace.** A developer adds the repos their team owns (by hand or from a GitHub team) and can work in several at once or reference one while editing another.
3. **Be a fast, native control surface.** Parallel sessions, isolated worktrees, diffs, approvals, usage, and MCP connections in one window that feels like a Mac app.

### 1.2 Reference points

| Reference | What we take | What we do differently |
|---|---|---|
| Spotify Xirp [1][2] | macOS app, parallel sessions, one git worktree per task, git/files/skills/rules in one surface | Xirp hosts third-party agent CLIs in terminals. Pica drives the Copilot runtime through its SDK, so it sees structured events and can enforce policy on every tool call. Xirp's multi-repo support is a parent folder with limited git controls; Pica makes multi-repo first-class. |
| Spotify's cost routing (background supplied by the project owner) | Split reasoning from non-reasoning work; `bulk-reader` and `code-writer` sub-agents on a cheap model; hooks that fire before large reads; a size threshold below which delegation is not worth 10–30 s of latency | Enforcement lives in the engine's policy layer rather than in instruction files, and savings are measured by an eval harness rather than assumed. |

### 1.3 Principles

1. **Enforce, don't suggest.** Anything that matters for cost or safety is a deterministic rule in the engine. Prompts only explain the rules to the model.
2. **The engine is the product; the app is a client.** If the `pica` CLI cannot do something, the app cannot either. No business logic in Swift.
3. **Measure cost.** Every model call is recorded with model, tokens, cached tokens, and agent. Savings claims come from the ledger and the eval suite.
4. **Use existing conventions.** Read `AGENTS.md`, `.github/copilot-instructions.md`, `.github/agents`, skills folders, and existing MCP config files. Invent a Pica-specific format only where none exists.
5. **Fast by budget.** Performance targets in [§9](#9-performance-budgets) are tests, not aspirations.
6. **Small surface.** A feature ships when it is needed by a unit in this plan. Nothing speculative.

### 1.4 Non-goals for v1

- Replacing an IDE or editor. Pica has a read-only file viewer and "Open in editor".
- Hosting or proxying models. Inference goes through the organization's Copilot entitlement.
- Windows or Linux UI. The engine stays portable; only the app is macOS-only.
- Driving other agent CLIs. The runtime sits behind a port so this stays possible later.
- A cloud backend or accounts. Everything is local to the developer's Mac.

---

## 2. Research findings

Facts the design depends on, with sources in [§13](#13-sources). Items marked *unverified* are settled by a spike in Phase 0.

### 2.1 GitHub Copilot

- **SDK.** The Copilot SDK went GA in June 2026 with official clients for TypeScript, Python, Go, .NET, Java, and Rust. There is no Swift client [3][4]. It drives the Copilot CLI runtime over JSON-RPC; the Node package bundles the CLI and manages it as a child process [4].
- **Auth.** Signed-in user (CLI login), OAuth GitHub App user tokens, `COPILOT_GITHUB_TOKEN`/`GH_TOKEN`/`GITHUB_TOKEN`, or BYOK. A Copilot subscription is required unless using BYOK [4].
- **Sub-agents.** `customAgents` entries take `name`, `prompt`, `description`, `tools`, `mcpServers`, `skills`, `infer`, **`model`**, and `reasoningEffort`. A sub-agent can run on a different model than its parent. `defaultAgent.excludedTools` hides tools from the main agent while leaving them available to sub-agents. Events: `subagent.started/completed/failed` with `toolCallId`, `model`, `totalTokens` [5].
- **Hooks.** SDK callbacks `onPreToolUse` (returns `permissionDecision` allow/deny/ask and a reason), `onPostToolUse` (returns `modifiedResult`), `onUserPromptSubmitted`, `onSessionStart` (returns `additionalContext`), `onSessionEnd`, `onErrorOccurred` [6]. The CLI hooks reference says hooks firing inside a sub-agent carry `agentId`, `agentType`, `parentAgentId` [7]. Whether the SDK callbacks receive the same for sub-agent tool calls is *unverified* (S-02).
- **Usage.** `assistant.usage` fires per model call including sub-agent calls, with `model`, `inputTokens`, `outputTokens`. `session.usage_info` gives `currentTokens`/`tokenLimit`. `session.usage.getMetrics` returns totals and per-model metrics. `models.list` returns `billing.tokenPrices`. `session.metadata.contextInfo` breaks context into system, conversation, and tool-definition tokens [8].
- **Budgets.** `sessionLimits.maxAiCredits` is a soft cap checked after each model call; exhaustion raises `session_limits_exhausted.requested` and blocks the next call until answered [9].
- **Sessions.** Persisted under `~/.copilot/session-state/{sessionId}/`; resumable by ID with `workingDirectory`; no built-in session locking [10].
- **MCP.** Per-session `mcpServers` with local (`command`, `args`, `env`, `cwd`) and remote (`type: http|sse`, `url`, `headers`, OAuth fields) entries. `tools` is the only filter. The runtime can own the OAuth loopback flow, or the host can supply tokens [11].
- **Billing.** Since 2026-06-01 Copilot bills by tokens as GitHub AI Credits (1 credit = $0.01) at each model's listed rates for input, cached input, and output. Business includes $19 and Enterprise $39 of credits per seat per month, pooled across the organization, with admin budgets at enterprise, cost-center, and user level. There is no fallback to a cheaper model when credits run out [12].

The billing change is why this project pays off: token-heavy, low-reasoning work on a frontier model now costs the organization real money per token, and cached-input pricing rewards a stable prompt prefix.

### 2.2 MCP servers we must support

| Server | Transport | Endpoint | Auth | Notes |
|---|---|---|---|---|
| GitHub | Remote HTTP | `https://api.githubcopilot.com/mcp/` | OAuth or PAT | Endpoint from secondary sources; confirm in S-06. |
| Datadog | Remote HTTP | `https://mcp.datadoghq.com/…` (per Datadog site) | OAuth or API + app key | Path differs by site; confirm in S-06. |
| ClickUp | Remote HTTP | `https://mcp.clickup.com/mcp` | OAuth | Confirm in S-06. |
| Snowflake | Remote HTTP | `https://<account_url>/api/v2/databases/{db}/schemas/{schema}/mcp-servers/{name}` | Snowflake OAuth, external OAuth, or PAT | Admin creates the server with `CREATE MCP SERVER`. Tools only, max 50, SQL read-only by default, no dynamic client registration [13]. |

### 2.3 GitHub repository discovery

REST endpoints: `GET /user/teams`, `GET /orgs/{org}/teams/{team_slug}/repos` (paginated), repository topics, and organization custom properties. Listing teams needs the `read:org` scope and SSO authorization in SAML-enforced orgs. The Copilot token is not assumed to carry these scopes, so discovery uses its own auth chain (R-04).

### 2.4 Assumptions to settle in Phase 0

| # | Assumption | Spike | If false |
|---|---|---|---|
| A1 | The org's Copilot policy permits CLI/SDK use and returns a model list with token prices | S-01 | Ask the org admin to enable it; BYOK as a stopgap |
| A2 | SDK `onPreToolUse` fires for sub-agent tool calls and identifies the calling agent | S-02 | Delegate through engine-managed child sessions, where identity is known by construction |
| A3 | A deny with a reason reliably makes the main agent delegate | S-02 | Expose an engine `delegate` tool and remove the direct large-read path from the main agent |
| A4 | A sub-agent's `model` override is honored and billed at that model's rate | S-03 | Engine-managed child sessions with an explicit model |
| A5 | Usage can be attributed per agent | S-03 | Attribute by `toolCallId` window, or by child session |
| A6 | A session can read outside its `workingDirectory` once the host approves | S-04 | Session root directory of symlinks, or cross-repo access only through engine tools |
| A7 | Node, the engine bundle, and the Copilot CLI can be signed and notarized inside the app | S-05 | Install the engine separately (pkg or Homebrew) |
| A8 | All four MCP servers connect through the SDK, including OAuth | S-06 | Host-managed tokens supplied by Pica |
| A9 | Event streaming over a Unix socket meets the throughput budget. **Confirmed** by S-07: 50,000 events at 25,000/s in order, p99 write-to-decoded ≈ 0.1 ms ([findings](docs/spikes/S-07.md)) | S-07 | Coalesce events per display frame in the engine |

---

## 3. Decisions

| ID | Decision | Reason | Date |
|---|---|---|---|
| D-01 | Native SwiftUI app plus a headless TypeScript engine | Native feel and speed in the UI; official Copilot SDK in the engine; engine testable without UI | 2026-11-12 |
| D-02 | Development happens on a Mac from Phase 0 | Owner confirmed a Mac is available | 2026-11-12 |
| D-03 | Pica drives the Copilot runtime through the SDK rather than hosting agent CLIs in terminals | Structured events and enforceable hooks are the whole point; a terminal is still provided per worktree | 2026-11-12 |
| D-04 | App ↔ engine transport is JSON-RPC 2.0 over a Unix domain socket, NDJSON framed | Lets the app and the `pica` CLI share one engine; simple to debug | 2026-11-12 |
| D-05 | Protocol types are defined once (zod → JSON Schema) and generated for Swift | One source of truth; drift fails CI | 2026-11-12 |
| D-06 | Sessions are event-sourced into SQLite with per-session sequence numbers | Crash recovery, reconnect without gaps, and deterministic replay tests | 2026-11-12 |
| D-07 | Engine follows ports-and-adapters; `core` has no I/O imports | Lets a scripted fake runtime stand in for Copilot in every test | 2026-11-12 |
| D-08 | Delegation uses runtime-native `customAgents` if S-02/S-03 pass, otherwise engine-managed child sessions; both sit behind one `Delegator` port | Keeps the fallback cheap | 2026-11-12 |
| D-09 | Model IDs are never hard-coded; tiers resolve against `models.list` | Model availability is set by org policy and changes often | 2026-11-12 |
| D-10 | Secrets live in the macOS Keychain, brokered by the app; the engine holds references only. CLI mode reads environment variables | Keychain items scoped to the signed app; nothing sensitive in config or the database | 2026-11-12 |
| D-11 | Config is layered JSONC with a published JSON Schema | Matches the MCP and Copilot config ecosystem; editor validation for free | 2026-11-12 |
| D-12 | No App Sandbox; hardened runtime; Developer ID distribution outside the Mac App Store | A developer tool must spawn processes and reach arbitrary repo paths | 2026-11-12 |
| D-13 | Minimum macOS 26; built with the current SDK; standard controls so system materials are adopted automatically. The macOS CI job runs on GitHub's `macos-26` image | Owner answered Q-03: macOS 15 is too old to keep supporting (was macOS 15, 2026-11-12) | 2026-11-13 |
| D-14 | The engine is a child process of the app in v1; sessions survive restarts by resume, not by a background daemon | Simplest lifecycle; a launch agent can come later without protocol changes | 2026-11-12 |
| D-15 | CI is split by cost (§8.1): `make verify-engine` on Linux for every PR; `make verify-app` on macOS only when app, protocol, codegen or `Makefile` change; no UI tests and no runs on pushes to `main`. Full local `make verify` remains the merge gate | Running full `make verify` on macOS for every PR update and push to `main` used the month's Actions minutes in one day (82 runs, ~200 macOS minutes on 2026-11-13), mostly for engine-only changes. Owner moved to GitHub Pro for more minutes; landed in #27 | 2026-11-14 |

---

## 4. Architecture

### 4.1 Processes

```
┌──────────────────────────── Pica.app (Swift 6, SwiftUI + AppKit) ───────────────────────────┐
│  Features: Sidebar · Session · Composer · Review · Terminal · Usage · MCP · Settings        │
│  DesignSystem      EngineClient (actor)      PicaProtocol (generated)      Keychain broker  │
└───────────────────────────────┬──────────────────────────────────────────────────────────────┘
                                │ JSON-RPC 2.0, NDJSON, Unix socket (0600)
┌───────────────────────────────┴──────────────── picad (TypeScript, Node LTS) ───────────────┐
│  server    RPC transport, composition root                                                   │
│  core      sessions · policy · routing · budgets · workspaces · MCP registry   (pure)        │
│  adapters  copilot · git · github · store (SQLite) · fs · secrets · search                   │
└──────────┬───────────────────────┬──────────────────────┬────────────────────────────────────┘
           │ Copilot SDK           │ git CLI, ripgrep     │ HTTPS
   Copilot CLI runtime ── models   local repos/worktrees  GitHub REST
           └── MCP servers (GitHub, Datadog, ClickUp, Snowflake, custom)
```

`pica` (CLI) is a second client of the same socket. It starts `picad` if none is running.

### 4.2 Repository layout

```
pica/
  PLAN.md
  Makefile                      verify, lint, codegen, build entry points
  docs/                         brand/, adr/, spikes/, evals/, guides/
  engine/                       pnpm workspace
    packages/
      protocol/                 schemas for RPC methods, events, DTOs → JSON Schema
      core/                     domain and use-cases; no I/O imports
      adapters/                 copilot/ git/ github/ store/ fs/ secrets/ search/ mcp/
      server/                   picad: socket transport, wiring
      cli/                      pica
      testkit/                  FakeRuntime, scenario DSL, replay server, repo fixtures
      evals/                    cost/success benchmark harness
    tools/                      engine-side tooling in TypeScript: lint-arch, protocol-schema, swift-codegen
  app/
    Pica.xcodeproj
    Pica/                       app target: composition only
    Packages/
      PicaProtocol/             generated Codable types
      EngineClient/
      DesignSystem/
      Features/                 one target per feature
  spikes/                       throwaway Phase 0 scripts
  tools/                        codegen, verify runner, release scripts
  .github/workflows/
```

### 4.3 Layering rules (enforced by F-02)

- `core` imports only `protocol`. No `node:*` I/O modules, no SDKs.
- `adapters` implement ports declared in `core`. Adapters do not import each other.
- `server` and `cli` are the only places that construct adapters.
- Swift feature targets depend on `EngineClient`, `PicaProtocol`, `DesignSystem`; never on each other. Cross-feature navigation goes through the app target.
- Swift never shells out to `git`, reads repo files, or calls GitHub. It asks the engine.

### 4.4 Domain model

| Entity | Key fields | Notes |
|---|---|---|
| `Repo` | id, remote URL, local path, managed (bool), default branch, clone state | Identity is the normalized remote URL. Unmanaged repos are never moved or deleted. |
| `RepoSource` | kind (`manual` \| `team` \| `topic` \| `property`), org, selector, last sync | Produces a set of repos. |
| `Workspace` | id, name, sources, pinned repos, settings overrides | The unit a developer thinks in: "my team's stuff". |
| `Session` | id, workspace, write roots, reference roots, state, routing profile, budget | One Copilot session plus Pica metadata. |
| `Worktree` | repo, session, path, branch | One per write root. |
| `AgentDef` | name, tier, tools, prompt, source layer | Built-in, user, workspace, or repo. |
| `McpServerDef` | id, transport, endpoint or command, secret refs, tool allowlist, scope | |
| `SessionEvent` | session, seq, type, payload, timestamp | Versioned union; the only thing the UI renders from. |
| `UsageRecord` | session, agent, model, input/cached/output tokens, credits, timestamp | One per model call. |
| `PolicyDecision` | rule id, outcome, reason, tool call | Emitted as an event and written to the audit log. |

Session states: `starting → idle ⇄ running ⇄ awaiting_approval`, then `ended` or `failed`. A session whose engine died mid-run is `resumable`.

### 4.5 Protocol shape

Namespaces: `engine.*` (handshake, version, health), `workspace.*`, `repo.*`, `github.*`, `session.*`, `events.*`, `approval.*`, `git.*`, `files.*`, `mcp.*`, `agents.*`, `models.*`, `usage.*`, `config.*`, `secrets.*` (engine → client requests).

Rules:
- `engine.hello` exchanges protocol versions; a major mismatch refuses the connection.
- State changes arrive as notifications. `events.subscribe {sessionId, afterSeq}` replays from the log and then goes live with no gap and no duplicate.
- Every error has a stable `code`, a human `message`, and optional `data.fix` naming an action the client can offer.

### 4.6 Configuration

Precedence, lowest to highest: built-in defaults → user (`~/Library/Application Support/Pica/config.jsonc`) → workspace → repo (`.pica/config.jsonc`). A managed policy file can lock any key; locked keys ignore every other layer.

```jsonc
{
  "routing": {
    "profile": "balanced",
    "tiers": { "reasoning": "auto", "worker": "auto" },
    "delegation": {
      "read":   { "minBytes": 32768, "rangeExemptLines": 400 },
      "output": { "maxBytes": 16384 }
    }
  },
  "budget": { "sessionCredits": 300, "workspaceDailyCredits": 3000 },
  "permissions": { "mode": "ask" }
}
```

The numbers above are starting defaults. C-10 tunes them from measurements.

---

## 5. Cost routing design

This is the core of the product, so it is specified before the work units.

### 5.1 Three layers

| Layer | Spotify's version | Pica's version |
|---|---|---|
| Instruct | Skills telling the agent to use the sub-agents | A short, fixed delegation guide injected at session start: which agents exist and when to use them. Fixed text keeps the cached prefix stable. |
| Enforce | Hooks before every large file read | The policy engine evaluates every tool call in `onPreToolUse` and every result in `onPostToolUse`. |
| Execute | Scripts wrapping the platform CLI to launch sub-agents | The `Delegator` port: runtime-native sub-agents or engine-managed child sessions (D-08). |

### 5.2 Tiers and agents

Tiers are names, not models: `reasoning` (frontier) and `worker` (cheap, fast). Each resolves to a model from `models.list` by user choice or by an `auto` rule, restricted by managed policy.

| Agent | Tier | Tools | Job | Output contract |
|---|---|---|---|---|
| main | reasoning | Depends on profile | Plan, decide, review, make small edits | — |
| `bulk-reader` | worker | Read, search, list. No write, no shell | Answer a specific question about large files or many files | Answer with `path:line` citations, capped length |
| `code-writer` | worker | Read, write, edit within write roots | Produce tests, configs, scaffolding, and mechanical edits from a precise spec | List of files changed and a one-paragraph summary |
| `repo-scout` | worker | Cross-repo search and ranged read | Find where something lives across workspace repos | Ranked `repo:path:line` hits with one-line context |

### 5.3 Policy rules

`decide(toolCall, context) → allow | deny(reason) | ask | rewrite` is a pure function. Rules run in a fixed order and the first match wins:

1. **Managed policy** — organization locks. A managed deny can never be overridden.
2. **Safety** — path must resolve inside the session's roots; writes only inside write roots; command deny-list.
3. **Cost routing** — the gates below.
4. **Permission mode** — the user's ask/auto settings.

Cost gates:

| Gate | Trigger | Outcome |
|---|---|---|
| Large read | Main agent reads a file over `read.minBytes`, without a line range of at most `rangeExemptLines` | Deny with a reason naming `bulk-reader`. Sub-agent reads pass. |
| New-file write | Profile `balanced`: main agent has no create-file tool. Profile `strict`: main agent has no write tools at all | Structural: the tool is absent, so no output tokens are wasted on a call that would be denied |
| Oversized output | Any tool result over `output.maxBytes` (shell, search, MCP) | Result is truncated head and tail; the full output is spilled to a session artifact with a pointer the agent can hand to `bulk-reader` |
| MCP fan-in | MCP servers attach per session or per agent, never globally | Tool definitions for unused servers never enter the context |

Profiles: `off` (no cost gates; the baseline for evals), `balanced` (default), `strict`.

Every decision is emitted as an event with its rule ID, so the timeline can show "Read of `schema.sql` (212 KB) redirected to bulk-reader".

### 5.4 Why not gate writes with a hook

By the time a write tool call reaches `onPreToolUse`, the frontier model has already generated the file content as output tokens. Denying it wastes them. Writes are therefore routed by removing tools from the main agent, not by rejecting calls.

### 5.5 Cache discipline

Cached input is priced well below fresh input, and any change to the system prompt or tool set invalidates the cache. So: the delegation guide is constant per profile, the tool set is fixed at session start, and changing MCP servers mid-session shows the cost of doing so before applying.

### 5.6 Measurement

- **Ledger.** One `UsageRecord` per model call, rolled up by session, agent, model, workspace, and day.
- **Savings estimate.** Worker-tier tokens repriced at the reasoning-tier rate, minus what was actually paid. Labeled as an estimate everywhere it appears.
- **Evals.** A fixed task suite run under each profile, reporting reasoning-tier tokens, credits, wall time, and task success (C-10).

---

## 6. Multi-repo design

- **Adding repos.** By local path (registered in place), by URL (cloned to `~/Pica/repos/<org>/<repo>`, partial clone), or from a source: GitHub team, topic, or custom property. Team sources list repos as *available*; a repo is cloned the first time it is used.
- **Workspace.** A named set of sources plus pinned repos, with its own routing, MCP, and budget overrides.
- **Session scope.** Each session has *write roots* (worktrees Pica created for it) and *reference roots* (other workspace repos, read-only). The safety rules in §5.3 enforce the difference on every tool call, including shell commands.
- **Cross-repo reference.** `@repo:path` in the composer; engine tools `repo_search`, `repo_read`, `repo_list`; and the `repo-scout` agent, so finding code elsewhere costs worker-tier tokens.
- **Repo cards.** A compact per-repo summary (languages, manifests, build and test commands, owners, entry points), computed without a model and cached by HEAD commit. Cards for the workspace are included at session start so the agent knows where to look without reading.
- **Change sets.** One session writing to several repos gets a worktree and same-named branch in each, per-repo diffs, and linked pull requests.
- **Fan-out.** One task run as parallel sessions across selected repos with a concurrency cap and an aggregate result.

---

## 7. UX design

### 7.1 Window

Three columns in a `NavigationSplitView`:

- **Sidebar** — workspaces, their repos, and sessions with live status. Sessions needing attention sort to the top.
- **Session** — the timeline and composer.
- **Inspector** (toggle) — Changes, Files, Terminal, Usage, Context.

Everything reachable from the keyboard: ⌘K command palette, ⌘P quick open across workspace repos, ⌘N new session, ⌘↩ send, ⌘. stop, ⌘1–9 sessions.

### 7.2 Timeline

Assistant text streams as rendered Markdown. Tool calls are single compact rows that expand on click. Sub-agent runs are collapsed groups showing agent name, model, duration, and tokens. Policy decisions and approvals are inline rows. A header chip shows context use, tokens, and credits for the session.

### 7.3 Brand

From [docs/Magpie Glass Icon.png](docs/Magpie%20Glass%20Icon.png): a flat magpie in ink, slate blue, and off-white, inside an open ring with two spark marks, on frosted glass over a periwinkle-to-peach gradient.

- Palette tokens: `ink`, `slate`, `paper`, plus the gradient pair for empty states and onboarding only. Exact values are sampled in A-03.
- The ring and sparks are the activity motif: the sparks animate while an agent is working, and the ring is the progress shape.
- Glass is used where the system uses it (sidebar, toolbar). Content areas stay opaque for legibility.

### 7.4 Customization

Theme (accent, density, code font and size), keybindings, inspector layout, routing profile and thresholds, tier models, custom agents, skills, rules, MCP servers, permission rules. All of it is plain files under version control if the developer wants, with a Settings UI that edits the same files.

---

## 8. Engineering standards

- **Comments.** Code explains itself through names and structure. A comment appears only where the reason for something is not visible in the code. Longer explanation goes in `docs/`, linked from the module's README if needed.
- **No cleverness.** Prefer the obvious construct. No metaprogramming, operator tricks, or abstractions with a single implementation, except ports that exist for testing.
- **Size.** Functions fit on a screen. A file has one reason to change.
- **Errors.** Typed results at port boundaries; exceptions do not cross a port. Every user-visible error has a stable code.
- **TypeScript.** `strict`, no `any`, no default exports, pure functions in `core`.
- **Swift.** Swift 6 language mode with complete concurrency checking. `@Observable` stores, unidirectional flow: `EngineClient` → store → view. No third-party architecture framework.
- **Dependencies.** Each new dependency is justified in the PR. Expected set: Copilot SDK, zod, a JSONC parser, a SQLite driver, vitest, esbuild; SwiftTerm, Sparkle, a Markdown parser, a syntax highlighter.
- **Tests.** Deterministic by default: no network, no model, no wall-clock sleeps. Live tests run only with `PICA_LIVE=1` and are never a merge gate.

### 8.1 Verification convention

- `make verify` runs lint, architecture rules, type checks, codegen drift, and all deterministic tests for engine and app.
- CI runs a cheaper subset on pull requests only: `make verify-engine` (lint, architecture rules, type checks, codegen drift, engine tests) on Linux for every PR, and `make verify-app` (Swift packages and the app build) on macOS only when `app/`, the protocol package, codegen tools, or the `Makefile` change. UI tests and pushes to `main` are not run in CI; the full local `make verify` is the gate.
- `make verify UNIT=<ID>` runs exactly the checks mapped to that unit in `tools/verify/units.json`. A unit's checkboxes below are the contents of that mapping.
- Each mapped check has a `run` command, or is marked `manual`, or `live` (run only with `PICA_LIVE=1`). A check with no command yet is reported as pending and fails the unit.
- Checks marked **(live)** need a Copilot login. Checks marked **(manual)** need a person; they are kept to a minimum and each says exactly what to observe.

### 8.2 Definition of done for any unit

1. `make verify UNIT=<ID>` exits 0 and every listed check is ticked.
2. `make verify` exits 0.
3. No new lint suppressions; no `TODO` without a unit ID.
4. The unit index status is updated.
5. The unit's work is opened as a pull request against `main` as soon as it is finished, with Auto-fix turned on so CI failures, merge conflicts, and review comments are handled on the PR. A unit is not `done` until that PR's CI checks (§8.1) pass and it is merged. When landing, merge `main` into the branch and rerun `make verify` locally; push again only if the merge changed something.

---

## 9. Performance budgets

Enforced as tests in H-07 and in the units that own them.

| Metric | Budget | Owner |
|---|---|---|
| App cold launch to interactive window | < 1.0 s | A-01 |
| Engine start to `engine.hello` reply | < 1.5 s | E-05 |
| Keystroke to glyph in composer | < 16 ms | A-06 |
| Open a 10,000-event session | < 300 ms | A-05 |
| Timeline scroll hitch time ratio | < 1% | A-05 |
| Render a 5,000-line diff | < 200 ms | A-08 |
| Quick open over 100,000 files | < 50 ms per keystroke | A-09 |
| Event delivery engine → view, p99 | < 5 ms | S-07, A-02 |
| App idle CPU with 5 idle sessions | < 1% | H-07 |
| App memory with 5 sessions of 2,000 events | < 300 MB | H-07 |
| Policy decision, p99 | < 1 ms | C-03 |

---

## 10. Work units

Format: **ID · name** — dependencies. *Build* says what exists afterwards. *Verify* lists the checks.

### Phase 0 — Spikes

Throwaway code in `spikes/`. Each spike is a script that exits 0 only when its assertions hold, plus a findings note in `docs/spikes/`. Their purpose is to settle §2.4.

**S-01 · Runtime access and auth** — none
- Build: script that creates a session as the signed-in user, lists models, sends one prompt.
- Verify:
  - [ ] **(live)** `models.list` returns at least one model with `billing.tokenPrices`; the list is saved to `docs/spikes/S-01-models.json`.
  - [ ] **(live)** A prompt reaches `session.idle` and emits at least one `assistant.usage`.
  - [ ] A1 in §2.4 is marked confirmed or its fallback is recorded as a decision.

**S-02 · Hook enforcement and delegation** — S-01
- Build: session with a `bulk-reader` custom agent and an `onPreToolUse` that denies main-agent reads over 32 KB.
- Verify:
  - [ ] **(live)** Hook invocations for main-agent and sub-agent tool calls are distinguishable; the distinguishing field is recorded.
  - [ ] **(live)** Over 20 trials asking about a 200 KB fixture file, at least 19 end with the sub-agent reading the file and the main agent never receiving its content.
  - [ ] The built-in tool names and argument shapes for read, write, edit, search, and shell are recorded in `docs/spikes/S-02-tools.json`.
  - [ ] A2 and A3 are resolved and D-08 is confirmed or changed.

**S-03 · Per-agent model and attribution** — S-02
- Verify:
  - [ ] **(live)** `subagent.started.model` and the sub-agent's `assistant.usage.model` equal the worker model configured.
  - [ ] **(live)** Each `assistant.usage` can be assigned to exactly one agent; the method is recorded.
  - [ ] **(live)** A session with `maxAiCredits` set low is stopped by spending that occurs inside a sub-agent.
  - [ ] **(live)** Credits computed from tokens and `tokenPrices` match `getMetrics` within 1%.
  - [ ] A4 and A5 are resolved.

**S-04 · Multi-root access** — S-01
- Verify:
  - [ ] **(live)** A session rooted in repo A reads a file in repo B after host approval; the mechanism is recorded.
  - [ ] **(live)** A write to repo B is blocked by the hook, including via a shell command.
  - [ ] **(live)** Two sessions with different working directories run concurrently on one client without cross-talk.
  - [ ] A6 is resolved.

**S-05 · Packaging** — none
- Build: minimal `.app` containing a Node binary, a bundled "hello" engine, and the Copilot CLI.
- Verify:
  - [ ] `codesign --verify --deep --strict` passes and `spctl --assess --type execute` accepts the notarized app.
  - [ ] **(manual)** On a second macOS user account with no developer tools, the app launches and the engine answers a ping.
  - [ ] A7 is resolved.

**S-06 · MCP connectivity** — S-01
- Verify:
  - [ ] **(live)** GitHub, Datadog, ClickUp, and Snowflake each connect and list tools; the exact endpoint and auth method used are recorded, replacing the entries in §2.2.
  - [ ] **(live)** Tool-definition token cost per server is recorded from `contextInfo`.
  - [ ] A8 is resolved.

**S-07 · IPC throughput** — none
- Build: Node socket server emitting synthetic events; Swift command-line client decoding them.
- Verify:
  - [x] 50,000 events are received in order with none dropped at 20,000 events/s or better.
  - [x] p99 time from write to decoded value is under 5 ms.
  - [x] A9 is resolved.

**Gate G0:** every row in §2.4 is resolved and §3 reflects the outcomes. Phase 2 does not start before G0.

### Phase 1 — Foundation and engine core

**F-01 · Repository scaffold** — none
- Build: git repo, pnpm workspace with empty packages, strict tsconfig, eslint, vitest, Xcode project with empty local packages, `Makefile`, CI on a macOS runner.
- Verify:
  - [x] On a clean clone, `make verify` exits 0.
  - [x] CI runs `make verify-engine` on every pull request, and `make verify-app` on pull requests that touch app or protocol code, and they pass.

**F-02 · Architecture guardrails** — F-01
- Build: import rules for the engine (§4.3) and a package-graph check for the app.
- Verify:
  - [x] `make lint-arch` exits 0 on the repo.
  - [x] A fixture where `core` imports an adapter makes the rule checker exit non-zero (tested).
  - [x] A fixture where one Swift feature imports another fails the graph check (tested).

**F-03 · Verify runner** — F-01
- Build: `tools/verify/units.json` and the `make verify UNIT=` runner.
- Verify:
  - [x] `make verify UNIT=F-03` exits 0.
  - [x] An unknown unit ID exits non-zero with the ID in the message.
  - [x] A test fails if any unit in §12 has no entry in `units.json`.

**E-01 · Protocol package** — F-01
- Build: schemas for every RPC method, event type, and DTO; JSON Schema export; protocol version constant.
- Verify:
  - [x] Every method has a request and a response schema (enumeration test).
  - [x] The exported `protocol.schema.json` matches the committed file.
  - [x] Each event type has a valid and an invalid fixture, accepted and rejected respectively.

**E-02 · Swift code generation** — E-01
- Build: generator producing `PicaProtocol` Codable types from the JSON Schema.
- Verify:
  - [x] `make codegen && git diff --exit-code` is clean.
  - [x] Swift tests decode every file in `fixtures/protocol/` and re-encode to semantically equal JSON.
  - [x] An unknown event type decodes to an `unknown` case rather than failing.

**E-03 · Store** — F-01
- Build: SQLite schema and migrations; repositories for workspaces, repos, sessions, events, usage.
- Verify:
  - [x] Migrations apply from empty and from each earlier schema fixture.
  - [x] Property test: events read back in strictly increasing `seq` under concurrent appends.
  - [x] Killing the process mid-transaction leaves a database that opens and passes an integrity check.

**E-04 · Configuration** — E-01
- Build: layered JSONC loader, schema validation, managed locks, file watching.
- Verify:
  - [x] Table tests cover every precedence pair, including a locked key ignoring higher layers.
  - [x] An invalid file yields an error naming the file and key path.
  - [x] The published `config.schema.json` matches the committed file.

**E-05 · RPC server** — E-01
- Build: Unix socket listener, NDJSON framing, handshake, routing, notifications, backpressure.
- Verify:
  - [x] Conformance tests: malformed JSON, unknown method, invalid params, oversized frame each return the specified error.
  - [x] A client with a different major protocol version is refused.
  - [x] Two clients receive the same notifications in the same order.
  - [x] The socket file mode is 0600 inside a 0700 directory.
  - [x] Start to `engine.hello` reply is under 1.5 s (benchmark with threshold).

**E-06 · Runtime port and FakeRuntime** — E-01
- Build: `AgentRuntime` port (sessions, send, abort, events, models, quota, hooks) and a fake driven by scenario files that script text, tool calls, sub-agents, usage, and errors.
- Verify:
  - [x] Replaying a scenario twice produces byte-identical event logs.
  - [x] A shared contract suite passes against FakeRuntime.
  - [x] Scenario files validate against a schema; an invalid one fails with a line reference.

**E-07 · Event normalization and log** — E-03, E-06
- Build: mapping from runtime events to versioned `SessionEvent`s; append and subscribe.
- Verify:
  - [x] Golden tests: recorded runtime event fixtures map to expected Pica events.
  - [x] Property test: a subscriber starting at any `afterSeq` during concurrent appends sees every later event exactly once.
  - [x] An unmapped runtime event is logged as `runtime.unknown` and does not stop the stream.

**E-08 · Session service** — E-05, E-07
- Build: lifecycle state machine, send, steer, queue, abort, approval round trip, resume.
- Verify:
  - [x] Transition table tests accept every legal transition and reject every illegal one.
  - [x] Killing the engine during a FakeRuntime run and restarting leaves the session `resumable`, and resuming continues from the next event.
  - [x] An approval request is delivered to clients, and its resolution reaches the runtime exactly once.
  - [x] Abort during a tool call ends in `idle` with an `aborted` event.

**E-09 · Copilot adapter** — E-06
- Build: `AgentRuntime` over `@github/copilot-sdk`, version pinned, with error and auth-state mapping. A replay server in `testkit` emulates the runtime's JSON-RPC from recorded transcripts.
- Verify:
  - [x] The shared contract suite passes against the adapter connected to the replay server.
  - [x] Auth-missing, quota-exhausted, and model-unavailable transcripts map to their stable error codes.
  - [ ] **(live)** A smoke run completes one prompt end to end.

**E-10 · CLI** — E-08
- Build: `pica session new|send|attach|list`, `pica usage`, `--json` output.
- Verify:
  - [x] End-to-end tests against an engine with FakeRuntime compare stdout to golden files.
  - [x] `pica` starts an engine when none is running and reuses one that is.
  - [x] Non-zero exit codes are distinct for usage error, engine error, and session failure.

**Milestone M1 — headless slice:** **(live)** `pica session new --repo . "summarize the README"` completes against Copilot, and `pica usage` shows the tokens.

### Phase 2 — Cost router

**C-01 · Model catalog and tiers** — E-09
- Build: cached `models.list`, price table, tier resolution with `auto` and fallbacks, cost calculation.
- Verify:
  - [x] Tier resolution table tests, including a preferred model missing and a model blocked by managed policy.
  - [x] Credits computed for fixture usage (input, cached input, output) match expected values exactly.
  - [x] A stale cache is refreshed; a failed refresh keeps the previous catalog and raises a warning event.

**C-02 · Agent definitions** — E-04
- Build: `bulk-reader`, `code-writer`, `repo-scout` as Markdown files with frontmatter; loader merging built-in, user, workspace, repo, and `.github/agents`.
- Verify:
  - [x] Precedence tests across all layers.
  - [x] `bulk-reader` and `repo-scout` contain no write or shell tool (asserted against the S-02 tool list).
  - [x] Prompt snapshot tests; an agent with an unknown tool or tier fails validation with the field named.

**C-03 · Policy engine** — E-04
- Build: pure `decide()` with ordered rule groups and decision records.
- Verify:
  - [x] Table-driven suite of at least 60 cases covering each rule and each ordering boundary.
  - [x] 100% branch coverage of the policy module.
  - [x] Property test: no input makes a managed `deny` result in anything but `deny`.
  - [x] Benchmark: p99 decision time under 1 ms.

**C-04 · Read delegation gate** — C-03, E-08
- Build: large-read rule wired into `onPreToolUse`, with range exemption and per-path exclusions.
- Verify:
  - [x] FakeRuntime: a main-agent read of a 200 KB file is denied with a reason naming `bulk-reader`.
  - [x] The same read from a sub-agent is allowed.
  - [x] A 10 KB read and a 300-line ranged read of the large file are allowed.
  - [x] Changing `read.minBytes` in workspace config changes the outcome without restarting the session.

**C-05 · Routing profiles** — C-02, C-03
- Build: `off`, `balanced`, `strict` mapped to per-agent tool visibility and the delegation guide text.
- Verify:
  - [x] Session-config snapshot per profile.
  - [x] In `strict`, the main agent's tool list contains no write tool; in `balanced`, no create-file tool; in `off`, no cost gate fires in any C-03 case.
  - [x] The delegation guide for a profile is byte-identical across sessions.

**C-06 · Output guard** — C-03, E-08
- Build: `onPostToolUse` truncation with spill to a session artifact and a pointer line.
- Verify:
  - [x] Golden tests for head and tail truncation on text, JSON, and binary-looking output.
  - [x] The spilled artifact is byte-equal to the original result.
  - [x] Fuzz test: the returned result never exceeds the cap.

**C-07 · Delegator** — C-02, C-05, G0
- Build: the `Delegator` port and the implementation chosen by D-08.
- Verify:
  - [ ] FakeRuntime: a delegation produces child events nested under the parent's tool call.
  - [ ] A failing child emits a failure event and the parent run continues.
  - [ ] The child runs with exactly the tools in its agent definition.
  - [ ] **(live)** A `bulk-reader` delegation runs on the worker-tier model.

**C-08 · Usage ledger** — E-07, C-01
- Build: `UsageRecord` persistence, rollups, savings estimate.
- Verify:
  - [x] Ledger totals equal fixture totals for a multi-agent scenario.
  - [x] Rollup queries by session, agent, model, workspace, and day return expected rows.
  - [x] Savings estimate matches a hand-computed fixture.

**C-09 · Budgets** — C-08
- Build: session credit limit passed to the runtime, workspace daily cap in the engine, warning thresholds, exhausted flow as an approval.
- Verify:
  - [x] FakeRuntime: crossing the session budget blocks the next model call and emits `budget.exhausted`.
  - [x] Raising the budget through the approval resumes the run.
  - [x] The workspace daily cap blocks a new session and reports the reset time.

**C-10 · Eval harness** — C-04, C-05, C-06, C-07, C-08
- Build: at least 12 tasks over fixture repos (large-file questions, test scaffolding, config generation, multi-file mechanical edits), each with a programmatic success check; a runner that executes the suite per profile and writes a JSON and Markdown report.
- Verify:
  - [ ] Against FakeRuntime the harness produces exactly the expected report.
  - [ ] Each task's success check passes on a reference solution and fails on an empty one.
  - [ ] **(live)** On the suite, `balanced` uses at least 60% fewer reasoning-tier input tokens than `off`, with at most one fewer task succeeding. The report is committed to `docs/evals/`.
  - [ ] Default thresholds in §4.6 are updated from the report, with the change recorded in §3.

**Milestone M2 — measured savings:** the C-10 live report exists and meets its target, or the gap is explained and the thresholds are retuned.

### Phase 3 — Repositories and workspaces

**R-01 · Git service** — F-01
- Build: status, diff, branches, log, commit, push through the `git` CLI with machine-readable output.
- Verify:
  - [x] Parser golden tests for status and diff output, including renames, binary files, and submodules.
  - [x] Integration tests against temporary repos built by a fixture script.

**R-02 · Worktrees** — R-01
- Build: create, list, remove; branch naming `pica/<slug>`; cleanup report.
- Verify:
  - [x] Edits in one worktree are not visible in another.
  - [x] Removing a dirty worktree is refused without `force`.
  - [x] The cleanup report for a fixture lists age, merged state, and dirty state correctly.

**R-03 · Repo registry** — E-03, R-01
- Build: add by path, add by URL (partial clone into the managed directory), remove.
- Verify:
  - [x] Two paths with the same normalized remote resolve to one `Repo`.
  - [x] Removing an unmanaged repo never touches the filesystem.
  - [x] Removing a managed clone with uncommitted or unpushed work is refused without `force`.

**R-04 · GitHub auth** — E-05
- Build: provider chain (`gh` credentials, device flow, PAT from the secret broker), host configuration for github.com and GitHub Enterprise.
- Verify:
  - [x] Stub-server tests for each provider and for fall-through order.
  - [x] A SAML SSO 403 maps to an error whose `fix` is the authorization URL.
  - [x] Missing `read:org` maps to a scope error naming the scope.

**R-05 · Team discovery** — R-04
- Build: list orgs and teams, team repos, topic and custom-property selectors, sync with diff.
- Verify:
  - [x] A stub with 250 repos across 3 pages is fully discovered.
  - [x] A 304 response makes no changes and issues no further requests.
  - [x] Archived repos and forks are excluded or included per setting.
  - [x] Sync diff reports added and removed repos exactly.

**R-06 · Workspace model** — R-03, R-05
- Build: workspace CRUD, sources, pinned repos, lazy clone state, settings overrides.
- Verify:
  - [ ] A team source adds repos as `available`, not cloned.
  - [ ] Removing a source keeps pinned repos.
  - [ ] Workspace overrides resolve through E-04 precedence.

**R-07 · Session scope and sandbox** — C-03, R-02
- Build: write roots and reference roots on the session; path resolution guard; safety rules.
- Verify:
  - [x] Policy cases: write to a reference root is denied; a symlink or `..` escaping every root is denied.
  - [x] A shell command whose working directory or redirect target is outside the write roots yields `ask` or `deny` per permission mode.
  - [x] Fuzzed paths never resolve outside the roots while being allowed.

**R-08 · Cross-repo tools** — R-06, R-07
- Build: `repo_search`, `repo_read`, `repo_list` as engine tools; `@repo:path` mention parsing.
- Verify:
  - [ ] On a three-repo fixture, search returns `repo:path:line` hits in a deterministic order within the result cap.
  - [ ] `repo_read` refuses paths outside workspace repos.
  - [ ] Mention parser table tests, including ambiguous and missing repos.

**R-09 · Repo cards** — R-03
- Build: model-free summary cached by HEAD commit.
- Verify:
  - [x] Golden cards for fixture repos in four ecosystems.
  - [x] The cache is reused on the same commit and rebuilt on a new one.
  - [x] A card never exceeds its size cap.

**R-10 · Multi-repo change sets** — R-02, R-07
- Build: one session with worktrees in several repos on one branch name; per-repo diffs; linked pull requests.
- Verify:
  - [ ] A two-repo change set creates two worktrees and two branches with the same name.
  - [ ] Against a stub API, both pull requests are created and each body links the other.
  - [ ] A failure creating the second pull request reports partial state without rolling back the first.

**R-11 · Fan-out runs** — R-06, E-08
- Build: one task as parallel sessions over selected repos with a concurrency cap and an aggregate view.
- Verify:
  - [ ] FakeRuntime: with 6 repos and a cap of 3, no more than 3 sessions run at once.
  - [ ] One failing session does not cancel the others; the aggregate reports each result.
  - [ ] Cancelling the fan-out aborts every running session.

**Milestone M3 — multi-repo slice:** **(live)** from the CLI, import a GitHub team, start a session in one repo that answers a question about code in another, and see the lookup attributed to `repo-scout` on the worker tier.

### Phase 4 — MCP

**M-01 · Registry and configuration** — E-04
- Build: server definitions at global, workspace, and repo scope; import from `.vscode/mcp.json`, `.mcp.json`, and Copilot config.
- Verify:
  - [x] Merge precedence tests.
  - [x] Import golden tests for each source format.
  - [x] A definition with an inline secret is rejected with a message pointing to secret references.

**M-02 · Presets** — M-01, S-06
- Build: parameterized presets for GitHub, Datadog, ClickUp, Snowflake.
- Verify:
  - [ ] Each preset renders the expected definition for sample parameters, using the endpoints recorded by S-06.
  - [ ] Missing or malformed parameters fail validation with the parameter named.

**M-03 · Secrets and OAuth** — M-01, E-05
- Build: secret references resolved through the client broker or environment; OAuth login orchestration.
- Verify:
  - [x] Fuzz test: a secret value never appears in any event, log line, or database row.
  - [x] An unresolved reference yields an error whose `fix` opens the right settings pane.
  - [x] Token refresh failure moves the server to `needs_auth` without ending the session.

**M-04 · Scoping and tool budgets** — M-01, C-02
- Build: per-session and per-agent attachment, per-server tool allowlists, tool-definition token estimates.
- Verify:
  - [x] Session-config snapshot: a server scoped to one agent appears only on that agent.
  - [x] A session with no servers attached carries no MCP tool definitions.
  - [x] Token estimates for fixture tool lists match expected values.

**M-05 · MCP permissions** — C-03, M-04
- Build: per-tool allow, ask, deny; write-class tools default to ask; managed allowlist.
- Verify:
  - [x] Policy cases for each outcome.
  - [x] A server absent from the managed allowlist cannot be attached, and the error names the policy.

**M-06 · Health and diagnostics** — M-04
- Build: connection status, last error, tool list, latency.
- Verify:
  - [x] Stub servers that are healthy, slow, crashing, and failing auth each produce the expected status.
  - [x] A crashing stdio server is restarted with backoff and gives up after the configured attempts.

### Phase 5 — macOS app

Units A-02 and A-03 can start as soon as E-02 is done and run in parallel with Phases 2–4, because every app unit is tested against an engine using FakeRuntime.

**A-01 · App shell and engine supervision** — E-05, S-05
- Build: launch and supervise `picad`, handshake, restart with backoff, single instance.
- Verify:
  - [ ] Killing the engine shows a reconnecting state and recovers within 2 s.
  - [ ] A protocol major mismatch shows a blocking error naming both versions.
  - [ ] Cold launch to interactive window is under 1.0 s (performance test with baseline).

**A-02 · EngineClient** — E-02
- Build: actor with typed requests and event streams as `AsyncSequence`, resuming from the last `seq`.
- Verify:
  - [x] Against a scripted socket server, reconnect resumes at `seq + 1` with no duplicate.
  - [x] Request timeout and task cancellation behave as specified.
  - [x] Engine-initiated `secrets.*` requests are answered from the Keychain broker.

**A-03 · Design system** — F-01
- Build: tokens for color, type, spacing, radius, motion; core components; brand assets derived from the logo.
- Verify:
  - [x] Snapshot tests of the component gallery in light, dark, and increased contrast.
  - [x] `performAccessibilityAudit` passes on the gallery. Contrast issues on labels beside sample graphics are skipped: at 1x the audit's pixel sampling flags them whatever their color, size, or weight; `ContrastTests` checks those colors numerically.
  - [x] Reduced-motion setting disables the spark animation (tested).

**A-04 · Navigation shell** — A-01, A-02, A-03
- Build: three-column layout, sidebar of workspaces, repos, and sessions, toolbar, window restoration.
- Verify:
  - [ ] UI test: a workspace created through the engine appears in the sidebar.
  - [ ] Selection and column widths are restored after relaunch.
  - [ ] Every sidebar item is reachable and activatable by keyboard alone.

**A-05 · Session timeline** — A-04
- Build: virtualized timeline, streaming Markdown, tool rows, sub-agent groups, policy rows.
- Verify:
  - [ ] Snapshot test for each event type.
  - [ ] A 10,000-event fixture opens in under 300 ms.
  - [ ] Scroll hitch time ratio under 1% on that fixture.
  - [ ] Streaming appends do not move the scroll position when the user has scrolled up.

**A-06 · Composer** — A-05
- Build: multiline input, `@` mentions for repos, files, and agents, `/` for skills, profile and tier pickers, steer and queue while running.
- Verify:
  - [ ] Mention tokenizer table tests.
  - [ ] UI tests: `@` opens completions and Return inserts; ⌘↩ sends; sending while running queues.
  - [ ] Keystroke to glyph under 16 ms with a 10,000-event session open.

**A-07 · Approvals** — A-05
- Build: inline approval cards, system notification, allow once, always, deny.
- Verify:
  - [ ] UI test over a FakeRuntime scenario resolves each choice correctly.
  - [ ] "Always allow" writes a permission rule to config and suppresses the next identical request.

**A-08 · Review** — A-04, R-01
- Build: changed-file list, unified and split diff with syntax highlighting, stage and discard by hunk, commit, push, open pull request.
- Verify:
  - [ ] Diff snapshot tests against fixtures, including renames and binary files.
  - [ ] UI test: stage a hunk, commit, and confirm the commit in a temporary repo.
  - [ ] A 5,000-line diff renders in under 200 ms.

**A-09 · Files and quick open** — A-04, R-08
- Build: file tree, ⌘P across workspace repos, read-only viewer, open in external editor.
- Verify:
  - [ ] Fuzzy ranking table tests.
  - [ ] A query over a 100,000-file index returns in under 50 ms.

**A-10 · Terminal** — A-04, R-02
- Build: terminal panel bound to the session's worktree.
- Verify:
  - [ ] UI test: a command's output appears and its working directory is the worktree.
  - [ ] Closing the panel ends the shell process.

**A-11 · Usage and cost** — A-05, C-08, C-09
- Build: session chip for context, tokens, and credits; dashboard by model, agent, workspace, and day; savings estimate; budget warnings.
- Verify:
  - [ ] View-model tests from ledger fixtures.
  - [ ] Chart snapshot tests.
  - [ ] The savings figure is always labeled as an estimate (asserted in the snapshot).

**A-12 · Workspace and repo management** — A-04, R-06
- Build: add repo by path or URL, team browser with search and multi-select, sync status.
- Verify:
  - [ ] UI test against the stub GitHub server imports a team and shows its repos as available.
  - [ ] Auth errors display their `fix` action.

**A-13 · MCP management** — A-04, M-06
- Build: catalog of presets, add and edit, authenticate, attach per workspace and session, token-cost column, health.
- Verify:
  - [ ] UI test adds a preset and sees it healthy against a stub server.
  - [ ] A saved secret is never rendered back into a field.
  - [ ] Changing servers on a running session shows the cache-invalidation warning first.

**A-14 · Settings and command palette** — A-04, E-04
- Build: Settings scene editing the config files; ⌘K palette over an action registry; keybinding editor.
- Verify:
  - [ ] A test enumerates the action registry and finds every action in the palette.
  - [ ] A rebound shortcut persists and triggers its action.
  - [ ] A managed-locked setting is shown disabled with the policy named.

**A-15 · Onboarding** — A-12, A-13
- Build: precondition checks (Copilot login, git, GitHub auth), first workspace.
- Verify:
  - [ ] UI test: each failing precondition shows a fix action, and passing it advances.

**A-16 · Session overview** — A-05, R-11
- Build: board of all sessions with status and an attention queue; fan-out aggregate view.
- Verify:
  - [ ] UI test: sessions awaiting approval appear first.
  - [ ] Twenty live FakeRuntime sessions keep the board under the idle CPU budget when nothing changes.

**Milestone M4 — daily driver:** **(manual)** complete one real task end to end in the app: import a team, start a session, approve a tool call, review the diff, commit, open a pull request, and read the session's cost.

### Phase 6 — Customization and enterprise hardening

**X-01 · Themes and density** — A-03, A-14
- Verify:
  - [ ] Snapshot tests for each density and for a custom accent.
  - [ ] A theme file with an unknown token fails validation with the token named.

**X-02 · Agents, skills, and rules management** — C-02, A-14
- Build: discovery and editing UI for custom agents, skills, and instruction files from all layers.
- Verify:
  - [ ] An agent created in the UI is written as a file that the C-02 loader accepts.
  - [ ] The UI shows which layer each item comes from and which one wins.

**X-03 · User hooks** — C-03
- Build: command hooks run by the engine on Pica events (session start and end, before commit), with timeouts.
- Verify:
  - [ ] A hook exiting non-zero before commit blocks the commit and surfaces its output.
  - [ ] A hook exceeding its timeout is killed and reported.
  - [ ] A user hook cannot change a managed policy outcome (policy case).

**H-01 · Managed policy** — E-04, C-03, M-05
- Build: organization policy from a managed preferences domain or a root-owned file: model allowlist, MCP allowlist, budget ceilings, permission-mode floor.
- Verify:
  - [ ] Each lockable key has a test where user config is ignored.
  - [ ] A policy file not owned by root is ignored with a warning.

**H-02 · Audit log** — C-03, E-07
- Build: append-only JSONL of tool calls, approvals, and policy decisions with a hash chain; export.
- Verify:
  - [x] Altering any line makes verification fail at that line.
  - [x] Every policy decision in a scenario appears exactly once.

**H-03 · Redaction** — M-03
- Build: scrubber for logs, events, and diagnostics.
- Verify:
  - [ ] A corpus of token formats is fully redacted.
  - [ ] The diagnostics bundle for a fixture session contains no file contents and no secrets.

**H-04 · Observability** — E-05
- Build: structured engine logs, diagnostics bundle, optional OpenTelemetry export of usage metrics.
- Verify:
  - [ ] With export disabled, the engine opens no outbound connection other than the runtime's (asserted with a network stub).
  - [ ] Exported metrics for a fixture match the ledger.

**H-05 · Reliability** — E-08, A-01
- Verify:
  - [ ] Corrupt-database fixture: the engine moves it aside, starts clean, and reports the backup path.
  - [ ] Disk-full simulation during event append fails the session with a stable error and leaves the log readable.
  - [ ] One hundred consecutive kill-and-resume cycles lose no event.

**H-06 · Distribution** — S-05, A-01
- Build: Developer ID signing, hardened runtime, notarization, Sparkle updates, release workflow.
- Verify:
  - [ ] The release workflow produces an artifact that `spctl` accepts.
  - [ ] An update from version N to N+1 through a local appcast succeeds and the engine version matches the app.
  - [ ] An appcast entry with a bad signature is refused.

**H-07 · Performance gate** — all A units
- Verify:
  - [ ] Every row in §9 has a test with a threshold, and all pass in CI on the reference runner.

**H-08 · Documentation** — M4
- Build: user guide, administrator guide (managed policy, MCP allowlists, budgets), architecture notes.
- Verify:
  - [ ] Link check passes.
  - [ ] Every config key in the schema appears in the reference (generated, drift-checked).

**Milestone M5 — beta:** all units done, C-10 report current, and a signed build installed on a second team member's Mac.

---

## 11. Risks and open questions

### 11.1 Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Org policy blocks the Copilot CLI/SDK or the cheap models | No product | S-01 runs first; BYOK fallback; admin ask is small and specific |
| SDK or runtime changes break the adapter | Sessions fail after an update | Version pinned; replay-server contract tests; update only through a PR that re-records transcripts |
| Delegation latency (10–30 s) annoys users on mid-sized files | Profile gets turned off | Threshold tuned by C-10; range exemption; per-workspace override; timeline shows why a redirect happened |
| Worker model gives wrong answers about large files | Bad decisions by the main agent | Citations required; main agent can do ranged reads to check; eval suite tracks success, not just tokens |
| Denied reads make the main agent loop | Wasted reasoning tokens | S-02 measures it; fallback is the explicit `delegate` tool; a repeat-deny counter escalates to the user |
| MCP tool definitions bloat the context | Higher cost on every turn | Attach on demand; per-server allowlists; token cost shown before attaching |
| Notarizing bundled Node and CLI binaries fails | Cannot ship a single app | S-05 early; separate engine install as fallback |
| Two processes mean two places for bugs | Debugging cost | Engine-only reproduction through `pica`; event log is the shared truth |
| GitHub team discovery blocked by SSO or app approval | Team import unavailable | Auth chain with three providers; manual add always works |

### 11.2 Open questions for the project owner

| ID | Question | Needed by |
|---|---|---|
| Q-01 | Copilot Business or Enterprise, and which models does org policy allow? | S-01 |
| Q-02 | GitHub.com, GitHub Enterprise Cloud with data residency, or GitHub Enterprise Server? | R-04 |
| Q-03 | ~~Can the minimum be raised above macOS 15 across the fleet?~~ Answered 2026-11-13: yes, to macOS 26 (D-13) | A-03 |
| Q-04 | Is an Apple Developer ID available for signing, and will distribution go through MDM? | S-05, H-06 |
| Q-05 | Can the org register a GitHub App or OAuth App for team discovery, or must Pica rely on `gh` and PATs? | R-04 |
| Q-06 | Is the Snowflake MCP server already created by an admin, and with which auth? | S-06 |
| Q-07 | Is this for one team or the whole engineering org? This sets the priority of H-01 and H-04. | Phase 6 |

---

## 12. Unit index

Status values: `todo`, `doing`, `done`, `blocked`.

| ID | Unit | Depends on | Status |
|---|---|---|---|
| S-01 | Runtime access and auth | — | todo |
| S-02 | Hook enforcement and delegation | S-01 | todo |
| S-03 | Per-agent model and attribution | S-02 | todo |
| S-04 | Multi-root access | S-01 | todo |
| S-05 | Packaging | — | todo |
| S-06 | MCP connectivity | S-01 | todo |
| S-07 | IPC throughput | — | done |
| F-01 | Repository scaffold | — | done |
| F-02 | Architecture guardrails | F-01 | done |
| F-03 | Verify runner | F-01 | done |
| E-01 | Protocol package | F-01 | done |
| E-02 | Swift code generation | E-01 | done |
| E-03 | Store | F-01 | done |
| E-04 | Configuration | E-01 | done |
| E-05 | RPC server | E-01 | done |
| E-06 | Runtime port and FakeRuntime | E-01 | done |
| E-07 | Event normalization and log | E-03, E-06 | done |
| E-08 | Session service | E-05, E-07 | done |
| E-09 | Copilot adapter | E-06 | done |
| E-10 | CLI | E-08 | done |
| C-01 | Model catalog and tiers | E-09 | done |
| C-02 | Agent definitions | E-04 | done |
| C-03 | Policy engine | E-04 | done |
| C-04 | Read delegation gate | C-03, E-08 | done |
| C-05 | Routing profiles | C-02, C-03 | done |
| C-06 | Output guard | C-03, E-08 | done |
| C-07 | Delegator | C-02, C-05, G0 | todo |
| C-08 | Usage ledger | E-07, C-01 | done |
| C-09 | Budgets | C-08 | done |
| C-10 | Eval harness | C-04, C-05, C-06, C-07, C-08 | todo |
| R-01 | Git service | F-01 | done |
| R-02 | Worktrees | R-01 | done |
| R-03 | Repo registry | E-03, R-01 | done |
| R-04 | GitHub auth | E-05 | done |
| R-05 | Team discovery | R-04 | done |
| R-06 | Workspace model | R-03, R-05 | todo |
| R-07 | Session scope and sandbox | C-03, R-02 | done |
| R-08 | Cross-repo tools | R-06, R-07 | todo |
| R-09 | Repo cards | R-03 | done |
| R-10 | Multi-repo change sets | R-02, R-07 | todo |
| R-11 | Fan-out runs | R-06, E-08 | todo |
| M-01 | MCP registry and configuration | E-04 | done |
| M-02 | MCP presets | M-01, S-06 | todo |
| M-03 | Secrets and OAuth | M-01, E-05 | done |
| M-04 | Scoping and tool budgets | M-01, C-02 | done |
| M-05 | MCP permissions | C-03, M-04 | done |
| M-06 | Health and diagnostics | M-04 | done |
| A-01 | App shell and engine supervision | E-05, S-05 | todo |
| A-02 | EngineClient | E-02 | done |
| A-03 | Design system | F-01 | done |
| A-04 | Navigation shell | A-01, A-02, A-03 | todo |
| A-05 | Session timeline | A-04 | todo |
| A-06 | Composer | A-05 | todo |
| A-07 | Approvals | A-05 | todo |
| A-08 | Review | A-04, R-01 | todo |
| A-09 | Files and quick open | A-04, R-08 | todo |
| A-10 | Terminal | A-04, R-02 | todo |
| A-11 | Usage and cost | A-05, C-08, C-09 | todo |
| A-12 | Workspace and repo management | A-04, R-06 | todo |
| A-13 | MCP management | A-04, M-06 | todo |
| A-14 | Settings and command palette | A-04, E-04 | todo |
| A-15 | Onboarding | A-12, A-13 | todo |
| A-16 | Session overview | A-05, R-11 | todo |
| X-01 | Themes and density | A-03, A-14 | todo |
| X-02 | Agents, skills, and rules management | C-02, A-14 | todo |
| X-03 | User hooks | C-03 | todo |
| H-01 | Managed policy | E-04, C-03, M-05 | todo |
| H-02 | Audit log | C-03, E-07 | done |
| H-03 | Redaction | M-03 | todo |
| H-04 | Observability | E-05 | todo |
| H-05 | Reliability | E-08, A-01 | todo |
| H-06 | Distribution | S-05, A-01 | todo |
| H-07 | Performance gate | all A units | todo |
| H-08 | Documentation | M4 | todo |

### 12.1 Suggested order

1. **Phase 0** spikes, with F-01 to F-03 alongside. S-01 first; S-05 and S-07 need nothing and can run any time.
2. **Engine core** E-01 → E-10 to reach M1.
3. Three tracks in parallel once E-08 is done:
   - Cost router (C units) to M2.
   - Repositories (R units) to M3.
   - App foundation (A-01 to A-05) against FakeRuntime.
4. MCP (M units), then the remaining app units to M4.
5. Phase 6 to M5.

---

## 13. Sources

1. Xirp overview — https://backstage.spotify.com/docs/xirp
2. Xirp projects — https://backstage.spotify.com/docs/xirp/projects
3. Copilot SDK features — https://docs.github.com/en/copilot/how-tos/copilot-sdk/features
4. Copilot SDK repository — https://github.com/github/copilot-sdk
5. Custom agents and sub-agent orchestration — https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/custom-agents
6. Working with hooks (SDK) — https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/hooks
7. Copilot CLI hooks reference — https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference
8. Usage and billing metrics — https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing
9. Session limits — https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/session-limits
10. Session resume and persistence — https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/session-persistence
11. Using MCP servers — https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/mcp
12. Copilot is moving to usage-based billing — https://github.blog/changelog/2026/04/27/github-copilot-is-moving-to-usage-based-billing/
13. Snowflake-managed MCP server — https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-mcp
