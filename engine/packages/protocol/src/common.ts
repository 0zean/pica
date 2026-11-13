import * as z from "zod";

export const Id = z.string().min(1);
export const Timestamp = z.iso.datetime({ offset: true });
export const AbsolutePath = z.string().startsWith("/");
export const Count = z.int().nonnegative();
export const Seq = z.int().positive();
export const Credits = z.number().nonnegative();

export const ProtocolVersion = z.object({
  major: Count,
  minor: Count,
});

export const ErrorCode = z.enum([
  "parse_error",
  "invalid_request",
  "method_not_found",
  "invalid_params",
  "internal_error",
  "frame_too_large",
  "protocol_version_mismatch",
  "not_found",
  "already_exists",
  "conflict",
  "refused_without_force",
  "invalid_state",
  "auth_required",
  "auth_sso_required",
  "auth_scope_missing",
  "quota_exhausted",
  "model_unavailable",
  "budget_exhausted",
  "policy_denied",
  "config_invalid",
  "secret_unresolved",
  "git_failed",
  "runtime_failed",
]);

export const FixAction = z.object({
  kind: z.enum(["open_url", "open_settings", "retry", "sign_in", "run_command"]),
  label: z.string().min(1),
  target: z.string().optional(),
});

export const ErrorData = z.object({
  code: ErrorCode,
  fix: FixAction.optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const Empty = z.object({});
