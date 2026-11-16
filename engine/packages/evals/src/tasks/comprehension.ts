import { answerNames } from "../check-helpers.ts";
import { plantedBugs } from "../generated-modules.ts";
import type { EvalTask } from "./task.ts";

// Comprehension: find a planted bug in a large body of code. Unlike the large-file questions there is
// no word to search for, so the code has to be read, which is the work delegation should take off
// the main agent.
export const comprehensionTasks: readonly EvalTask[] = [
  {
    id: "allocation-bug",
    category: "comprehension",
    repo: "ledger-service",
    prompt:
      "In src/money.mjs, exactly one of the allocate* functions can return shares that do not add up to the amount it was " +
      "given. Which function is it? Reply with its name. Do not change any files.",
    check: ({ answer }) => answerNames(answer, plantedBugs.allocation.fn),
    solve: () => `${plantedBugs.allocation.fn}: its loop stops while one cent is still left to hand out.`,
  },
  {
    id: "report-total-bug",
    category: "comprehension",
    repo: "ledger-service",
    prompt:
      "In src/reports/, exactly one module's *Summary function leaves a row out of the total it logs and returns. " +
      "Which function is it? Reply with its name. Do not change any files.",
    check: ({ answer }) => answerNames(answer, plantedBugs.summary.fn),
    solve: () => `${plantedBugs.summary.fn} skips the first row.`,
  },
  {
    id: "query-filter-bug",
    category: "comprehension",
    repo: "web-toolkit",
    prompt:
      "In src/, exactly one of the *Query functions drops filter values that are 0 or an empty string. Which function " +
      "is it? Reply with its name. Do not change any files.",
    check: ({ answer }) => answerNames(answer, plantedBugs.query.fn),
    solve: () => `${plantedBugs.query.fn} tests the value for truthiness instead of against undefined.`,
  },
];
