import { createHash } from "node:crypto";
import type { AuditHash } from "@pica/core";

export const sha256Hex: AuditHash = (text) => createHash("sha256").update(text, "utf8").digest("hex");
