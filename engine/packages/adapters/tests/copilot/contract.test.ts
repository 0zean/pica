import { runtimeContractSuite } from "@pica/testkit";
import { afterAll } from "vitest";
import { ReplayRuntimes } from "./replay-harness.ts";

const replays = new ReplayRuntimes();
afterAll(() => replays.stopAll());

runtimeContractSuite(replays.harness());
