import { fileURLToPath } from "node:url";
import { formatScenarioError, loadScenarioFile } from "./scenario-loader.ts";
import { FakeRuntime } from "./fake-runtime.ts";
import type { ContractFixture, RuntimeContractHarness } from "./contract.ts";

export function contractScenarioPath(fixture: ContractFixture): string {
  return fileURLToPath(new URL(`../../fixtures/runtime/contract/${fixture}.jsonc`, import.meta.url));
}

export function fakeRuntimeHarness(): RuntimeContractHarness {
  return {
    name: "FakeRuntime",
    workingDirectory: "/contract/repo",
    createRuntime: (fixture) => {
      const loaded = loadScenarioFile(contractScenarioPath(fixture));
      if (!loaded.ok) {
        return Promise.reject(new Error(formatScenarioError(loaded.error)));
      }
      return Promise.resolve(new FakeRuntime({ scenario: loaded.value }));
    },
  };
}
