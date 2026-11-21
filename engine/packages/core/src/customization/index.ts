export { describeFile, isValidItemName, type DescribedFile, type FrontmatterParser, type ParsedFrontmatter } from "./describe.ts";
export { customizationError, customizationProtocolCode, type CustomizationError, type CustomizationErrorCode } from "./errors.ts";
export {
  customizationLocations,
  publicLocation,
  type CustomizationRepoRoot,
  type CustomizationRoots,
  type LocationLayout,
  type LocationSpec,
} from "./locations.ts";
export type { CustomizationDeps, CustomizationFile, CustomizationFiles, CustomizationScope } from "./ports.ts";
export { resolveCustomizations } from "./resolve.ts";
export { createCustomizationService, type CustomizationCreate, type CustomizationListing, type CustomizationService } from "./service.ts";
