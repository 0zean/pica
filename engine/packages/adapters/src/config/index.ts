export { JsoncConfigLoader, type ConfigSource } from "./jsonc-config-loader.ts";
export { parseConfigFile, type ParsedConfigFile } from "./jsonc.ts";
export { repoConfigPath, userConfigPath } from "./paths.ts";
export { JsoncMcpRegistryLoader, type McpRegistrySource } from "./mcp-registry-loader.ts";
export {
  copilotCliMcpConfigPath,
  mcpFileSources,
  projectMcpJsonPath,
  repoMcpConfigPath,
  userMcpConfigPath,
  vscodeMcpConfigPath,
  workspaceMcpConfigPath,
  type McpFileSource,
} from "./mcp-paths.ts";
export { createMcpImportFiles, type McpImportFilesOptions } from "./mcp-import-files.ts";
export { mcpImportFileLocations, type McpImportFileLocation } from "./mcp-import-paths.ts";
export {
  ManagedPolicyLoader,
  nodeManagedPolicyFileSystem,
  type ManagedPolicyCandidate,
  type ManagedPolicyFileSystem,
} from "./managed-policy-loader.ts";
export {
  managedPolicyCandidates,
  managedPolicyFilePath,
  managedPreferencesDomain,
  managedPreferencesPaths,
} from "./managed-policy-paths.ts";
export { appendPermissionRule, type PermissionRuleWrite } from "./permission-rule-writer.ts";
export { setConfigValue } from "./config-value-writer.ts";
export type { ConfigFileWrite } from "./config-file-edit.ts";
export { createMcpServerFiles } from "./mcp-server-files.ts";
export { createJsonMcpAttachmentStore, mcpAttachmentsPath } from "./mcp-attachment-store.ts";
