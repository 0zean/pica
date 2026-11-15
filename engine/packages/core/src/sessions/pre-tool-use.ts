import { toolKind } from "../agents/index.ts";
import type { JsonObject, JsonValue } from "../json.ts";
import { decide, defaultCommandDenyList, mainAgent } from "../policy/index.ts";
import type {
  CommandRule,
  LineRange,
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

interface ReadArguments {
  readonly path: string;
  readonly range?: LineRange;
}

// PLAN.md §5.3 large-read gate. Only read tools are decided here; every other call is allowed.
export function createReadGate(deps: ReadGateDeps): (sessionId: string) => RuntimeHooks {
  return (sessionId) => ({ onPreToolUse: (input) => gateRead(deps, sessionId, input) });
}

async function gateRead(deps: ReadGateDeps, sessionId: string, input: ToolUseInput): Promise<PreToolUseDecision> {
  const read = toolKind(input.toolName) === "read" ? readArguments(input.arguments) : undefined;
  if (read === undefined) {
    return { decision: "allow" };
  }
  const session = deps.sessions.get(sessionId);
  if (!session.ok) {
    return { decision: "deny", reason: `session ${sessionId} is unknown to the engine` };
  }
  const context = policyContext(deps, session.value);
  const sizeBytes = (await deps.fileSize(resolvePath(context.cwd, read.path))) ?? 0;
  const call: ToolCall = {
    id: input.toolCallId,
    tool: input.toolName,
    agent: input.agentId ?? mainAgent,
    target: { kind: "read", path: read.path, sizeBytes, ...(read.range === undefined ? {} : { range: read.range }) },
  };
  const decision = decide(call, deps.realPath === undefined ? context : await withRealPaths(call, context, deps.realPath));
  deps.onDecision?.(sessionId, decision);
  switch (decision.outcome) {
    case "deny":
      return { decision: "deny", reason: decision.reason };
    case "ask":
      return { decision: "ask", reason: decision.reason };
    default:
      return { decision: "allow" };
  }
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

// `view` takes `path` and `view_range: [start, end]`, with -1 meaning end of file (confirmed by S-02).
function readArguments(args: JsonValue): ReadArguments | undefined {
  if (!isJsonObject(args)) {
    return undefined;
  }
  const { path, view_range: viewRange } = args;
  if (typeof path !== "string" || path === "") {
    return undefined;
  }
  const range = lineRange(viewRange);
  return range === undefined ? { path } : { path, range };
}

function lineRange(value: JsonValue | undefined): LineRange | undefined {
  if (!isJsonArray(value) || value.length !== 2) {
    return undefined;
  }
  const [startLine, endLine] = value;
  if (!isLineNumber(startLine) || !isLineNumber(endLine) || endLine === -1) {
    return undefined;
  }
  return { startLine, endLine };
}

function isLineNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonArray(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}
