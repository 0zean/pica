import { answerNames } from "../check-helpers.ts";
import { errorCodeNeedle, logNeedle, schemaNeedle } from "../large-files.ts";
import type { EvalTask } from "./task.ts";

// Large-file questions: the answer is in one file well over the read gate's threshold.
export const questionTasks: readonly EvalTask[] = [
  {
    id: "schema-column-owner",
    category: "large-file-question",
    repo: "ledger-service",
    prompt: `Which table in db/schema.sql has a column named \`${schemaNeedle.column}\`? Reply with the table name.`,
    check: ({ answer }) => answerNames(answer, schemaNeedle.table),
    solve: () => `The column is on \`${schemaNeedle.table}\` (db/schema.sql).`,
  },
  {
    id: "settlement-log-error",
    category: "large-file-question",
    repo: "ledger-service",
    prompt: "logs/settlement.log has exactly one line at level ERROR. What is the request id on that line? Reply with the id.",
    check: ({ answer }) => answerNames(answer, logNeedle.requestId),
    solve: () => `The ERROR line is for request ${logNeedle.requestId}.`,
  },
  {
    id: "error-code-value",
    category: "large-file-question",
    repo: "ledger-service",
    prompt: `What numeric code does src/generated/error-codes.mjs assign to ${errorCodeNeedle.name}? Reply with the number.`,
    check: ({ answer }) => answerNames(answer, String(errorCodeNeedle.code)),
    solve: () => `${errorCodeNeedle.name} is ${String(errorCodeNeedle.code)}.`,
  },
];
