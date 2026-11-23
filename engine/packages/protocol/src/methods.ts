import * as z from "zod";
import { AbsolutePath, Count, Credits, Empty, Id, ProtocolVersion, Timestamp } from "./common.ts";
import { SessionEvent } from "./events.ts";
import { CopilotAccount } from "./dto/account.ts";
import { AgentDef } from "./dto/agents.ts";
import { ConfigLayer, ConfigValue } from "./dto/config.ts";
import { CustomizationItem, CustomizationKind, CustomizationLocation } from "./dto/customization.ts";
import { FanOut } from "./dto/fanout.ts";
import { FileEntry, QuickOpenHit } from "./dto/files.ts";
import { Branch, Commit, FileDiff, GitInstall, GitStatus } from "./dto/git.ts";
import { GitHubAuthStatus, GitHubRepo, GitHubTeam, PullRequest } from "./dto/github.ts";
import { McpAttachment, McpPreset, McpScope, McpServerDef, McpServerStatus } from "./dto/mcp.ts";
import { McpImportNote, McpImportSelection, McpImportSnippet, McpImportSource } from "./dto/mcp-import.ts";
import { ModelInfo, TierAssignment } from "./dto/models.ts";
import { ApprovalChoice, ApprovalRequest } from "./dto/policy.ts";
import { Repo, RepoCard, RepoSource, RepoSourceKind } from "./dto/repo.ts";
import { SendMode, Session, SessionModelTiers, SessionRoot } from "./dto/session.ts";
import { SavingsEstimate, UsageGroupBy, UsageRollupRow } from "./dto/usage.ts";
import { RoutingProfile, Workspace, WorkspaceOverrides } from "./dto/workspace.ts";

// `client` methods are sent by the app or CLI to the engine; `engine` methods are sent by the engine to the client.
type Direction = "client" | "engine";

interface MethodSpec {
  direction: Direction;
  params: z.ZodType;
  result: z.ZodType;
}

function clientMethod<P extends z.ZodType, R extends z.ZodType>(
  params: P,
  result: R,
): { direction: "client"; params: P; result: R } {
  return { direction: "client", params, result };
}

export const ById = z.object({ id: Id });
export const BySession = z.object({ sessionId: Id });
export const ByRepo = z.object({ repoId: Id });
export const ByWorktree = z.object({ sessionId: Id, repoId: Id });
export const Ok = z.object({ ok: z.literal(true) });

export const methods = {
  "engine.hello": clientMethod(
    z.object({
      protocolVersion: ProtocolVersion,
      client: z.object({ name: z.string().min(1), version: z.string().min(1) }),
    }),
    z.object({ protocolVersion: ProtocolVersion, engineVersion: z.string().min(1) }),
  ),
  "engine.health": clientMethod(
    Empty,
    z.object({
      status: z.enum(["ok", "degraded"]),
      uptimeMs: Count,
      sessionsRunning: Count,
      // H-05: set when this engine found its database damaged, moved it to `backupPath` and started empty.
      storeRecovery: z.object({ backupPath: AbsolutePath, reason: z.string(), at: Timestamp }).optional(),
    }),
  ),

  "workspace.list": clientMethod(Empty, z.object({ workspaces: z.array(Workspace) })),
  "workspace.get": clientMethod(ById, z.object({ workspace: Workspace })),
  "workspace.create": clientMethod(z.object({ name: z.string().min(1) }), z.object({ workspace: Workspace })),
  "workspace.update": clientMethod(
    z.object({ id: Id, name: z.string().min(1).optional(), overrides: WorkspaceOverrides.optional() }),
    z.object({ workspace: Workspace }),
  ),
  // Refused (`invalid_state`, reason `workspace.sessions_busy`, with `sessionIds`) while a session is
  // starting, running or waiting for an approval. Otherwise ends its idle sessions, deletes the workspace
  // with all its sessions, their events and usage, and broadcasts `workspace.deleted`. Repos stay
  // registered and nothing on disk is deleted.
  "workspace.delete": clientMethod(ById, Ok),
  "workspace.addSource": clientMethod(
    z.object({
      workspaceId: Id,
      kind: RepoSourceKind,
      org: z.string().min(1).optional(),
      selector: z.string().min(1).optional(),
    }),
    z.object({ source: RepoSource }),
  ),
  "workspace.removeSource": clientMethod(z.object({ workspaceId: Id, sourceId: Id }), Ok),
  "workspace.pinRepo": clientMethod(z.object({ workspaceId: Id, repoId: Id }), Ok),
  "workspace.unpinRepo": clientMethod(z.object({ workspaceId: Id, repoId: Id }), Ok),
  // Unpins the repo and makes every source that listed it leave it out on later syncs. Nothing on disk changes.
  "workspace.removeRepo": clientMethod(z.object({ workspaceId: Id, repoId: Id }), Ok),
  "workspace.sync": clientMethod(
    z.object({ workspaceId: Id }),
    z.object({ added: z.array(Id), removed: z.array(Id) }),
  ),

  "repo.list": clientMethod(z.object({ workspaceId: Id.optional() }), z.object({ repos: z.array(Repo) })),
  "repo.get": clientMethod(ById, z.object({ repo: Repo })),
  "repo.addPath": clientMethod(z.object({ path: AbsolutePath }), z.object({ repo: Repo })),
  "repo.addUrl": clientMethod(z.object({ url: z.string().min(1) }), z.object({ repo: Repo })),
  "repo.remove": clientMethod(z.object({ id: Id, force: z.boolean() }), Ok),
  "repo.card": clientMethod(ById, z.object({ card: RepoCard })),

  // A-12: `host` defaults to the GitHub host the engine is configured for.
  "github.authStatus": clientMethod(z.object({ host: z.string().min(1).optional() }), GitHubAuthStatus),
  "github.listTeams": clientMethod(
    z.object({ host: z.string().min(1).optional() }),
    z.object({ teams: z.array(GitHubTeam) }),
  ),
  "github.listTeamRepos": clientMethod(
    z.object({ host: z.string().min(1).optional(), org: z.string().min(1), teamSlug: z.string().min(1) }),
    z.object({ repos: z.array(GitHubRepo) }),
  ),
  // A-08: opens a pull request from the worktree's current branch, which must be pushed.
  "github.createPullRequest": clientMethod(
    z.object({
      sessionId: Id,
      repoId: Id,
      title: z.string().min(1),
      body: z.string(),
      base: z.string().min(1).optional(),
      draft: z.boolean().optional(),
    }),
    z.object({ pullRequest: PullRequest }),
  ),

  "session.create": clientMethod(
    z.object({
      workspaceId: Id,
      writeRepoIds: z.array(Id),
      referenceRepoIds: z.array(Id),
      routingProfile: RoutingProfile.optional(),
      modelTiers: SessionModelTiers.optional(),
      budgetCredits: Credits.optional(),
      prompt: z.string().optional(),
    }),
    z.object({ session: Session }),
  ),
  "session.list": clientMethod(z.object({ workspaceId: Id.optional() }), z.object({ sessions: z.array(Session) })),
  "session.get": clientMethod(BySession, z.object({ session: Session })),
  // A-10: write roots first, the first being where the session's agent runs.
  "session.roots": clientMethod(BySession, z.object({ roots: z.array(SessionRoot) })),
  "session.send": clientMethod(
    z.object({ sessionId: Id, text: z.string().min(1), mode: SendMode }),
    z.object({ accepted: z.boolean() }),
  ),
  "session.abort": clientMethod(BySession, Ok),
  "session.resume": clientMethod(BySession, z.object({ session: Session })),
  "session.end": clientMethod(BySession, Ok),
  // A user title, trimmed; an empty one clears it so the session falls back to its automatic title.
  "session.rename": clientMethod(
    z.object({ sessionId: Id, title: z.string().max(200) }),
    z.object({ session: Session }),
  ),
  // Changes the session's routing profile and, when `modelTiers` is given, replaces its per-tier models
  // (`{}` returns both tiers to `routing.tiers`). Allowed while the session is idle (its runtime is
  // reopened, so the next turn uses the change; the conversation continues, the prompt cache does not)
  // or resumable (applied when it resumes); refused with `invalid_state` otherwise, and with
  // `policy_denied` for a value managed policy locks.
  "session.setRouting": clientMethod(
    z.object({ sessionId: Id, routingProfile: RoutingProfile.optional(), modelTiers: SessionModelTiers.optional() }),
    z.object({ session: Session }),
  ),
  // Ends the session first when it is live (a running turn is stopped), then removes its events,
  // approvals, MCP attachments and engine-owned files. Its usage records stay, so spend totals and
  // the daily cap are unchanged. Announced by `session.deleted`.
  "session.delete": clientMethod(BySession, Ok),

  "fanout.start": clientMethod(
    z.object({
      workspaceId: Id,
      repoIds: z.array(Id).min(1),
      prompt: z.string().min(1),
      concurrency: z.int().min(1).max(16).optional(),
      referenceRepoIds: z.array(Id).optional(),
      routingProfile: RoutingProfile.optional(),
      budgetCredits: Credits.optional(),
    }),
    z.object({ fanOut: FanOut }),
  ),
  "fanout.get": clientMethod(z.object({ fanOutId: Id }), z.object({ fanOut: FanOut })),
  "fanout.list": clientMethod(z.object({ workspaceId: Id.optional() }), z.object({ fanOuts: z.array(FanOut) })),
  "fanout.cancel": clientMethod(z.object({ fanOutId: Id }), z.object({ fanOut: FanOut })),

  "events.subscribe": clientMethod(
    z.object({ sessionId: Id, afterSeq: z.int().nonnegative() }),
    z.object({ subscriptionId: Id, lastSeq: z.int().nonnegative() }),
  ),
  "events.unsubscribe": clientMethod(z.object({ subscriptionId: Id }), Ok),

  "approval.list": clientMethod(BySession, z.object({ approvals: z.array(ApprovalRequest) })),
  "approval.resolve": clientMethod(
    z.object({ approvalId: Id, choice: ApprovalChoice, budgetCredits: Credits.optional() }),
    Ok,
  ),

  "git.status": clientMethod(ByWorktree, z.object({ status: GitStatus })),
  "git.diff": clientMethod(
    z.object({ sessionId: Id, repoId: Id, staged: z.boolean(), paths: z.array(z.string()).optional() }),
    z.object({ files: z.array(FileDiff) }),
  ),
  "git.stage": clientMethod(
    z.object({ sessionId: Id, repoId: Id, path: z.string().min(1), hunkIndexes: z.array(Count).optional() }),
    Ok,
  ),
  "git.unstage": clientMethod(
    z.object({ sessionId: Id, repoId: Id, path: z.string().min(1), hunkIndexes: z.array(Count).optional() }),
    Ok,
  ),
  "git.discard": clientMethod(
    z.object({ sessionId: Id, repoId: Id, path: z.string().min(1), hunkIndexes: z.array(Count).optional() }),
    Ok,
  ),
  "git.commit": clientMethod(
    z.object({ sessionId: Id, repoId: Id, message: z.string().min(1) }),
    z.object({ commit: Commit }),
  ),
  "git.push": clientMethod(ByWorktree, Ok),
  "git.branches": clientMethod(ByRepo, z.object({ branches: z.array(Branch) })),
  "git.log": clientMethod(
    z.object({ repoId: Id, ref: z.string().min(1).optional(), limit: z.int().positive() }),
    z.object({ commits: z.array(Commit) }),
  ),

  "files.list": clientMethod(
    z.object({ repoId: Id, directory: z.string() }),
    z.object({ entries: z.array(FileEntry) }),
  ),
  "files.read": clientMethod(
    z.object({ repoId: Id, path: z.string().min(1) }),
    z.object({ text: z.string(), truncated: z.boolean(), sizeBytes: Count }),
  ),
  "files.quickOpen": clientMethod(
    z.object({ workspaceId: Id, query: z.string(), limit: z.int().positive() }),
    z.object({ hits: z.array(QuickOpenHit) }),
  ),

  // A-13: global servers, and the workspace's own over them when `workspaceId` is given.
  "mcp.list": clientMethod(
    z.object({ workspaceId: Id.optional() }),
    z.object({ servers: z.array(McpServerDef) }),
  ),
  // Writes `server` into `mcp.jsonc` at its scope: `global`, or `workspace` with `workspaceId`.
  // Repo-scope servers live in the repo's own files and are edited there.
  "mcp.add": clientMethod(
    z.object({ server: McpServerDef, workspaceId: Id.optional() }),
    z.object({ server: McpServerDef }),
  ),
  "mcp.update": clientMethod(
    z.object({ server: McpServerDef, workspaceId: Id.optional() }),
    z.object({ server: McpServerDef }),
  ),
  // Removes the server from the workspace's file when `workspaceId` is given, else from the global
  // one, and detaches it everywhere it was attached.
  "mcp.remove": clientMethod(z.object({ id: Id, workspaceId: Id.optional() }), Ok),
  // Exactly one of `sessionId` and `workspaceId`. Changing a live session's servers resets its
  // prompt cache (PLAN.md §5.5), so it is refused with `mcp.cache_reset_unconfirmed` unless
  // `acknowledgeCacheReset` is true; the session's runtime is then reopened with the new servers.
  "mcp.attach": clientMethod(
    z.object({
      serverId: Id,
      sessionId: Id.optional(),
      workspaceId: Id.optional(),
      agent: z.string().min(1).optional(),
      acknowledgeCacheReset: z.boolean().optional(),
    }),
    z.object({ toolDefinitionTokens: Count.nullable() }),
  ),
  "mcp.detach": clientMethod(
    z.object({
      serverId: Id,
      sessionId: Id.optional(),
      workspaceId: Id.optional(),
      agent: z.string().min(1).optional(),
      acknowledgeCacheReset: z.boolean().optional(),
    }),
    Ok,
  ),
  // What is attached to one session or workspace, and the tool-definition tokens it adds to each
  // prompt; null while a server's tool list is unknown.
  "mcp.attachments": clientMethod(
    z.object({ sessionId: Id.optional(), workspaceId: Id.optional() }),
    z.object({ attachments: z.array(McpAttachment), toolDefinitionTokens: Count.nullable() }),
  ),
  "mcp.status": clientMethod(ById, z.object({ status: McpServerStatus })),
  "mcp.statusList": clientMethod(Empty, z.object({ statuses: z.array(McpServerStatus) })),
  "mcp.restart": clientMethod(ById, Ok),
  "mcp.login": clientMethod(ById, Ok),
  // M-07: servers found in other agent platforms' files, or in `snippet` when one is given.
  "mcp.importCandidates": clientMethod(
    z.object({ repoId: Id.optional(), snippet: McpImportSnippet.optional() }),
    z.object({ sources: z.array(McpImportSource) }),
  ),
  // Copies the chosen candidates, or every server in `snippet`, into `mcp.jsonc` at `scope`. Exactly
  // one of `candidates` and `snippet`. `workspace` needs `workspaceId`; `repo` needs `repoId`. Pass
  // the `repoId` the candidates were listed with, whatever the scope, so project files are read again.
  // Inline secrets go to the Keychain through `secrets.set`. Nothing is attached to a session.
  "mcp.import": clientMethod(
    z.object({
      scope: McpScope,
      workspaceId: Id.optional(),
      repoId: Id.optional(),
      candidates: z.array(McpImportSelection).optional(),
      snippet: McpImportSnippet.optional(),
    }),
    z.object({
      servers: z.array(McpServerDef),
      file: AbsolutePath,
      secretRefs: z.array(z.string().min(1)),
      notes: z.array(McpImportNote),
    }),
  ),
  // M-02: optional presets (D-18). Rendering returns a definition; it adds or attaches nothing.
  "mcp.presets": clientMethod(Empty, z.object({ presets: z.array(McpPreset) })),
  "mcp.renderPreset": clientMethod(
    z.object({
      presetId: Id,
      parameters: z.record(z.string(), z.string()),
      serverId: Id.optional(),
      scope: McpScope.optional(),
    }),
    z.object({ server: McpServerDef }),
  ),

  "agents.list": clientMethod(
    z.object({ workspaceId: Id.optional(), repoId: Id.optional() }),
    z.object({ agents: z.array(AgentDef) }),
  ),

  // X-02: agents, skills and instruction files from every layer (docs/agents.md). A repo's
  // locations need its workspace, so `repoId` is read only with `workspaceId`.
  "customization.list": clientMethod(
    z.object({ kind: CustomizationKind, workspaceId: Id.optional(), repoId: Id.optional() }),
    z.object({ items: z.array(CustomizationItem), locations: z.array(CustomizationLocation) }),
  ),
  // `name` is left out for a single-file location. The text is validated before it is written.
  "customization.create": clientMethod(
    z.object({
      kind: CustomizationKind,
      locationId: Id,
      name: z.string().min(1).optional(),
      text: z.string(),
      workspaceId: Id.optional(),
      repoId: Id.optional(),
    }),
    z.object({ item: CustomizationItem }),
  ),
  // `path` is an item `customization.list` returns for the same kind and scope.
  "customization.save": clientMethod(
    z.object({ kind: CustomizationKind, path: AbsolutePath, text: z.string(), workspaceId: Id.optional(), repoId: Id.optional() }),
    z.object({ item: CustomizationItem }),
  ),
  "customization.delete": clientMethod(
    z.object({ kind: CustomizationKind, path: AbsolutePath, workspaceId: Id.optional(), repoId: Id.optional() }),
    Ok,
  ),

  "engine.account": clientMethod(Empty, z.object({ account: CopilotAccount })),
  "engine.git": clientMethod(Empty, z.object({ git: GitInstall })),

  "models.list": clientMethod(
    Empty,
    z.object({ models: z.array(ModelInfo), fetchedAt: Timestamp }),
  ),
  "models.tiers": clientMethod(Empty, z.object({ tiers: z.array(TierAssignment) })),

  // `from` is inclusive and `to` exclusive; `day` groups by UTC calendar day.
  "usage.rollup": clientMethod(
    z.object({
      groupBy: UsageGroupBy,
      from: Timestamp.optional(),
      to: Timestamp.optional(),
      workspaceId: Id.optional(),
      sessionId: Id.optional(),
    }),
    z.object({ rows: z.array(UsageRollupRow), savings: SavingsEstimate }),
  ),

  "config.get": clientMethod(
    z.object({ keyPath: z.string().min(1), workspaceId: Id.optional(), repoId: Id.optional() }),
    z.object({ value: ConfigValue }),
  ),
  "config.set": clientMethod(
    z.object({
      keyPath: z.string().min(1),
      value: z.unknown(),
      layer: ConfigLayer.exclude(["default", "managed"]),
      workspaceId: Id.optional(),
      repoId: Id.optional(),
    }),
    Ok,
  ),

  "secrets.get": {
    direction: "engine",
    params: z.object({ secretRef: z.string().min(1) }),
    result: z.object({ value: z.string() }),
  },
  // M-07: stores a secret the engine moved out of an imported MCP entry, under its reference text.
  "secrets.set": {
    direction: "engine",
    params: z.object({ secretRef: z.string().min(1), value: z.string().min(1) }),
    result: Ok,
  },
} as const satisfies Record<string, MethodSpec>;

export type MethodName = keyof typeof methods;
export const methodNames = Object.keys(methods) as MethodName[];

export const NAMESPACES = [
  "engine",
  "workspace",
  "repo",
  "github",
  "session",
  "fanout",
  "events",
  "approval",
  "git",
  "files",
  "mcp",
  "agents",
  // X-02: agents, skills and instruction files across layers (docs/agents.md).
  "customization",
  "models",
  "usage",
  "config",
  "secrets",
] as const;

export const notifications = {
  "events.event": z.object({ subscriptionId: Id, event: SessionEvent }),
  "session.changed": z.object({ session: Session }),
  "session.deleted": z.object({ sessionId: Id }),
  "workspace.changed": z.object({ workspace: Workspace }),
  // `workspace.delete` removed the workspace and its sessions.
  "workspace.deleted": z.object({ id: Id }),
  "fanout.changed": z.object({ fanOut: FanOut }),
  "mcp.statusChanged": z.object({ status: McpServerStatus }),
  "engine.warning": z.object({ code: z.string().min(1), message: z.string(), at: Timestamp }),
} as const;

export type NotificationName = keyof typeof notifications;
export const notificationNames = Object.keys(notifications) as NotificationName[];
