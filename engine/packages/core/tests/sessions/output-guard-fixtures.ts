import { PicaConfig } from "@pica/protocol";
import { defaultCommandDenyList, ok } from "../../src/index.ts";
import type { PolicyContext, PostToolUseInput, SessionArtifacts } from "../../src/index.ts";

export interface MemoryArtifacts extends SessionArtifacts {
  readonly files: Map<string, string>;
}

export function memoryArtifacts(): MemoryArtifacts {
  const files = new Map<string, string>();
  return {
    files,
    write(sessionId, name, content) {
      const path = `/artifacts/${sessionId}/${name}`;
      files.set(path, content);
      return Promise.resolve(ok({ path }));
    },
  };
}

export function guardContext(maxBytes: number, profile: "off" | "balanced" | "strict" = "balanced"): PolicyContext {
  return {
    cwd: "/work/repo",
    writeRoots: ["/work/repo"],
    referenceRoots: [],
    config: PicaConfig.parse({ routing: { profile, delegation: { output: { maxBytes } } } }),
    managed: [],
    commandDenyList: defaultCommandDenyList,
  };
}

export function postInput(content: string, overrides: Partial<PostToolUseInput> = {}): PostToolUseInput {
  return {
    sessionId: "session-1",
    toolCallId: "call-1",
    toolName: "bash",
    arguments: {},
    success: true,
    result: { content },
    ...overrides,
  };
}
