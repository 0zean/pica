import type { CustomizationProblem } from "@pica/protocol";

export type CustomizationErrorCode =
  | "customization.scope_not_found"
  | "customization.not_found"
  | "customization.already_exists"
  | "customization.invalid"
  | "customization.read_only"
  | "customization.locked"
  | "customization.io_failed";

export interface CustomizationError {
  readonly code: CustomizationErrorCode;
  readonly message: string;
  readonly problems?: readonly CustomizationProblem[];
  readonly lockedBy?: string;
}

export function customizationError(
  code: CustomizationErrorCode,
  message: string,
  extra: Omit<CustomizationError, "code" | "message"> = {},
): CustomizationError {
  return { code, message, ...extra };
}

const protocolCodes = {
  "customization.scope_not_found": "not_found",
  "customization.not_found": "not_found",
  "customization.already_exists": "already_exists",
  "customization.invalid": "config_invalid",
  "customization.read_only": "invalid_params",
  "customization.locked": "policy_denied",
  "customization.io_failed": "internal_error",
} as const;

export function customizationProtocolCode(code: CustomizationErrorCode): (typeof protocolCodes)[CustomizationErrorCode] {
  return protocolCodes[code];
}
