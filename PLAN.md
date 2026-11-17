# Pica — Development Plan

Source of truth for building Pica. Every unit of work below has an ID, explicit dependencies, and verification checks that pass or fail without judgment. A unit is done only when all of its checks pass.

- Created: 2026-11-12
- Status: planning complete, no code written
- How to update: tick checks as they pass, set the unit's status in the [unit index](#12-unit-index), and record any changed decision in [Decisions](#3-decisions) with a date. Do not silently diverge from this file.

---

## 1. Product

### 1.1 What Pica is

Pica is a native macOS app for running coding agents on your codebases through GitHub Copilot. It is for anyone with a Copilot plan: an individual, a team, or a company of any size (D-19). It has three jobs:

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
- Hosting or proxying models. Inference goes through the signed-in user's Copilot entitlement.
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
- **Hooks.** SDK callbacks `onPreToolUse` (returns `permissionDecision` allow/deny/ask and a reason), `onPostToolUse` (returns `modifiedResult`), `onUserPromptSubmitted`, `onSessionStart` (returns `additionalContext`), `onSessionEnd`, `onErrorOccurred` [6]. The CLI hooks reference says hooks firing inside a sub-agent carry `agentId`, `agentType`, `parentAgentId` [7]. S-02 confirmed the SDK callbacks receive them: a sub-agent's tool calls carry `agentId`, `agentType` (the custom agent's name) and `parentAgentId`, and main-agent calls carry none ([findings](docs/spikes/S-02.md)).
- **Usage.** `assistant.usage` fires per model call including sub-agent calls, with `model`, `inputTokens`, `outputTokens`. `session.usage_info` gives `currentTokens`/`tokenLimit`. `session.usage.getMetrics` returns totals and per-model metrics. `models.list` returns `billing.tokenPrices`. `session.metadata.contextInfo` breaks context into system, conversation, and tool-definition tokens [8].
- **Budgets.** `sessionLimits.maxAiCredits` is a soft cap checked after each model call; exhaustion raises `session_limits_exhausted.requested` and blocks the next call until answered [9]. S-03 found that `session.create` refuses any value below 30 AI credits ("Minimum session limit is 30 AI credits"), so a lower session budget has to be enforced by the engine ([findings](docs/spikes/S-03.md)).
- **Sessions.** Persisted under `~/.copilot/session-state/{sessionId}/`; resumable by ID with `workingDirectory`; no built-in session locking [10].
- **MCP.** Per-session `mcpServers` with local (`command`, `args`, `env`, `cwd`) and remote (`type: http|sse`, `url`, `headers`, OAuth fields) entries. `tools` is the only filter. The runtime can own the OAuth loopback flow, or the host can supply tokens [11].
- **Billing.** Since 2026-06-01 Copilot bills by tokens as GitHub AI Credits (1 credit = $0.01) at each model's listed rates for input, cached input, and output. Business includes $19 and Enterprise $39 of credits per seat per month, pooled across the organization, with admin budgets at enterprise, cost-center, and user level. There is no fallback to a cheaper model when credits run out [12].

The billing change is why this project pays off: token-heavy, low-reasoning work on a frontier model now costs the organization real money per token, and cached-input pricing rewards a stable prompt prefix.

### 2.2 MCP servers: optional, with presets

Pica works with no MCP server attached. Servers are optional extensions a user enables when they have them or want them (D-18). The four below get presets (M-02) because S-06 or the owner's org has used them; they are examples, not requirements. Any other server is added by hand, by pasting a standard `mcpServers` entry, or by importing the servers a user already runs in another agent platform (M-01, M-07).

| Server | Transport | Endpoint | Auth | Notes |
|---|---|---|---|---|
| GitHub | Remote HTTP | `https://api.githubcopilot.com/mcp/` | The Copilot sign-in, which the runtime attaches itself (no header); or a PAT as `Authorization: Bearer` | **Connected** in S-06: 46 tools, 13,835 tool-definition tokens ([findings](docs/spikes/S-06.md)). |
| Datadog | Remote HTTP | `https://mcp.<site>/api/unstable/mcp-server/mcp` (US1: `mcp.datadoghq.com`) | OAuth (DCR, PKCE, scope `mcp_all`), or `DD-API-KEY` + `DD-APPLICATION-KEY` headers | S-06 reached the consent step on US1; connecting waits on the owner. |
| ClickUp | Remote HTTP | `https://mcp.clickup.com/mcp` | OAuth only (DCR, PKCE, scopes `read`, `write`) | S-06 reached the consent step; connecting waits on the owner. |
| Snowflake | Remote HTTP | `https://<account_url>/api/v2/databases/{db}/schemas/{schema}/mcp-servers/{name}` | **PAT** in the owner's org (Q-06); Snowflake OAuth and external OAuth also exist | Admin creates the server with `CREATE MCP SERVER`. Tools only, max 50, SQL read-only by default, no dynamic client registration [13]. |

### 2.3 GitHub repository discovery

REST endpoints: `GET /user/teams`, `GET /orgs/{org}/teams/{team_slug}/repos` (paginated), repository topics, and organization custom properties. Listing teams needs the `read:org` scope and SSO authorization in SAML-enforced orgs. The Copilot token is not assumed to carry these scopes, so discovery uses its own auth chain (R-04).

### 2.4 Assumptions to settle in Phase 0

| # | Assumption | Spike | If false |
|---|---|---|---|
| A1 | The signed-in user's Copilot plan (any of Free, Pro, Pro+, Business, Enterprise) permits CLI/SDK use and returns a model list; token prices may be absent on some plans (D-16). **Confirmed** for Free by S-01: sign-in works, `models.list` offers only the virtual `auto` model with no prices, and a prompt on the default routes to a concrete model and reports usage in nano-AIU. Business was not tested: it cannot be signed in from the development Mac ([findings](docs/spikes/S-01.md)) | S-01 | Ask the org admin to enable it; BYOK as a stopgap |
| A2 | SDK `onPreToolUse` fires for sub-agent tool calls and identifies the calling agent. **Confirmed** by S-02: sub-agent calls carry `agentId` (equal to the `subagent.started` envelope `agentId`), `agentType` and `parentAgentId`; main-agent calls have no `agentId` ([findings](docs/spikes/S-02.md)) | S-02 | Delegate through engine-managed child sessions, where identity is known by construction |
| A3 | A deny with a reason reliably makes the main agent delegate. **Confirmed** by S-02 on Copilot Free (`auto`): 20 of 20 trials on a 219 KB file ended with `bulk-reader` reading it and no file content reaching the main agent, each after a single deny ([findings](docs/spikes/S-02.md)) | S-02 | Expose an engine `delegate` tool and remove the direct large-read path from the main agent |
| A4 | A sub-agent's `model` override is honored and billed at that model's rate. **Not confirmed** on Copilot Free, a default-model-only plan, by S-03: with `model: "claude-haiku-4.5"`, `subagent.started.model` reports the override, but every sub-agent `assistant.usage.model` is the `auto` pick, with no error, and `modelPolicy: "required"` is ignored the same way. The fallback is the decision for default-model-only plans: Pica does not rely on the `customAgents` `model`; there the only model is `auto`, so the worker gets no model, and Pica shows the model `assistant.usage` reports. Plans that list models are untested; re-run S-03 on one, and use engine-managed child sessions there if the override is still ignored ([findings](docs/spikes/S-03.md)) | S-03 | Engine-managed child sessions with an explicit model |
| A5 | Usage can be attributed per agent. **Confirmed** on Copilot Free by S-03: every `assistant.usage` from a sub-agent carries that sub-agent's envelope `agentId` (the `subagent.started` envelope id), and the main agent's carry none. The per-agent sums equal `getMetrics.agentMetrics`, which is keyed the same way, and Pica's adapter and normalizer name the right agent for every call. With no token prices, credits come from `copilotUsage.totalNanoAiu` and match `getMetrics` exactly ([findings](docs/spikes/S-03.md)) | S-03 | Attribute by `toolCallId` window, or by child session |
| A6 | A session can read outside its `workingDirectory` once the host approves. **Confirmed** by S-04: the runtime raises a `read` permission request for the path and reads it on `approve-once`; `additionalDirectories` halves the requests but does not remove them. A `preToolUse` deny blocks file-tool and shell writes to a reference root, and R-07's shell parser, which first missed argument writes such as `touch` and `cp`, now checks path arguments too ([findings](docs/spikes/S-04.md)) | S-04 | Session root directory of symlinks, or cross-repo access only through engine tools |
| A7 | Node, the engine bundle, and the Copilot CLI can be ad-hoc signed inside the app and run on a Mac without developer tools after a GitHub Releases download; Developer ID signing and notarization come later (D-17). **Confirmed** by S-05, with a different install path: the ad-hoc, hardened-runtime bundle passes `--deep --strict`, survives zip/unzip, and runs once installed without quarantine. On macOS 27 a quarantined ad-hoc app offers no "Open Anyway", so the quarantine is cleared before the first launch: an install script (curl, sha256, signature check) or a documented `xattr -dr com.apple.quarantine` step. `copilot-runtime` needs `disable-library-validation` when re-signed ad-hoc. The owner ran the second-device check on 2026-11-15 and it passed ([findings](docs/spikes/S-05.md)) | S-05 | Install the engine separately (pkg or Homebrew) |
| A8 | MCP servers connect through the SDK, including OAuth. **Confirmed** by S-06 for what Pica needs: GitHub connects with no prompt, and the runtime runs OAuth for Datadog and ClickUp up to consent and also accepts host-supplied tokens. The owner reports Datadog and ClickUp (browser OAuth) and Snowflake (PAT) working on the org's Macs through another client that uses them the same way; Pica has not connected them itself. Since every server is optional (D-18), none of the three gates Pica ([findings](docs/spikes/S-06.md)) | S-06 | Host-managed tokens supplied by Pica |
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
| D-08 | Delegation uses runtime-native `customAgents` if S-02/S-03 pass, otherwise engine-managed child sessions; both sit behind one `Delegator` port. S-02 passed: hooks identify the sub-agent and a deny makes the main agent delegate through `task`, so enforcement keeps `customAgents`. S-03 found the per-agent `model` is not honored on Free, even with `modelPolicy: "required"`. Pica keeps `customAgents` and does not rely on its `model`: on default-model-only plans the worker runs on `auto` and Pica shows the billed model. On a plan that lists models, if S-03's re-run still finds the override ignored, the `Delegator` runs the worker as an engine-managed child session with an explicit model ([S-02](docs/spikes/S-02.md), [S-03](docs/spikes/S-03.md)) | Keeps the fallback cheap | 2026-11-14 |
| D-09 | Model IDs are never hard-coded; tiers resolve against `models.list` | Model availability is set by org policy and changes often | 2026-11-12 |
| D-10 | Secrets live in the macOS Keychain, brokered by the app; the engine holds references only. CLI mode reads environment variables | Keychain items scoped to the signed app; nothing sensitive in config or the database | 2026-11-12 |
| D-11 | Config is layered JSONC with a published JSON Schema | Matches the MCP and Copilot config ecosystem; editor validation for free | 2026-11-12 |
| D-12 | No App Sandbox; hardened runtime; distribution outside the Mac App Store (signing identity per D-17) | A developer tool must spawn processes and reach arbitrary repo paths | 2026-11-12 |
| D-13 | Minimum macOS 26; built with the current SDK; standard controls so system materials are adopted automatically. The macOS CI job runs on GitHub's `macos-26` image | Owner answered Q-03: macOS 15 is too old to keep supporting (was macOS 15, 2026-11-12) | 2026-11-13 |
| D-14 | The engine is a child process of the app in v1; sessions survive restarts by resume, not by a background daemon | Simplest lifecycle; a launch agent can come later without protocol changes | 2026-11-12 |
| D-15 | CI is split by cost (§8.1): `make verify-engine` on Linux for every PR; `make verify-app` on macOS only when app, protocol, codegen or `Makefile` change; no UI tests and no runs on pushes to `main`. Full local `make verify` remains the merge gate | Running full `make verify` on macOS for every PR update and push to `main` used the month's Actions minutes in one day (82 runs, ~200 macOS minutes on 2026-11-13), mostly for engine-only changes. Owner moved to GitHub Pro for more minutes; landed in #27 | 2026-11-14 |
| D-16 | Pica is plan-agnostic: it must work without friction on every Copilot plan (Free, Pro, Pro+, Business, Enterprise). Nothing depends on a specific plan, model or org policy; tiers resolve against whatever `models.list` returns (D-09), and features that need data some plans lack (token prices, org budgets, pooled credits) degrade to a stated "not available on this plan" state instead of failing. The owner's own environment, Copilot Business with most standard models (Claude except Fable, Gemini 4, GPT-6 and 6.1, Grok 4.7), is the development reference, not a requirement. S-01 found that Copilot Free is a default-model-only plan: `models.list` holds just the virtual `auto` model (routed per call, e.g. to GPT-6 Luna or MAI Code 1.1 Flash) with no token prices, so Pica must offer no model picker there, only the effort or routing tiers the runtime advertises, and show no per-token cost when prices are absent; credits come from the usage events' nano-AIU totals instead | Owner answered Q-01 and asked for a product usable on all plans | 2026-11-14 |
| D-17 | v1 ships as an ad-hoc signed (`codesign -s -`), hardened-runtime app attached to GitHub Releases, not notarized and not distributed through MDM. On macOS 27 a quarantined ad-hoc app cannot be approved with "Open Anyway" (S-05), so it is installed without quarantine: the primary route is an install script (`curl` download, which sets no quarantine; SHA-256 checked against the release's `SHA256SUMS`; `codesign --verify`), and the fallback is a documented `xattr -dr com.apple.quarantine /Applications/Pica.app` before the first launch. Developer ID signing and notarization are added to the release workflow later, behind credentials, without design changes. Sparkle updates use their own EdDSA signatures, independent of Apple signing | Owner answered Q-04: no Developer ID yet, open to one later; GitHub Releases is acceptable for now | 2026-11-14 |
| D-18 | MCP servers are optional extensions. No Pica feature depends on any server; a session with none works fully. GitHub, Datadog, ClickUp and Snowflake are presets (M-02), not requirements. Pica does not try to anticipate which other servers users want; instead any server can be added by hand, by pasting a standard `mcpServers` entry, or by importing the servers a user already runs in other agent platforms (M-01, M-07) | Owner, 2026-11-15: the three org servers work elsewhere and should extend Pica, not gate it; users should bring the MCP servers they already use | 2026-11-15 |
| D-19 | Pica assumes no organization. It is for any individual, team, company or org; nothing needs an org admin, a registered GitHub App or OAuth App, or a managed policy file. Org features (H-01 managed policy, H-04 export, pooled-credit budgets) are optional layers that apply when present (Q-05, Q-07) | Owner answered Q-05 and Q-07: no registered app may be assumed, and the audience is not one team | 2026-11-15 |
| D-20 | GitHub access supports all three deployments: github.com, GitHub Enterprise Cloud with data residency (`<subdomain>.ghe.com`, API at `api.<subdomain>.ghe.com`), and GitHub Enterprise Server (API under `/api/v3`). Auth uses `gh` credentials and PATs; device flow runs only when the user configures their own OAuth client ID (Q-02, Q-05) | Owner answered Q-02: cover all three | 2026-11-15 |
| D-21 | C-10 judges `balanced` against `off` with a no-regression gate, not a savings target. On the mean of 3 runs, `balanced` may use at most 5% more reasoning-tier input and at most 35% more credits, with at most one fewer task succeeding. The eval pins the reasoning tier (`gpt-5.6-luna` for the 2026-11-16 run) and records the pin in the report | The original target (60% fewer reasoning-tier input tokens) assumed the main agent would otherwise read large files whole. Copilot's own `view` refuses whole reads of large files, and the main agent searches, reads ranges or writes scripts in every profile. Six smoke runs on Free and Pro showed no reasoning-tier saving to claim. The pin keeps a run comparable while the account's model list changes | 2026-11-16 |
| D-22 | The default routing profile is `off`. `balanced` and `strict` are opt-ins a user, workspace or session can select. A session created without a profile takes the workspace's override, unless managed policy locks `routing.profile`, else the user config's | The C-10 live report (`docs/evals/2026-11-16-c10-live.md`, Copilot Pro, 3 runs of 15 tasks): `balanced` succeeded on as many tasks as `off` but used 11.3% more reasoning-tier input and 179% more credits, mostly `code-writer`'s output. So it fails D-21's gate. C-11 is to make `balanced` pass the gate before it is offered as the default again | 2026-11-16 |
| D-23 | **Reverted 2026-11-17.** Under `balanced` the main agent keeps `apply_patch` for in-place edits. A patch that adds a file or moves one is denied whole (`cost.patch-add-file`), and new files still go to `code-writer`. `create` stays hidden, and `strict` still hides every write tool | The C-11 live report (`docs/evals/2026-11-17-c11-live.md`): in 90 runs `gpt-5.6-luna` never called `edit` and edited only with `apply_patch`. With `apply_patch` hidden, `balanced`'s main agent edited with `sed -i` and scripts in 8 of 45 runs, which `cost.shell-write` does not classify, and the credit result depended on it. The engine can see each path a patch creates, so this is a per-call gate on a tool whose created files are visible, not a gate on write content in general (§5.4). Reverted after the probe (`docs/evals/2026-11-17-c11-patch-probe.md`): `rename-fmt-cents` cost 4.67 credits against 0.53 with `sed -i`, and `console-to-logger` 1.55 against 0.98. For the same change across many files `sed -i` is the cheaper route, and `off` uses it too | 2026-11-17 |

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
           └── MCP servers (optional: any the user adds; presets for GitHub, Datadog, ClickUp, Snowflake)
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
      AppShell/                 launch, engine supervision, app-wide store (A-01)
    PicaUITests/                launch performance test
    Gallery/                    component gallery app for UI tests
    GalleryUITests/
  spikes/                       throwaway Phase 0 scripts
  tools/                        codegen, verify runner, release scripts
  .github/workflows/
```

### 4.3 Layering rules (enforced by F-02)

- `core` imports only `protocol`. No `node:*` I/O modules, no SDKs.
- `adapters` implement ports declared in `core`. Adapters do not import each other.
- `server` and `cli` are the only places that construct adapters.
- Swift feature code depends on `EngineClient`, `PicaProtocol`, `DesignSystem`; features never depend on each other. Cross-feature navigation goes through the app target. Features start in the app target and move into their own package once one is large enough to need it.
- Swift never shells out to `git`, reads repo files, or calls GitHub. It asks the engine. `make lint-swift-boundary` (part of `verify-engine`) fails on a Swift source that names the git executable or a GitHub host.

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

Namespaces: `engine.*` (handshake, version, health, Copilot account), `workspace.*`, `repo.*`, `github.*`, `session.*`, `fanout.*`, `events.*`, `approval.*`, `git.*`, `files.*`, `mcp.*`, `agents.*`, `models.*`, `usage.*`, `config.*`, `secrets.*` (engine → client requests).

Rules:
- `engine.hello` exchanges protocol versions; a major mismatch refuses the connection.
- State changes arrive as notifications. `events.subscribe {sessionId, afterSeq}` replays from the log and then goes live with no gap and no duplicate.
- Every error has a stable `code`, a human `message`, and optional `data.fix` naming an action the client can offer.

### 4.6 Configuration

Precedence, lowest to highest: built-in defaults → user (`~/Library/Application Support/Pica/config.jsonc`) → workspace → repo (`.pica/config.jsonc`). A managed policy file can lock any key; locked keys ignore every other layer.

```jsonc
{
  "routing": {
    "profile": "off",
    "tiers": { "reasoning": "auto", "worker": "auto" },
    "delegation": {
      "read":   { "minBytes": 32768, "rangeExemptLines": 400 },
      "output": { "maxBytes": 16384 },
      "codeWriter": { "maxToolCalls": 12, "maxWriteBytes": 32768 }
    }
  },
  "budget": { "sessionCredits": 300, "workspaceDailyCredits": 3000 },
  "permissions": { "mode": "ask" }
}
```

The numbers above are starting defaults. C-10 tunes them from measurements.

The C-10 live report of 2026-11-16 (`docs/evals/2026-11-16-c10-live.md`) leaves them unchanged:
- No threshold value would have made `balanced` cheaper. The extra cost comes from delegation itself: worker calls, most of them `code-writer`'s, and the extra main-agent turns around them. The threshold sizes don't drive it.
- Raising `read.minBytes` wouldn't change what the main agent reads. Copilot's own `view` already refuses whole reads of large files under every profile.
- `output.maxBytes` never fired in the run.

The default profile is `off` since D-22: in that report, `off` cost less for the same task success. `balanced` and `strict` are opt-ins. A session created without a profile takes the workspace's `routing.profile` override, unless managed policy locks the key, and otherwise the user config's `routing.profile`. Until D-22 sessions always started as `balanced`, whatever the config said.

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

Profiles: `off` (no cost gates; the default since D-22 and the baseline for evals), `balanced` and `strict` (opt-in, per user, workspace or session).

Every decision is emitted as an event with its rule ID, so the timeline can show "Read of `schema.sql` (212 KB) redirected to bulk-reader".

### 5.4 Why not gate writes with a hook

By the time a write tool call reaches `onPreToolUse`, the frontier model has already generated the file content as output tokens. Denying it wastes them. Writes are therefore routed by removing tools from the main agent, not by rejecting calls.

C-11 tried one exception, keeping `apply_patch` under `balanced` and denying only patches that add a file (D-23). It was reverted: the patches carried every changed line as output tokens and cost more than the one-line `sed -i` commands they replaced.

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
- Build: script that creates a session as the signed-in user, lists models, sends one prompt. Records which `models.list` fields are plan-dependent (D-16).
- Verify:
  - [x] **(live)** `models.list` returns at least one model, or the runtime exposes a default model a prompt can use; token prices are recorded when present (D-16). The result is saved to `docs/spikes/S-01-models.json`.
  - [x] **(live)** A prompt reaches `session.idle` and emits at least one `assistant.usage`; with no priced model listed it uses the plan's default model.
  - [x] A1 in §2.4 is marked confirmed or its fallback is recorded as a decision.

**S-02 · Hook enforcement and delegation** — S-01
- Build: session with a `bulk-reader` custom agent and an `onPreToolUse` that denies main-agent reads over 32 KB.
- Verify:
  - [x] **(live)** Hook invocations for main-agent and sub-agent tool calls are distinguishable; the distinguishing field is recorded.
  - [x] **(live)** Over 20 trials asking about a 200 KB fixture file, at least 19 end with the sub-agent reading the file and the main agent never receiving its content.
  - [x] The built-in tool names and argument shapes for read, write, edit, search, and shell are recorded in `docs/spikes/S-02-tools.json`.
  - [x] A2 and A3 are resolved and D-08 is confirmed or changed.

**S-03 · Per-agent model and attribution** — S-02
- Build: the checks below hold on whichever plan is signed in, as D-16 requires. On a default-model-only plan, such as Copilot Free, `models.list` offers only `auto` and S-02 found the sub-agent `model` override is not honored. So there, model checks record the fallback instead of asserting equality, and credit checks use the cost the runtime reports instead of `tokenPrices`. Re-run on a plan that lists models and prices when one is available. (Revised 2026-11-14.)
- Verify:
  - [x] **(live)** The sub-agent's `subagent.started.model` and `assistant.usage.model` are recorded next to the configured worker model. If `models.list` offers models beyond `auto`, they are equal. If it offers only `auto`, the override is shown to be ignored and A4's fallback is recorded as the decision for such plans.
  - [x] **(live)** Each `assistant.usage` can be assigned to exactly one agent; the method is recorded.
  - [x] **(live)** A session with `maxAiCredits` set low is stopped by spending that occurs inside a sub-agent. If the plan does not enforce `maxAiCredits`, that is recorded, and C-09's engine-side budget is shown to stop the same session instead.
  - [x] **(live)** Credits Pica computes match `getMetrics` within 1%: from tokens and `tokenPrices` when the plan lists prices, otherwise from the cost `assistant.usage` reports (`copilotUsage.totalNanoAiu`).
  - [x] A4 and A5 are resolved, each with the plan it was tested on.

**S-04 · Multi-root access** — S-01
- Verify:
  - [x] **(live)** A session rooted in repo A reads a file in repo B after host approval; the mechanism is recorded.
  - [x] **(live)** A write to repo B is blocked by the hook, including via a shell command.
  - [x] **(live)** Two sessions with different working directories run concurrently on one client without cross-talk.
  - [x] A6 is resolved.

**S-05 · Packaging** — none
- Build: minimal ad-hoc signed, hardened-runtime `.app` containing a Node binary, a bundled "hello" engine, and the Copilot CLI, zipped as a GitHub Releases asset would be (D-17).
- Verify:
  - [x] `codesign --verify --deep --strict` passes on the ad-hoc signed app, and every nested Mach-O binary is signed with the hardened runtime.
  - [x] **(manual)** On a second macOS user account with no developer tools, the app installed by the install script, and separately a quarantined zip whose app had `xattr -dr com.apple.quarantine` run before its first launch, both open with no Gatekeeper dialog, and the engine answers a ping. The exact steps are recorded for the install guide. *Passed on the owner's second macOS device, 2026-11-15; checklist in [docs/spikes/S-05.md](docs/spikes/S-05.md#manual-check-owner-second-account-without-developer-tools).*
  - [x] A7 is resolved.

**S-06 · MCP connectivity** — S-01
- Verify:
  - [x] **(live)** GitHub connects and lists tools, and the endpoint and auth method used are recorded in §2.2. Datadog, ClickUp and Snowflake are optional (D-18): `s06.mjs connect <server>` checks each on a machine that has it, and the owner reports all three working on the org's Macs.
  - [x] **(live)** Tool-definition token cost per server is recorded from `contextInfo` (GitHub: 13,835 tokens).
  - [x] A8 is resolved.

**S-07 · IPC throughput** — none
- Build: Node socket server emitting synthetic events; Swift command-line client decoding them.
- Verify:
  - [x] 50,000 events are received in order with none dropped at 20,000 events/s or better.
  - [x] p99 time from write to decoded value is under 5 ms.
  - [x] A9 is resolved.

**Gate G0:** every row in §2.4 is resolved and §3 reflects the outcomes. Phase 2 does not start before G0. **Met 2026-11-15:** A1 to A9 are resolved (A4 by its recorded fallback, D-08), and D-16 to D-20 record the outcomes.

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

**E-11 · `picad` production composition** — E-10, C-01, C-04, C-06, C-07, C-08, C-09, R-03, R-06, H-01, H-02, M-07
- Build: `composeEngine` in `engine/packages/server/src/composition.ts`, which `main.ts` runs before it listens. Under `~/Library/Application Support/Pica/` it opens `pica.db`, the audit log and session artifacts, and composes the `CopilotRuntime`, the user config layer with the managed policy (H-01), the model catalog and its prices (C-01), the read gate (C-04) and output guard (C-06) with their decisions on the session log, the runtime-native delegator over the built-in and user agents (C-07), the usage ledger (C-08), budgets from config (C-09), the audit log (H-02), workspaces with GitHub discovery through the `gh` CLI (R-06), the repo registry with `repo.addPath`, `repo.addUrl` and `repo.remove` (R-03), and the MCP import (M-07). The CLI gains `workspace create|list` and `repo add|list`, so M1 runs from the CLI alone. A store, config, agent or audit failure exits `picad` before its ready line. (Added 2026-11-15.)
- Not composed yet, each a follow-up: workspace and repo config layers per session (the read gate and budgets use the user layer and managed policy); the MCP registry, attachment and health monitor (M-01, M-04, M-06); user hooks (X-03); OTLP export (H-04); the R-08 repo tools; worktrees per session (R-02: sessions run in the registered checkout); PAT and device-flow GitHub auth, and hosts other than github.com (R-04, D-20). Budgets are read once at start.
- Verify:
  - [x] Over the socket, the production composition with a FakeRuntime registers a workspace and a repo by path and runs a session whose large read is denied naming `bulk-reader`, whose usage is in the ledger, and whose policy decision is in the audit log.
  - [x] `picad` started the way the CLI starts it answers `session.list` from its own store under the user's data directory, not as not implemented.
  - [x] A user config that does not validate makes `picad` exit non-zero before its ready line, naming the file and key path.
  - [x] `pica workspace create`, `pica repo add <path> [--workspace <id>]` and their `list` commands register and show a workspace and a repo; a bad path is an engine error and a missing one a usage error.
  - [x] **(live)** Milestone M1: `pica session new --repo <this checkout> "summarize the README"` completes against Copilot, and `pica usage` shows the main agent's tokens. *Passed on Copilot Free, 2026-11-15: two main-agent calls routed to `mai-code-1.1-flash`, 10,541 input, 12,800 cached and 139 output tokens, 0.2531 credits; the README `view` ran without a prompt.*

**Milestone M1 — headless slice:** **(live)** `pica session new --repo . "summarize the README"` completes against Copilot, and `pica usage` shows the tokens. **Met 2026-11-15** through E-11 on Copilot Free: `pica repo add .` registers the checkout, then `session new` and `usage` (see E-11's live check).

### Phase 2 — Cost router

**C-01 · Model catalog and tiers** — E-09
- Build: cached `models.list`, price table, tier resolution with `auto` and fallbacks, cost calculation.
- `auto` by capability (added 2026-11-16).
  - The reasoning tier prefers a model that supports reasoning effort (`capabilities.supports.reasoningEffort`) over one the runtime says does not. Among those it takes the highest blended price. The worker tier still takes the lowest.
  - Price alone put `claude-haiku-4.5` on the reasoning tier on Copilot Pro: it is the most expensive model per token there (100/500 credits per million) and the only one without reasoning effort.
  - With the rule, the Pro list resolves reasoning to `gpt-5.6-luna` and worker to `gpt-6-luna`. A model whose support isn't reported counts as capable.
  - That Pro account bills by tokens (`tokenBasedBilling`, no premium-request entitlement), so the catalog has no per-call multiplier to rank by.
  - The main agent now runs on the reasoning tier's model: the delegator sets the session's `model` to it, or leaves it unset when the tier resolves to none. Before, only sub-agents got a tier's model, and the main agent ran on the runtime's default (`claude-haiku-4.5` on that account).
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
- Shell-write gate (added 2026-11-16, after C-10's smoke run found the main agent writing a new test file with `cat > … <<EOF` once `create` was gone). Rule `cost.shell-write`: under `balanced` and `strict`, a main-agent shell command that writes a file inside the write roots is denied, with a reason naming `code-writer`. It reuses the R-07 shell parser. The read gate in `onPreToolUse` applies this one rule to shell calls, not the whole policy.
  - What counts as a write: redirections (`>`, `>>`, `&>`, with or without a heredoc), `tee`, `touch`, and the destination of `cp`, `mv` and `install`.
  - Limits, all passed on to the later rules:
    - Interpreters and scripts that write (`node -e`, `python -c`, a build script) are not classified.
    - In-place edits (`sed -i`, `perl -i`) pass, as `edit` does.
    - `/dev/null` targets, and targets outside the roots or unresolvable (`$OUT`), are left to the shell scope rule.
    - Sub-agents and `off` are not gated.
- Verify:
  - [x] FakeRuntime: a main-agent read of a 200 KB file is denied with a reason naming `bulk-reader`.
  - [x] The same read from a sub-agent is allowed.
  - [x] A 10 KB read and a 300-line ranged read of the large file are allowed.
  - [x] Changing `read.minBytes` in workspace config changes the outcome without restarting the session.
  - [x] Under `balanced` and `strict`, a main-agent shell write into the write roots is denied naming `code-writer`. Read-only shell, writes outside the repo, sub-agents and `off` pass.

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
- Build: the `Delegator` port and the implementation chosen by D-08. The runtime-native delegator turns the resolved agent definitions into `customAgents`: each gets exactly its definition's tools and its tier's model, and no `model` when the tier resolves to none. The session service takes it in place of building `customAgents` itself. The delegator also passes the routing profile's main-agent tools to the runtime: under `balanced` and `strict`, the tools the profile hides go in `defaultAgent.excludedTools`, and the profile's delegation guide is appended to the system message. Under `off` it passes neither. (Added 2026-11-16: until then only `customAgents` reached the runtime, so under `balanced` the main agent still had `create`.) The live check holds on whichever plan is signed in, as D-16 requires: on a default-model-only plan, such as Copilot Free, no worker model is requested and the check records the model `assistant.usage` reports instead of asserting equality, as S-03's checks do. (Revised 2026-11-15.)
- Follow-up: the engine-managed child-session delegator, `DelegationMode` `child_session`, for plans that list models but ignore the per-agent `model` override (A4, D-08). It is not built: it needs child-session events nested in the parent's log, budget and usage carried across sessions, and the hooks applied to the child, which is more than C-07. The seam is the `Delegator` port; the live check fails on such a plan, which is the signal to build it. Re-run the live check on a plan that lists models when one is available.
- Verify:
  - [x] FakeRuntime: a delegation produces child events nested under the parent's tool call.
  - [x] A failing child emits a failure event and the parent run continues.
  - [x] The child runs with exactly the tools in its agent definition.
  - [x] **(live)** A `bulk-reader` delegation runs on the worker-tier model. On a default-model-only plan (the worker tier resolves to none), no worker model is requested and the model `assistant.usage` reports is recorded instead (D-16).

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
- Built (2026-11-16): 12 tasks over `fixtures/evals/`, three per category, in `engine/packages/evals`. The runner gives each task a fresh engine with the production composition (E-11), its own data directory, and a fresh git copy of the fixture. It measures from the ledger grouped by tier, and "reasoning input" counts fresh and cached tokens. `models.tiers` is not served yet, so the report takes each tier's models from the ledger records. See `docs/evals/README.md`.
- Remaining: the live run, then the §4.6 retune. A live smoke run on 2026-11-16 used Copilot Free, two tasks, `off` and `balanced`. It showed the full run would not be a meaningful comparison there:
  - The worker tier resolves to none, and no worker-tier call was recorded.
  - The main agent finds the needle with `rg` and a ranged `view`, so the read gate never fires.
  - The session model is not pinned: `gpt-6-luna` and `mai-code-1.1-flash` both ran as the main agent.
  - Result: 24% fewer reasoning-tier input tokens, which is noise from the model mix and not delegation, and 1 fewer success.
  - A second smoke run on Copilot Pro (2026-11-16) resolved the tiers to different models: reasoning `claude-haiku-4.5`, worker `gpt-6-luna`.
    - The large-file question worked: the gate denied `grep` on `db/schema.sql`, the main agent delegated to `bulk-reader` on the worker model, and reasoning input fell from 118k to 49k.
    - The write task did not delegate: under `balanced` the main agent still had `create`. The session service passes only `customAgents`. The profile's main-agent `excludedTools` and the delegation guide are not composed (the C-07 deferral). Until they are, the write tasks cannot show a saving, and the full run would miss the target for that reason, not because of the thresholds.
  - A third smoke run on Pro (2026-11-16), after #79 wired the main agent's excluded tools and the guide:
    - `money-tests` under `balanced`: the main agent no longer had `create`. It still did not delegate. It wrote the test file through `bash` (`cat > test/money.test.mjs`).
    - `schema-column-owner` delegated to `bulk-reader` again.
    - Result: 11% fewer reasoning-tier input tokens.
    - Every main-agent call carries about 16k cached prompt tokens. So a task saves only when delegating keeps file contents out of the main context, and the main agent's `grep` and ranged reads already do that.
  - A fourth smoke run on Pro (2026-11-16), with #80's shell-write gate. The routing worked end to end:
    - The main agent's heredoc write was denied (`cost.shell-write`).
    - It delegated to `code-writer` on `gpt-6-luna`, which wrote the file with `apply_patch`.
    - Then it ran the tests itself, and both tasks passed.
  - But `balanced` used 45% more reasoning-tier input than `off` (169k against 117k):
    - Each extra main-agent turn (the denied attempt, the delegation, the review) costs about 16 to 18k cached prompt tokens.
    - The fixture files are small, so delegation saves less than those turns cost.
    - The denied heredoc had already spent 893 output tokens, the cost §5.4 warns about.
    - Run-to-run spread is large: `schema-column-owner` under `balanced` came to 49k, 65k and 82k reasoning input in three runs.
  - With that suite the 60% target looked unreachable whatever the thresholds. The owner chose larger fixtures and 3 runs per task (2026-11-16):
    - The inputs are now 80–100 KB or more wherever a task needs the content read, sized from the per-turn cost above. See "Sizing" in `docs/evals/README.md`.
    - The runner takes `runs` (`EVAL_RUNS`, 3 by default live). The report gives per-task means and ranges, and the target is checked on the means.
  - A fifth smoke run on Pro (2026-11-16) used the larger inputs, 1 run per task.
    - Totals: `off` 218k reasoning input, `balanced` 225k (3% more). Both tasks passed in both profiles.
    - Copilot's own `view` refuses a whole read of a large file. On the 92 KB `money.mjs` it returned "File too large to read at once (92.3 KB)", 148 bytes, under `off` too. So the `off` main agent never takes in big files: its context grew only from 16.1k to 18.0k over the session.
    - Bigger inputs can't widen the gap. Reasoning input is about main-agent turns × the ~17k prompt prefix, and delegating adds turns: `balanced` took 8 main turns on `money-tests` against 6 under `off`.
    - Two of those turns were attempts the gates then denied: the whole `view`, then the heredoc.
    - Premium requests: each main call on `claude-haiku-4.5` counted 0.33, and each worker call on `gpt-6-luna` counted 1.0. So `balanced` used 11.3 premium requests on the two tasks, against 4.3 under `off`. On this plan, `auto` puts the cheaper model on the reasoning tier.
    - On Copilot the 60% reasoning-input target measures something the runtime already limits. The full run waits for a decision on the target and on the tier models.
    - Correction: that account bills by tokens (`getQuota`: `tokenBasedBilling: true`, no premium-request entitlement), so the `premiumRequests` on usage events aren't what it pays. #81 fixes the tier choice and runs the main agent on the reasoning tier's model.
  - A sixth smoke run on Pro (2026-11-16) with #81: main agent on `gpt-5.6-luna`, workers on `gpt-6-luna`, 1 run. Both tasks passed in both profiles.

    | Profile | Reasoning input | Main calls | All calls | Credits |
    |---|---|---|---|---|
    | `off` | 124,574 | 9 | 9 | 0.8665 |
    | `balanced` | 126,534 | 9 | 22 | 1.1379 |

    - Delegation no longer adds main turns. But the 13 worker calls add credits (+31%) and wall time (21 s against 60 s), and save the main agent nothing, because Copilot's `view` limit already keeps big files out of its context.
    - The target is awaiting the owner's decision.
  - The owner chose to add comprehension tasks first (2026-11-16). There are three, each finding a planted bug that no searchable word marks, in `money.mjs` (92 KB), the 32 report modules, or the 36 toolkit modules. They are the work the main agent can't shortcut with `grep`, and so where delegation should pay. The suite now has 15 tasks.
  - Smoke run on the comprehension tasks (2026-11-16): `allocation-bug` and `report-total-bug`, 1 run. The account's catalog had grown to 14 models, so `auto` picked `kimi-k3` (300/1500) for reasoning and `claude-haiku-5.5` (10/50) for worker. All four sessions found the bug.

    | Profile | Reasoning input | Credits |
    |---|---|---|
    | `off` | 142,403 | 16.03 |
    | `balanced` | 129,594 | 15.90 |

    - `balanced` used 9% less reasoning input and about the same credits.
    - Under `off` the main agent didn't read the code either. On `allocation-bug` it wrote a `node` script that called every `allocate*` function and checked the sums. On `report-total-bug` it guessed patterns for `grep` (`slice\(1`, `shift\(\)`).
    - Under `balanced` it delegated once (`bulk-reader`, after two denied whole reads) and took as many main turns as `off`.
    - A frontier main agent with search and a shell doesn't take in large content in either profile, so delegation has little reasoning-tier input left to save on Copilot. `EVAL_KEEP=1`, `EVAL_PROFILES` and `EVAL_TASKS` keep a run's data or narrow it for inspection.
- Verify:
  - [x] Against FakeRuntime the harness produces exactly the expected report.
  - [x] Each task's success check passes on a reference solution and fails on an empty one.
  - [x] **(live)** On the suite, on the mean of 3 runs, either `balanced` passes the D-21 gate against `off` (at most 5% more reasoning-tier input, at most 35% more credits, at most one fewer task succeeding), or the gap is explained and the routing changed. The report is committed to `docs/evals/`. *Met 2026-11-16 by the second branch: the gate failed, the gap is explained below, and the default changed to `off` (D-22). Report: `docs/evals/2026-11-16-c10-live.md`.*
    - *Setup: Copilot Pro, reasoning pinned to `gpt-5.6-luna`, worker `claude-haiku-5.5` (auto), 90 sessions, 70.9 credits.*
    - *All 15 tasks passed in both profiles.*
    - *Reasoning-tier input: +11.3% (1,125,020 against 1,010,326).*
    - *Credits: +179% (17.39 against 6.23 per suite run).*
    - *`code-writer` used 29.7 of `balanced`'s 52.2 credits: 199 calls producing 381k output tokens. `bulk-reader` used 2.9.*
    - *Main-agent calls rose from 201 to 225, so delegation added reasoning-tier turns rather than saving any.*
  - [x] Default thresholds in §4.6 are updated from the report, or the reason they stay is recorded in §4.6. *They stay (2026-11-16); see the note under §4.6.*

**C-11 · Make `balanced` pass the gate** — C-10
- Build:
  - Cap `code-writer`'s calls and output per delegation, and tighten its prompt so it applies a precise spec without exploring. In the C-10 live run it made 199 calls producing 381k output tokens, 29.7 of `balanced`'s 52.2 credits.
  - Cut the main agent's denied attempts. A whole-file `view` or a shell write that the gate then denies still costs a main-agent turn.
  - Rerun the C-10 suite with the same pin and 3 runs.
- Built (2026-11-16):
  - `routing.delegation.codeWriter` (`maxToolCalls` 12, `maxWriteBytes` 32768) limits one `code-writer` delegation under `balanced` and `strict`. The read gate's `onPreToolUse` counts each delegation by its `agentId`. A write's serialized arguments count as its bytes, since they are the worker's output tokens. Past either limit, every further call is denied (`cost.delegation-limit`) with a reason telling the sub-agent to stop and report what is left. The SDK has no per-agent turn or output cap, so the engine enforces it.
  - `code-writer`'s prompt: apply the spec as written, don't explore, read only the ranges the spec names, don't run or review, create a file whose content is given in one call, reply in at most five lines. Its description tells the main agent to give each file's path and full content.
  - The delegation guide puts the rules first, then the agents. It now says that a whole read of a large file and a search printing its lines are denied, that shell writes are denied (listing the forms), that the main agent edits existing files itself, with one `sed -i` or script for a change across many files, and that `code-writer` needs the full content or exact edits in the prompt. The C-10 run sent its costliest work, the multi-file edits, to `code-writer` because the old guide said to.
  - The `cost.large-read` and `cost.shell-write` reasons now name the next call: a `view_range` of at most `rangeExemptLines` lines or the `task` tool with `bulk-reader`, and `code-writer` with the path and full content, without retrying in another form.
  - FakeSession passes `agentType` on a sub-agent's hook input, as Copilot does (S-02).
  - After the live run, D-23 (keep `apply_patch` under `balanced`, deny a patch that adds a file) was built, probed and reverted; see the live result below. The guide and the main agent's tools are as they were for the 3-run report.
  - The guide tells the main agent to `mkdir -p` a missing directory before delegating a new file there, since `code-writer` cannot create directories. Without it the probe's new-file tasks failed one `create` and delegated twice.
- Live result (2026-11-17, `docs/evals/2026-11-17-c11-live.md`; probe on 5 tasks: `2026-11-17-c11-probe.md`): **the gate is not met.**
  - Setup: same as C-10. Copilot Pro, reasoning pinned to `gpt-5.6-luna`, worker `auto`, 3 runs of 15 tasks per profile, 90 sessions, about 45 credits.
  - All 15 tasks passed in both profiles (gate met).
  - Credits: +27.1% (8.42 against 6.63 per suite run; gate at most 35%, met). In C-10 it was +179%.
  - Reasoning-tier input: +8.4% (1,154,683 against 1,065,153; gate at most 5%, **not met**). It is about 36k over the limit.
  - Where the extra reasoning input is (per task, mean of 3): `console-to-logger` +56k, `backoff-tests` +27k, `prettier-config` +17k, `rename-fmt-cents` +15k, `report-total-bug` +15k, `settlement-log-error` +14k; `allocation-bug` −27k, `service-ports` −13k and four others below `off`. `console-to-logger`'s runs ranged 108k–235k under `balanced` and 86k–175k under `off`, so one task's noise is larger than the whole 5% margin (53k).
  - No `cost.shell-write` denial fired in 45 `balanced` runs (C-10 had them), and `cost.large-read` fired about once per large-file task, as intended.
  - `code-writer` ran 19 delegations, mostly new files with their content in the prompt. One `license-headers` run hit the 12-call limit after 12 `view` calls and kept calling `view` through 24 denials before replying. The deny doesn't stop a worker that ignores it.
  - **How the main agent edits under `balanced`, and the C-04 gap.** The main agent used `sed -i` or a script that writes files in 8 of 45 `balanced` runs (13 commands), against 6 of 45 under `off` (6 commands). Those are the forms `cost.shell-write` does not classify. `rename-fmt-cents` and `console-to-logger` used them in every `balanced` run and delegated nothing, and their credits matched `off` (0.53 against 0.46, 0.98 against 1.00). In C-10 the same two tasks went to `code-writer` and cost 8.9 credits against 1.2. The credit margin left is 0.52 per suite run, so **the credit pass depends on that gap**: if the gate classified `sed -i` and interpreter writes, those edits would go back to `code-writer`. In 90 runs the main agent never called `edit`; under `off` it edited only with `apply_patch`, which `balanced` hides because a patch can add files. So with this model, `balanced` leaves the main agent no edit tool it uses, and `sed -i` is its route for in-place edits. The guide's "use `edit`" points at a tool the model doesn't reach for. The D-23 probe below showed that this dependence is the routing working, not a leak: a `sed -i` command is a few output tokens, which is what §5.4 aims for, and an `apply_patch` route cost more.
  - What's left:
    - D-23 probe (2026-11-17, `docs/evals/2026-11-17-c11-patch-probe.md`, `balanced`, 1 run, stopped at the 6-credit limit after 2 of 3 tasks, 6.22 credits): **`apply_patch` made both edit tasks cost more, not less.**
      - `rename-fmt-cents`: 4.67 credits and 407k reasoning input, against 0.53 and 86k with `sed -i` in the 3-run report (`off`: 0.46). The main agent first delegated the rename to `code-writer` twice with an open-ended spec ("edit every occurrence"). Both delegations hit the 12-call limit, and one kept calling through 24 denials. Then it made 7 patches of about 5 files each, and one failed on a file `code-writer` had half edited.
      - `console-to-logger`: 1.55 credits, against 0.98 with `sed -i` (`off`: 1.00). Reasoning input fell to 122k (from 179k), but the single patch carried every changed line as output tokens.
      - So for the same change across many files, `sed -i` is the cheap route under both profiles (`off` used it in every `rename-fmt-cents` run too). Its output is a short command, which is what §5.4 aims for. Classifying it would push those edits into patches or delegations that cost more. The "gap" in the shell-write gate is not where `balanced` leaks cost.
      - D-23 is reverted. `sed -i` and interpreter writes stay unclassified on purpose: they are the main agent's cheap route for a change across many files.
    - Make `code-writer` stop on a `cost.delegation-limit` denial, or end the delegation from the engine after the first one.
    - The 5% reasoning-input gate is within one task's run-to-run spread on this suite. Either run more than 3 runs or set the margin from the spread of `off` against itself, and record which in D-21.
- Verify:
  - [x] Under `balanced` and `strict`, a `code-writer` delegation's tool calls past `routing.delegation.codeWriter` are denied with a reason telling it to stop and report; each delegation is counted apart, and `off`, the main agent and other agents are not limited.
  - [x] The delegation guide states the read and shell-write rules before the agent list, and the deny reasons name the next call to make.
  - [ ] **(live)** On the C-10 suite, on the mean of 3 runs, `balanced` passes the D-21 gate against `off`. The report is committed to `docs/evals/`. *Not met 2026-11-17: credits +27.1% and tasks equal pass, reasoning-tier input +8.4% fails. See the live result above.*
  - [ ] If it passes, the owner decides whether `balanced` becomes the default again (D-22).

**Milestone M2 — measured cost routing:** the C-10 live report exists and passes the no-regression gate (D-21), or the gap is explained and the routing is changed. **Met 2026-11-16:** the report exists and fails the gate. The gap is explained under C-10, and the routing changed: `off` is the default (D-22), and C-11 is to make `balanced` pass the gate.

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
- Build: provider chain (`gh` credentials, device flow, PAT from the secret broker), host configuration for github.com, GHE.com (data residency) and GitHub Enterprise Server (D-20). Device flow needs a user-configured OAuth client ID; Pica ships none (D-19).
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
  - [x] A team source adds repos as `available`, not cloned.
  - [x] Removing a source keeps pinned repos.
  - [x] Workspace overrides resolve through E-04 precedence.

**R-07 · Session scope and sandbox** — C-03, R-02
- Build: write roots and reference roots on the session; path resolution guard; safety rules.
- Verify:
  - [x] Policy cases: write to a reference root is denied; a symlink or `..` escaping every root is denied.
  - [x] A shell command whose working directory or redirect target is outside the write roots yields `ask` or `deny` per permission mode.
  - [x] Fuzzed paths never resolve outside the roots while being allowed.

**R-08 · Cross-repo tools** — R-06, R-07
- Build: `repo_search`, `repo_read`, `repo_list` as engine tools; `@repo:path` mention parsing.
- Verify:
  - [x] On a three-repo fixture, search returns `repo:path:line` hits in a deterministic order within the result cap.
  - [x] `repo_read` refuses paths outside workspace repos.
  - [x] Mention parser table tests, including ambiguous and missing repos.

**R-09 · Repo cards** — R-03
- Build: model-free summary cached by HEAD commit.
- Verify:
  - [x] Golden cards for fixture repos in four ecosystems.
  - [x] The cache is reused on the same commit and rebuilt on a new one.
  - [x] A card never exceeds its size cap.

**R-10 · Multi-repo change sets** — R-02, R-07
- Build: one session with worktrees in several repos on one branch name; per-repo diffs; linked pull requests.
- Verify:
  - [x] A two-repo change set creates two worktrees and two branches with the same name.
  - [x] Against a stub API, both pull requests are created and each body links the other.
  - [x] A failure creating the second pull request reports partial state without rolling back the first.

**R-11 · Fan-out runs** — R-06, E-08
- Build: one task as parallel sessions over selected repos with a concurrency cap and an aggregate view.
- Verify:
  - [x] FakeRuntime: with 6 repos and a cap of 3, no more than 3 sessions run at once.
  - [x] One failing session does not cancel the others; the aggregate reports each result.
  - [x] Cancelling the fan-out aborts every running session.

**Milestone M3 — multi-repo slice:** **(live)** from the CLI, import a GitHub team, start a session in one repo that answers a question about code in another, and see the lookup attributed to `repo-scout` on the worker tier.

### Phase 4 — MCP

**M-01 · Registry and configuration** — E-04
- Build: server definitions at global, workspace, and repo scope; import from `.vscode/mcp.json`, `.mcp.json`, and Copilot config.
- Verify:
  - [x] Merge precedence tests.
  - [x] Import golden tests for each source format.
  - [x] A definition with an inline secret is rejected with a message pointing to secret references.

**M-02 · Presets** — M-01, S-06
- Build: parameterized, optional presets for GitHub, Datadog, ClickUp, Snowflake (D-18). None is enabled by default. The GitHub preset follows the configured GitHub host (D-20).
- Verify:
  - [x] Each preset renders the expected definition for sample parameters, using the endpoints in §2.2.
  - [x] With no preset enabled, a session's config carries no MCP servers.
  - [x] Missing or malformed parameters fail validation with the parameter named.

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

**M-07 · Import from other agent platforms** — M-01
- Build: bring in MCP servers the user already runs elsewhere, without Pica naming specific servers (D-18). Discover the config files other agent platforms keep (for example Claude Desktop, Claude Code, Cursor, Windsurf, VS Code user settings, Gemini CLI, Codex, and the Copilot CLI and `.mcp.json` sources M-01 reads) and list their servers as import candidates. Accept a pasted `mcpServers` / `servers` JSON snippet or a single entry. Importing copies the chosen entries into Pica's `mcp.jsonc` at a scope the user picks, moves inline secrets into secret references, and records where each came from. Nothing is imported or attached without the user choosing it. RPC: `mcp.importCandidates`, `mcp.import`; secrets reach the app's Keychain through the engine→client `secrets.set`. Spec: `docs/mcp-import.md`.
- Deferred: Codex (`~/.codex/config.toml`, `[mcp_servers.*]`) is TOML, and adding a TOML parser dependency was not approved for this unit, so Codex is not read yet. Pasting a Codex server converted to JSON works today.
- Verify:
  - [x] Golden tests: one fixture per platform format converts to the expected Pica entries, with notes for fields Pica drops.
  - [x] A pasted snippet in each common shape (`mcpServers`, `servers`, a bare name map, one entry) imports; a malformed one fails with the key path named.
  - [x] An imported entry with an inline secret is stored with a secret reference, and the secret value is in the broker, not the file.
  - [x] A platform file that is missing or unreadable yields no candidates and no error.
  - [x] Candidates are never attached to a session until the user attaches them.

### Phase 5 — macOS app

Units A-02 and A-03 can start as soon as E-02 is done and run in parallel with Phases 2–4, because every app unit is tested against an engine using FakeRuntime.

**A-01 · App shell and engine supervision** — E-05, S-05
- Build: launch and supervise `picad`, handshake, restart with backoff, single instance.
- Verify:
  - [x] Killing the engine shows a reconnecting state and recovers within 2 s.
  - [x] A protocol major mismatch shows a blocking error naming both versions.
  - [x] Cold launch to interactive window is under 1.0 s (performance test with baseline).
- Notes: `app/Packages/AppShell`, specified in [docs/app-shell.md](docs/app-shell.md). An engine already listening (the CLI's) is reused. Tests run `picad`'s production composition with a FakeRuntime (`engine/packages/server/tests/processes/fake-picad.ts`), so `make verify-app` now needs Node and the engine's packages. Measured on 2026-11-16: recovery about 0.43 s; cold launch median 0.43 s.

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
  - [x] UI test: a workspace created through the engine appears in the sidebar.
  - [x] Selection and column widths are restored after relaunch.
  - [x] Every sidebar item is reachable and activatable by keyboard alone.
- Notes: specified in [docs/navigation-shell.md](docs/navigation-shell.md). The inspector is SwiftUI's `.inspector` on the session column, the toggleable third column. Sessions waiting for approval or failed sort to the top of their workspace. ⌘1–9 select sessions in sidebar order; ⌥⌘I toggles the inspector. AppKit restores the window frame and the sidebar's width from the app's defaults; `window-state.json` next to the socket holds the selection, the inspector's width and visibility, and collapsed workspaces. No protocol change was needed. The engine does not announce `workspace.delete` or repo registration, so those reach the sidebar on the next `workspace.changed` or reconnect. The UI tests' socket is in the runner's container, the only place the sandboxed runner may connect to.

**A-05 · Session timeline** — A-04
- Build: virtualized timeline, streaming Markdown, tool rows, sub-agent groups, policy rows.
- Verify:
  - [x] Snapshot test for each event type.
  - [x] A 10,000-event fixture opens in under 300 ms.
  - [x] Scroll hitch time ratio under 1% on that fixture.
  - [x] Streaming appends do not move the scroll position when the user has scrolled up.
- Notes: `app/Packages/Timeline`, specified in [docs/session-timeline.md](docs/session-timeline.md). It is a feature package (lint-arch rule added); the app target hands it to AppShell's session column as `SessionContent`, so AppShell does not depend on it. Markdown is parsed with Apple's swift-markdown (cmark-gfm). The timeline is a `ScrollView` over a `LazyVStack`: SwiftUI's `List` stalled for about 50 ms when it re-estimated row heights mid-scroll. Rows are not selectable (selectable text made building a row several times slower and scrolling hitch); messages have a Copy menu and expanded details stay selectable. Pica measures itself (`TimelineMetrics`, on only in UI tests) and scrolls itself for the hitch check, since XCUITest's scrolling jumps a page per event and its accessibility queries hold the main thread. `fake-picad` takes `PICA_TEST_SCENARIO`; the `timeline` scenario writes 10,025 events. Measured on 2026-11-16 (Debug build, Apple silicon): open median 0.21–0.22 s, hitch time ratio 0.1–0.3%. `EngineClient`'s line splitter now uses `memchr`; its per-byte scan made a 10,000-event replay take 0.69 s in Debug builds (now 0.20 s).

**A-06 · Composer** — A-05
- Build: multiline input, `@` mentions for repos, files, and agents, `/` for skills, profile and tier pickers, steer and queue while running.
- Verify:
  - [x] Mention tokenizer table tests.
  - [x] UI tests: `@` opens completions and Return inserts; ⌘↩ sends; sending while running queues.
  - [x] Keystroke to glyph under 16 ms with a 10,000-event session open.
- Notes: `app/Packages/Composer`, specified in [docs/composer.md](docs/composer.md). A feature package (lint-arch rule added); the app target puts it under the timeline in the `SessionContent` closure. The input is an `NSTextView` (TextKit 1) for key handling, mention coloring and a measured height. ⌘↩ sends when idle and queues while a turn runs, ⇧⌘↩ steers, ⌘. stops, all through `session.send` modes and `session.abort`. Mentions name repos, files (`repo:path`) and agents; a sent message gets a closing list of where mentioned repos and files are. No protocol change. The engine served none of `agents.list`, `models.*`, `files.*` and `config.*`: A-06 adds `agents.list`, `models.list` and `models.tiers` to the production composition, while file and skill completions wait for `files.*` (A-09) and the tier picker only shows the tiers until `config.set` is served. A session keeps the profile and models it started with, so the profile picker sets the workspace's default for new sessions. Pica measures keystroke to glyph itself (`ComposerMetrics`, on only in UI tests) while XCUITest types, so the keys take the system's event path; keys Pica posted to itself (`NSApplication.postEvent`) waited 8–10 ms in AppKit's queue, which a keyboard's do not. `fake-picad` has a `composer` scenario whose first turn runs until it is stopped. Measured on 2026-11-16 (Debug build, Apple silicon at 120 Hz, 10,025-event session open, six runs): glyph median 12.9–13.3 ms, p95 13.5–15.2 ms; the composer's own handling of a key is about 2 ms. Each rebuilt Pica has to be allowed to access the Documents folder again before its UI tests can start the engine, since the worktrees are under `~/Documents` and Debug builds are signed ad hoc.

**A-07 · Approvals** — A-05
- Build: inline approval cards, system notification, allow once, always, deny.
- Verify:
  - [x] UI test over a FakeRuntime scenario resolves each choice correctly.
  - [x] "Always allow" writes a permission rule to config and suppresses the next identical request.
- Notes: specified in [docs/approvals.md](docs/approvals.md). The timeline's approval row (A-05) gains the choices and names the call (tool and its command, path or url); budget approvals get Raise Budget and Stop. Rows resolve through a `ResolveApprovalAction` in the environment, which `SessionTimelineScreen` sets. Engine change: config gains `permissions.tools` (`{ tool, match?, permission }`), and resolving `allow_always` appends the rule to the user's `config.jsonc` in place (comments kept) before the approval resolves; if it cannot be written the approval stays pending. A permission prompt a rule matches is answered at once and recorded as a `policy.decision` (`permission.rule`), not an approval. Identity is the tool plus its `command`, `path` or `url` argument. `ApprovalNotifier` (AppShell) posts a `UserNotifications` notification when a session enters `awaiting_approval` while Pica is not frontmost, withdraws it when the session moves on, and asks for permission only on first post; `PICA_NOTIFICATIONS=off` turns it off for UI tests. FakeRuntime's tool-call step takes `asks`; `fake-picad`'s `approvals` scenario plays it. Limit: the production composition has no policy rule that asks for a call yet (the `permission.ask` and shell-scope rules are not composed into `onPreToolUse`), so tool-call approvals come only from the runtime's own permission flow.

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

**A-13 · MCP management** — A-04, M-06, M-07
- Build: catalog of optional presets, add and edit, paste a server snippet, import from other agent platforms (M-07), authenticate, attach per workspace and session, token-cost column, health.
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
  - [x] A hook exiting non-zero before commit blocks the commit and surfaces its output.
  - [x] A hook exceeding its timeout is killed and reported.
  - [x] A user hook cannot change a managed policy outcome (policy case).

**H-01 · Managed policy** — E-04, C-03, M-05
- Build: organization policy from a managed preferences domain or a root-owned file: model allowlist, MCP allowlist, budget ceilings, permission-mode floor.
- Verify:
  - [x] Each lockable key has a test where user config is ignored.
  - [x] A policy file not owned by root is ignored with a warning.

**H-02 · Audit log** — C-03, E-07
- Build: append-only JSONL of tool calls, approvals, and policy decisions with a hash chain; export.
- Verify:
  - [x] Altering any line makes verification fail at that line.
  - [x] Every policy decision in a scenario appears exactly once.

**H-03 · Redaction** — M-03
- Build: scrubber for logs, events, and diagnostics.
- Verify:
  - [x] A corpus of token formats is fully redacted.
  - [x] The diagnostics bundle for a fixture session contains no file contents and no secrets.

**H-04 · Observability** — E-05
- Build: structured engine logs, diagnostics bundle, optional OpenTelemetry export of usage metrics.
- Verify:
  - [x] With export disabled, the engine opens no outbound connection other than the runtime's (asserted with a network stub).
  - [x] Exported metrics for a fixture match the ledger.

**H-05 · Reliability** — E-08, A-01
- Verify:
  - [ ] Corrupt-database fixture: the engine moves it aside, starts clean, and reports the backup path.
  - [ ] Disk-full simulation during event append fails the session with a stable error and leaves the log readable.
  - [ ] One hundred consecutive kill-and-resume cycles lose no event.

**H-06 · Distribution** — S-05, A-01
- Build: release workflow publishing ad-hoc signed, hardened-runtime builds to GitHub Releases with a `SHA256SUMS` asset; an `install.sh` release asset that downloads with `curl`, checks the checksum and signature, and installs without quarantine (prototype in `spikes/s-05-packaging/install.sh`); Sparkle updates with an appcast served from GitHub Releases; Developer ID signing and notarization as an optional step that runs only when credentials are configured (D-17).
- Verify:
  - [ ] The release workflow produces a zip whose app passes `codesign --verify --deep --strict` and attaches it to a draft GitHub release.
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
| A plan or org policy blocks the Copilot CLI/SDK or the cheap models | No product for those users | S-01 runs first; BYOK fallback; admin ask is small and specific |
| SDK or runtime changes break the adapter | Sessions fail after an update | Version pinned; replay-server contract tests; update only through a PR that re-records transcripts |
| Delegation latency (10–30 s) annoys users on mid-sized files | Profile gets turned off | Threshold tuned by C-10; range exemption; per-workspace override; timeline shows why a redirect happened |
| Worker model gives wrong answers about large files | Bad decisions by the main agent | Citations required; main agent can do ranged reads to check; eval suite tracks success, not just tokens |
| Denied reads make the main agent loop | Wasted reasoning tokens | S-02 measures it; fallback is the explicit `delegate` tool; a repeat-deny counter escalates to the user |
| MCP tool definitions bloat the context | Higher cost on every turn | Attach on demand; per-server allowlists; token cost shown before attaching |
| Unnotarized builds (D-17) are blocked outright by Gatekeeper when downloaded in a browser (no "Open Anyway" for ad-hoc apps on macOS 27), and ad-hoc signatures change each build so Keychain items prompt again after updates | Install needs Terminal; a user who double-clicks first must reinstall; one Keychain prompt per item per update | Install script as the primary route, `xattr` step as fallback (S-05); few Keychain items (M-03); Developer ID and notarization added to H-06 once available; separate engine install as fallback |
| Two processes mean two places for bugs | Debugging cost | Engine-only reproduction through `pica`; event log is the shared truth |
| GitHub team discovery blocked by SSO or app approval | Team import unavailable | Auth chain with three providers; manual add always works |

### 11.2 Open questions for the project owner

| ID | Question | Needed by |
|---|---|---|
| Q-01 | ~~Copilot Business or Enterprise, and which models does org policy allow?~~ Answered 2026-11-14: Business with most standard models; Pica must be plan-agnostic (D-16) | S-01 |
| Q-02 | ~~GitHub.com, GitHub Enterprise Cloud with data residency, or GitHub Enterprise Server?~~ Answered 2026-11-15: all three (D-20) | R-04 |
| Q-03 | ~~Can the minimum be raised above macOS 15 across the fleet?~~ Answered 2026-11-13: yes, to macOS 26 (D-13) | A-03 |
| Q-04 | ~~Is an Apple Developer ID available for signing, and will distribution go through MDM?~~ Answered 2026-11-14: no Developer ID yet (maybe later); GitHub Releases, no MDM (D-17) | S-05, H-06 |
| Q-05 | ~~Can the org register a GitHub App or OAuth App for team discovery, or must Pica rely on `gh` and PATs?~~ Answered 2026-11-15: no, and it cannot be assumed for other users either; Pica relies on `gh` and PATs (D-19, D-20) | R-04 |
| Q-06 | ~~Is the Snowflake MCP server already created by an admin, and with which auth?~~ Answered 2026-11-14: the org's Snowflake MCP server uses a PAT. ClickUp and Datadog use browser OAuth. None of the three is available on the development Mac, so they are tested later on a machine that has them | S-06 |
| Q-07 | ~~Is this for one team or the whole engineering org?~~ Answered 2026-11-15: neither is assumed; Pica is for any individual, team, company or org, so H-01 and H-04 are optional layers (D-19) | Phase 6 |

---

## 12. Unit index

Status values: `todo`, `doing`, `done`, `blocked`.

| ID | Unit | Depends on | Status |
|---|---|---|---|
| S-01 | Runtime access and auth | — | done |
| S-02 | Hook enforcement and delegation | S-01 | done |
| S-03 | Per-agent model and attribution | S-02 | done |
| S-04 | Multi-root access | S-01 | done |
| S-05 | Packaging | — | done |
| S-06 | MCP connectivity | S-01 | done (GitHub connected by Pica; Datadog, ClickUp and Snowflake optional, D-18) |
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
| E-11 | `picad` production composition | E-10, C-01, C-04, C-06, C-07, C-08, C-09, R-03, R-06, H-01, H-02, M-07 | done |
| C-01 | Model catalog and tiers | E-09 | done |
| C-02 | Agent definitions | E-04 | done |
| C-03 | Policy engine | E-04 | done |
| C-04 | Read delegation gate | C-03, E-08 | done |
| C-05 | Routing profiles | C-02, C-03 | done |
| C-06 | Output guard | C-03, E-08 | done |
| C-07 | Delegator | C-02, C-05, G0 | done |
| C-08 | Usage ledger | E-07, C-01 | done |
| C-09 | Budgets | C-08 | done |
| C-10 | Eval harness | C-04, C-05, C-06, C-07, C-08 | done |
| C-11 | Make `balanced` pass the gate | C-10 | todo (built; live gate not met 2026-11-17) |
| R-01 | Git service | F-01 | done |
| R-02 | Worktrees | R-01 | done |
| R-03 | Repo registry | E-03, R-01 | done |
| R-04 | GitHub auth | E-05 | done |
| R-05 | Team discovery | R-04 | done |
| R-06 | Workspace model | R-03, R-05 | done |
| R-07 | Session scope and sandbox | C-03, R-02 | done |
| R-08 | Cross-repo tools | R-06, R-07 | done |
| R-09 | Repo cards | R-03 | done |
| R-10 | Multi-repo change sets | R-02, R-07 | done |
| R-11 | Fan-out runs | R-06, E-08 | done |
| M-01 | MCP registry and configuration | E-04 | done |
| M-02 | MCP presets | M-01, S-06 | done |
| M-03 | Secrets and OAuth | M-01, E-05 | done |
| M-04 | Scoping and tool budgets | M-01, C-02 | done |
| M-05 | MCP permissions | C-03, M-04 | done |
| M-06 | Health and diagnostics | M-04 | done |
| M-07 | Import from other agent platforms | M-01 | done |
| A-01 | App shell and engine supervision | E-05, S-05 | done |
| A-02 | EngineClient | E-02 | done |
| A-03 | Design system | F-01 | done |
| A-04 | Navigation shell | A-01, A-02, A-03 | done |
| A-05 | Session timeline | A-04 | done |
| A-06 | Composer | A-05 | done |
| A-07 | Approvals | A-05 | done |
| A-08 | Review | A-04, R-01 | todo |
| A-09 | Files and quick open | A-04, R-08 | todo |
| A-10 | Terminal | A-04, R-02 | todo |
| A-11 | Usage and cost | A-05, C-08, C-09 | todo |
| A-12 | Workspace and repo management | A-04, R-06 | todo |
| A-13 | MCP management | A-04, M-06, M-07 | todo |
| A-14 | Settings and command palette | A-04, E-04 | todo |
| A-15 | Onboarding | A-12, A-13 | todo |
| A-16 | Session overview | A-05, R-11 | todo |
| X-01 | Themes and density | A-03, A-14 | todo |
| X-02 | Agents, skills, and rules management | C-02, A-14 | todo |
| X-03 | User hooks | C-03 | done |
| H-01 | Managed policy | E-04, C-03, M-05 | done |
| H-02 | Audit log | C-03, E-07 | done |
| H-03 | Redaction | M-03 | done |
| H-04 | Observability | E-05 | done |
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
