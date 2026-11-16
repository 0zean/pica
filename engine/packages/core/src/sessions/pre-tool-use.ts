import { toolKind } from "../agents/index.ts";
import { decide, defaultCommandDenyList, mainAgent, shellWriteRule } from "../policy/index.ts";
import type {
  CommandRule,
  ManagedRule,
  PolicyConfig,
  PolicyContext,
  PolicyDecision,
  ToolCall,
} from "../policy/index.ts";
import { resolvePath } from "../policy/paths.ts";
import type { PreToolUseDecision, RuntimeHooks, ToolUseInput } from "../runtime/index.ts";
import { withRealPaths, type RealPathResolver } from "../sandbox/index.ts";
import type { Session, Store } from "../store/index.ts";
import { isRoutingProfile } from "./info.ts";
import { readRequests, shellCommand, type ReadRequest } from "./read-requests.ts";

const readingKinds = new Set(["read", "search", "shell"]);

export interface ReadGateDeps {
  readonly sessions: Pick<Store["sessions"], "get">;
  // Called on every read, so a config change applies to running sessions.
  readonly config: () => PolicyConfig;
  // Bytes, or `undefined` when the path is not a readable file (the tool reports that itself).
  readonly fileSize: (path: string) => Promise<number | undefined>;
  readonly managed?: readonly ManagedRule[];
  readonly commandDenyList?: readonly CommandRule[];
  // Without it paths are judged lexically and a symlink can lead out of the roots (R-07).
  readonly realPath?: RealPathResolver;
  // H-02: receives every decision made, to emit as an event and write to the audit log.
  readonly onDecision?: (sessionId: string, decision: PolicyDecision) => void;
}

// PLAN.md §5.3 large-read gate. Only the reads a call makes are decided here: `view`, content
// searches, and whole-file prints in shell commands. A shell command is also checked by the
// shell-write cost gate (`cost.shell-write`). Every other call is allowed.
export function createReadGate(deps: ReadGateDeps): (sessionId: string) => RuntimeHooks {
  return (sessionId) => ({ onPreToolUse: (input) => gateRead(deps, sessionId, input) });
}

async function gateRead(deps: ReadGateDeps, sessionId: string, input: ToolUseInput): Promise<PreToolUseDecision> {
  if (!readingKinds.has(toolKind(input.toolName) ?? "other")) {
    return { decision: "allow" };
  }
  const session = deps.sessions.get(sessionId);
  if (!session.ok) {
    return { decision: "deny", reason: `session ${sessionId} is unknown to the engine` };
  }
  const context = policyContext(deps, session.value);
  const shellWrite = await decideShellWrite(deps, context, input);
  if (shellWrite !== undefined) {
    deps.onDecision?.(sessionId, shellWrite);
    return { decision: "deny", reason: shellWrite.reason };
  }
  for (const read of readRequests(input.toolName, input.arguments, context.cwd)) {
    const decision = await decideRead(deps, context, input, read);
    deps.onDecision?.(sessionId, decision);
    if (decision.outcome === "deny" || decision.outcome === "ask") {
      return { decision: decision.outcome, reason: decision.reason };
    }
  }
  return { decision: "allow" };
}

async function decideRead(
  deps: ReadGateDeps,
  context: PolicyContext,
  input: ToolUseInput,
  read: ReadRequest,
): Promise<PolicyDecision> {
  const sizeBytes = read.sized ? ((await deps.fileSize(resolvePath(context.cwd, read.path))) ?? 0) : 0;
  const { path, range, force } = read;
  const call: ToolCall = {
    id: input.toolCallId,
    tool: input.toolName,
    agent: callingAgent(input),
    target: { kind: "read", path, sizeBytes, ...(range === undefined ? {} : { range }), ...(force === undefined ? {} : { force }) },
  };
  return decide(call, deps.realPath === undefined ? context : await withRealPaths(call, context, deps.realPath));
}

// Only the shell-write rule, not the whole policy: the read gate decides cost gates, and the shell
// scope and permission rules are applied by the runtime's own permission flow.
async function decideShellWrite(deps: ReadGateDeps, context: PolicyContext, input: ToolUseInput): Promise<PolicyDecision | undefined> {
  const command = shellCommand(input.toolName, input.arguments);
  if (command === undefined) {
    return undefined;
  }
  const call: ToolCall = { id: input.toolCallId, tool: input.toolName, agent: callingAgent(input), target: { kind: "shell", command, cwd: context.cwd } };
  return shellWriteRule(call, deps.realPath === undefined ? context : await withRealPaths(call, context, deps.realPath));
}

// A sub-agent's calls carry `agentId` (a UUID) and `agentType`, its name (S-02). Policy rules name
// agents, so the name is used; a call without `agentId` is the main agent's whatever else it carries.
function callingAgent(input: ToolUseInput): string {
  return input.agentId === undefined ? mainAgent : (input.agentType ?? input.agentId);
}

// The session's own routing profile, chosen at creation, takes the place of the configured one.
function policyContext(deps: ReadGateDeps, session: Session): PolicyContext {
  const config = deps.config();
  const profile = isRoutingProfile(session.routingProfile) ? session.routingProfile : config.routing.profile;
  return {
    cwd: session.writeRoots[0] ?? session.referenceRoots[0] ?? "/",
    writeRoots: session.writeRoots,
    referenceRoots: session.referenceRoots,
    config: { ...config, routing: { ...config.routing, profile } },
    managed: deps.managed ?? [],
    commandDenyList: deps.commandDenyList ?? defaultCommandDenyList,
  };
}
