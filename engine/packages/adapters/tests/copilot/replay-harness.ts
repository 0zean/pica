import { RuntimeConnection } from "@github/copilot-sdk";
import {
  copilotTranscriptPath,
  formatScenarioError,
  loadTranscriptFile,
  sequentialIds,
  startReplayServer,
  type ContractFixture,
  type ReplayServer,
  type RuntimeContractHarness,
} from "@pica/testkit";
import { CopilotRuntime } from "../../src/index.ts";

export interface ReplayRuntime {
  readonly runtime: CopilotRuntime;
  readonly server: ReplayServer;
}

// Starts a replay server for the named transcript and connects a CopilotRuntime to it.
// Callers stop both with `stopReplays` when their tests finish.
export class ReplayRuntimes {
  private readonly started: ReplayRuntime[] = [];

  async start(transcript: string): Promise<ReplayRuntime> {
    const loaded = loadTranscriptFile(copilotTranscriptPath(transcript));
    if (!loaded.ok) {
      throw new Error(formatScenarioError(loaded.error));
    }
    const server = await startReplayServer(loaded.value);
    const ids = sequentialIds();
    const runtime = new CopilotRuntime({
      client: { connection: RuntimeConnection.forUri(server.url) },
      sessionIds: () => ids("session"),
    });
    const replay = { runtime, server };
    this.started.push(replay);
    return replay;
  }

  async stopAll(): Promise<void> {
    const started = this.started.splice(0);
    await Promise.all(started.map(async ({ runtime, server }) => {
      await runtime.stop();
      await server.close();
    }));
  }

  harness(): RuntimeContractHarness {
    return {
      name: "CopilotRuntime over the replay server",
      workingDirectory: "/contract/repo",
      createRuntime: async (fixture: ContractFixture) => (await this.start(fixture)).runtime,
    };
  }
}
