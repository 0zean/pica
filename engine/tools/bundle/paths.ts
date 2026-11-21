import { fileURLToPath } from "node:url";

export const bundleInputs = {
  entry: fileURLToPath(new URL("../../packages/server/src/main.ts", import.meta.url)),
  builtinAgents: fileURLToPath(new URL("../../packages/adapters/src/agents/builtin", import.meta.url)),
};
