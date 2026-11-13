import type { AgentDef } from "@pica/protocol";
import type { Result } from "../result.ts";
import type { AgentError } from "./errors.ts";

export interface AgentLoader {
  load(): Result<readonly AgentDef[], AgentError>;
}
