import {
  err,
  ok,
  type AgentRuntime,
  type QuotaInfo,
  type ResumeOptions,
  type RuntimeError,
  type RuntimeEvent,
  type RuntimeModel,
  type RuntimeResult,
  type RuntimeSession,
  type SessionOptions,
} from "@pica/core";
import { sequentialIds, steppingClock, type Clock, type IdSource } from "./deterministic.ts";
import { FakeSession, type FakeSessionOptions } from "./fake-session.ts";
import type { Scenario } from "./scenario-schema.ts";

export interface FakeRuntimeOptions {
  readonly scenario: Scenario;
  readonly clock?: Clock;
  readonly ids?: IdSource;
  // Sessions an earlier runtime process created. `resumeSession` adopts them, playing this
  // scenario's turns from the first, as a runtime restarted against a persisted session would.
  readonly resumableSessionIds?: readonly string[];
  // Refuse a lower `maxAiCredits`, as Copilot does below 30 (S-03).
  readonly minSessionCredits?: number | undefined;
}

// An `AgentRuntime` that plays a scenario. Every session plays the scenario's turns from the
// first. `eventLog` holds every event from every session in emission order.
export class FakeRuntime implements AgentRuntime {
  readonly #scenario: Scenario;
  readonly #clock: Clock;
  readonly #ids: IdSource;
  readonly #sessions = new Map<string, FakeSession>();
  readonly #log: RuntimeEvent[] = [];
  readonly #options = new Map<string, SessionOptions>();
  readonly #resumable: ReadonlySet<string>;
  readonly minSessionCredits: number | undefined;

  constructor(options: FakeRuntimeOptions) {
    this.#scenario = options.scenario;
    this.#clock = options.clock ?? steppingClock();
    this.#ids = options.ids ?? sequentialIds();
    this.#resumable = new Set(options.resumableSessionIds ?? []);
    this.minSessionCredits = options.minSessionCredits;
  }

  eventLog(): readonly RuntimeEvent[] {
    return [...this.#log];
  }

  // The options the session was last created or resumed with.
  sessionOptions(sessionId: string): SessionOptions | undefined {
    return this.#options.get(sessionId);
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
    const belowFloor = this.#belowFloor(options);
    if (belowFloor !== undefined) {
      return Promise.resolve(err(belowFloor));
    }
    const id = options.sessionId ?? this.#ids("session");
    if (this.#sessions.has(id) || this.#resumable.has(id)) {
      return Promise.resolve(err({ code: "runtime.invalid_argument", message: `session ${id} already exists` }));
    }
    const session = this.#newSession(id, options);
    session.emit("session.start", { sessionId: id, model, workingDirectory: options.workingDirectory });
    return Promise.resolve(ok(session));
  }

  resumeSession(options: ResumeOptions): RuntimeResult<RuntimeSession> {
    const belowFloor = this.#belowFloor(options);
    if (belowFloor !== undefined) {
      return Promise.resolve(err(belowFloor));
    }
    const session = this.#sessions.get(options.sessionId) ?? this.#adopt(options);
    if (session === undefined) {
      return Promise.resolve(
        err({ code: "runtime.session_not_found", message: `no session with id ${options.sessionId}` }),
      );
    }
    this.#options.set(options.sessionId, options);
    session.reopen(sessionOptions(options));
    return Promise.resolve(ok(session));
  }

  #adopt(options: ResumeOptions): FakeSession | undefined {
    return this.#resumable.has(options.sessionId) ? this.#newSession(options.sessionId, options) : undefined;
  }

  #newSession(id: string, options: SessionOptions): FakeSession {
    this.#options.set(id, options);
    const session = new FakeSession(
      { id, scenario: this.#scenario, clock: this.#clock, ids: this.#ids, record: (event) => this.#log.push(event) },
      sessionOptions(options),
    );
    this.#sessions.set(id, session);
    return session;
  }

  #belowFloor(options: SessionOptions): RuntimeError | undefined {
    const { maxAiCredits } = options;
    const floor = this.minSessionCredits;
    if (maxAiCredits === undefined || floor === undefined || maxAiCredits >= floor) {
      return undefined;
    }
    return { code: "runtime.invalid_argument", message: `Minimum session limit is ${String(floor)} AI credits.` };
  }
}

function sessionOptions(options: SessionOptions): FakeSessionOptions {
  return { hooks: options.hooks ?? {}, maxAiCredits: options.maxAiCredits, customAgents: options.customAgents };
}

function toRuntimeModel(model: Scenario["models"][number]): RuntimeModel {
  return {
    id: model.id,
    name: model.name,
    ...(model.tokenPrices === undefined ? {} : { tokenPrices: model.tokenPrices }),
    ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
  };
}
