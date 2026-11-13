import * as z from "zod";
import { AbsolutePath, Count, Credits, Empty, Id, ProtocolVersion, Timestamp } from "./common.ts";
import { SessionEvent } from "./events.ts";
import { AgentDef } from "./dto/agents.ts";
import { ConfigLayer, ConfigValue } from "./dto/config.ts";
import { FileEntry, QuickOpenHit } from "./dto/files.ts";
import { Branch, Commit, FileDiff, GitStatus } from "./dto/git.ts";
import { GitHubAuthStatus, GitHubRepo, GitHubTeam } from "./dto/github.ts";
import { McpServerDef, McpServerStatus } from "./dto/mcp.ts";
import { ModelInfo, TierAssignment } from "./dto/models.ts";
import { ApprovalChoice, ApprovalRequest } from "./dto/policy.ts";
import { Repo, RepoCard, RepoSource, RepoSourceKind } from "./dto/repo.ts";
import { SendMode, Session } from "./dto/session.ts";
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
    z.object({ status: z.enum(["ok", "degraded"]), uptimeMs: Count, sessionsRunning: Count }),
  ),

  "workspace.list": clientMethod(Empty, z.object({ workspaces: z.array(Workspace) })),
  "workspace.get": clientMethod(ById, z.object({ workspace: Workspace })),
  "workspace.create": clientMethod(z.object({ name: z.string().min(1) }), z.object({ workspace: Workspace })),
  "workspace.update": clientMethod(
    z.object({ id: Id, name: z.string().min(1).optional(), overrides: WorkspaceOverrides.optional() }),
    z.object({ workspace: Workspace }),
  ),
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

  "github.authStatus": clientMethod(z.object({ host: z.string().min(1) }), GitHubAuthStatus),
  "github.listTeams": clientMethod(
    z.object({ host: z.string().min(1) }),
    z.object({ teams: z.array(GitHubTeam) }),
  ),
  "github.listTeamRepos": clientMethod(
    z.object({ host: z.string().min(1), org: z.string().min(1), teamSlug: z.string().min(1) }),
    z.object({ repos: z.array(GitHubRepo) }),
  ),

  "session.create": clientMethod(
    z.object({
      workspaceId: Id,
      writeRepoIds: z.array(Id),
      referenceRepoIds: z.array(Id),
      routingProfile: RoutingProfile.optional(),
      budgetCredits: Credits.optional(),
      prompt: z.string().optional(),
    }),
    z.object({ session: Session }),
  ),
  "session.list": clientMethod(z.object({ workspaceId: Id.optional() }), z.object({ sessions: z.array(Session) })),
  "session.get": clientMethod(BySession, z.object({ session: Session })),
  "session.send": clientMethod(
    z.object({ sessionId: Id, text: z.string().min(1), mode: SendMode }),
    z.object({ accepted: z.boolean() }),
  ),
  "session.abort": clientMethod(BySession, Ok),
  "session.resume": clientMethod(BySession, z.object({ session: Session })),
  "session.end": clientMethod(BySession, Ok),

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

  "mcp.list": clientMethod(
    z.object({ workspaceId: Id.optional() }),
    z.object({ servers: z.array(McpServerDef) }),
  ),
  "mcp.add": clientMethod(z.object({ server: McpServerDef }), z.object({ server: McpServerDef })),
  "mcp.update": clientMethod(z.object({ server: McpServerDef }), z.object({ server: McpServerDef })),
  "mcp.remove": clientMethod(ById, Ok),
  "mcp.attach": clientMethod(
    z.object({ serverId: Id, sessionId: Id, agent: z.string().min(1).optional() }),
    z.object({ toolDefinitionTokens: Count }),
  ),
  "mcp.detach": clientMethod(z.object({ serverId: Id, sessionId: Id }), Ok),
  "mcp.status": clientMethod(ById, z.object({ status: McpServerStatus })),
  "mcp.login": clientMethod(ById, Ok),

  "agents.list": clientMethod(
    z.object({ workspaceId: Id.optional(), repoId: Id.optional() }),
    z.object({ agents: z.array(AgentDef) }),
  ),

  "models.list": clientMethod(
    Empty,
    z.object({ models: z.array(ModelInfo), fetchedAt: Timestamp }),
  ),
  "models.tiers": clientMethod(Empty, z.object({ tiers: z.array(TierAssignment) })),

  "usage.rollup": clientMethod(
    z.object({ groupBy: UsageGroupBy, from: Timestamp, to: Timestamp, workspaceId: Id.optional() }),
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
} as const satisfies Record<string, MethodSpec>;

export type MethodName = keyof typeof methods;
export const methodNames = Object.keys(methods) as MethodName[];

export const NAMESPACES = [
  "engine",
  "workspace",
  "repo",
  "github",
  "session",
  "events",
  "approval",
  "git",
  "files",
  "mcp",
  "agents",
  "models",
  "usage",
  "config",
  "secrets",
] as const;

export const notifications = {
  "events.event": z.object({ subscriptionId: Id, event: SessionEvent }),
  "session.changed": z.object({ session: Session }),
  "workspace.changed": z.object({ workspace: Workspace }),
  "mcp.statusChanged": z.object({ status: McpServerStatus }),
  "engine.warning": z.object({ code: z.string().min(1), message: z.string(), at: Timestamp }),
} as const;

export type NotificationName = keyof typeof notifications;
export const notificationNames = Object.keys(notifications) as NotificationName[];
