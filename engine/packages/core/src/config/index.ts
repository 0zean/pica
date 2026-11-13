export { configError, type ConfigError, type ConfigErrorCode, type ConfigIssue } from "./errors.ts";
export type { ConfigLoader, ConfigResult, ConfigWatch } from "./port.ts";
export {
  layerPrecedence,
  resolveConfig,
  type ConfigFileLayer,
  type ConfigLayerInput,
  type ConfigLayerName,
  type ResolvedConfig,
  type ResolvedValue,
} from "./resolve.ts";
export { validateLayer } from "./validate.ts";
