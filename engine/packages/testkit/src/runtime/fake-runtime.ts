import {
  err,
  ok,
  type AgentRuntime,
  type QuotaInfo,
  type ResumeOptions,
  type RuntimeEvent,
  type RuntimeModel,
  type RuntimeResult,
  type RuntimeSession,
  type SessionOptions,
} from "@pica/core";
import { sequentialIds, steppingClock, type Clock, type IdSource } from "./deterministic.ts";
import { FakeSession } from "./fake-session.ts";
import type { Scenario } from "./scenario-schema.ts";

export interface FakeRuntimeOptions {
  readonly scenario: Scenario;
  readonly clock?: Clock;
  readonly ids?: IdSource;
}

// An `AgentRuntime` that plays a scenario. Every session plays the scenario's turns from the
// first. `eventLog` holds every event from every session in emission order.
export class FakeRuntime implements AgentRuntime {
  readonly #scenario: Scenario;
  readonly #clock: Clock;
  readonly #ids: IdSource;
  readonly #sessions = new Map<string, FakeSession>();
  readonly #log: RuntimeEvent[] = [];

  constructor(options: FakeRuntimeOptions) {
    this.#scenario = options.scenario;
    this.#clock = options.clock ?? steppingClock();
    this.#ids = options.ids ?? sequentialIds();
  }

  eventLog(): readonly RuntimeEvent[] {
    return [...this.#log];
  }

  listModels(): RuntimeResult<readonly RuntimeModel[]> {
    return Promise.resolve(ok(this.#scenario.models.map(toRuntimeModel)));
  }

  quota(): RuntimeResult<QuotaInfo> {
    return Promise.resolve(ok({ ...this.#scenario.quota }));
  }

  createSession(options: SessionOptions): RuntimeResult<RuntimeSession> {
    const model = options.model ?? this.#scenario.defaultModel;
    if (!this.#scenario.models.some((entry) => entry.id === model)) {
      return Promise.resolve(err({ code: "runtime.model_unavailable", message: `model "${model}" is not available` }));
    }
    const id = this.#ids("session");
    const session = new FakeSession(
      { id, scenario: this.#scenario, clock: this.#clock, ids: this.#ids, record: (event) => this.#log.push(event) },
      options.hooks ?? {},
    );
    this.#sessions.set(id, session);
    session.emit("session.start", { sessionId: id, model, workingDirectory: options.workingDirectory });
    return Promise.resolve(ok(session));
  }

  resumeSession(options: ResumeOptions): RuntimeResult<RuntimeSession> {
    const session = this.#sessions.get(options.sessionId);
    if (session === undefined) {
      return Promise.resolve(
        err({ code: "runtime.session_not_found", message: `no session with id ${options.sessionId}` }),
      );
    }
    session.reopen(options.hooks ?? {});
    return Promise.resolve(ok(session));
  }
}

function toRuntimeModel(model: Scenario["models"][number]): RuntimeModel {
  return {
    id: model.id,
    name: model.name,
    ...(model.tokenPrices === undefined ? {} : { tokenPrices: model.tokenPrices }),
    ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
  };
}
