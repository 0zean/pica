import { configTasks } from "./config-generation.ts";
import { multiFileEditTasks } from "./multi-file-edits.ts";
import { questionTasks } from "./questions.ts";
import type { EvalTask } from "./task.ts";
import { testScaffoldingTasks } from "./test-scaffolding.ts";

export type { CheckContext, EvalTask, TaskCategory } from "./task.ts";

// The C-10 suite, in report order.
export const evalSuite: readonly EvalTask[] = [...questionTasks, ...testScaffoldingTasks, ...configTasks, ...multiFileEditTasks];
