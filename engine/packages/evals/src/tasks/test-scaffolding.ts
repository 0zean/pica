import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { testsCatchMutant } from "../check-helpers.ts";
import type { EvalTask } from "./task.ts";

function writeFile(workdir: string, path: string, content: string): void {
  mkdirSync(dirname(join(workdir, path)), { recursive: true });
  writeFileSync(join(workdir, path), content);
}

const header = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\n';

// Test scaffolding: a new test file that passes on the code and fails on a broken copy of it.
export const testScaffoldingTasks: readonly EvalTask[] = [
  {
    id: "money-tests",
    category: "test-scaffolding",
    repo: "ledger-service",
    prompt:
      "Write test/money.test.mjs with node:test and node:assert covering addCents and fmtCents in src/money.mjs: " +
      "at least 4 cases, including negative amounts and the TypeError for non-integer input. Do not change src/.",
    check: ({ workdir }) =>
      testsCatchMutant(workdir, "test/money.test.mjs", 4, {
        path: "src/money.mjs",
        content: "export function addCents(a, b) { return a + b; }\nexport function fmtCents(cents) { return `$${cents / 100}`; }\n",
      }),
    solve: (workdir) => {
      writeFile(
        workdir,
        "test/money.test.mjs",
        `${header}import { addCents, fmtCents } from "../src/money.mjs";\n\n` +
          'test("adds cents", () => assert.equal(addCents(150, 275), 425));\n' +
          'test("rejects fractional cents", () => assert.throws(() => addCents(1.5, 1), TypeError));\n' +
          'test("formats dollars and cents", () => assert.equal(fmtCents(1234), "$12.34"));\n' +
          'test("formats negative amounts", () => assert.equal(fmtCents(-5), "-$0.05"));\n',
      );
      return "Added test/money.test.mjs with four cases.";
    },
  },
  {
    id: "slug-tests",
    category: "test-scaffolding",
    repo: "web-toolkit",
    prompt:
      "Write test/slug.test.mjs with node:test and node:assert covering slugify in src/slug.mjs: at least 3 cases, " +
      "including punctuation, repeated separators, and leading or trailing spaces. Do not change src/.",
    check: ({ workdir }) =>
      testsCatchMutant(workdir, "test/slug.test.mjs", 3, {
        path: "src/slug.mjs",
        content: "export function slugify(text) { return text.toLowerCase().replace(/ /g, \"-\"); }\n",
      }),
    solve: (workdir) => {
      writeFile(
        workdir,
        "test/slug.test.mjs",
        `${header}import { slugify } from "../src/slug.mjs";\n\n` +
          'test("lowercases and joins words", () => assert.equal(slugify("Hello World"), "hello-world"));\n' +
          'test("drops punctuation", () => assert.equal(slugify("Rock & Roll!"), "rock-roll"));\n' +
          'test("trims separators", () => assert.equal(slugify("  --Pica--  "), "pica"));\n',
      );
      return "Added test/slug.test.mjs with three cases.";
    },
  },
  {
    id: "backoff-tests",
    category: "test-scaffolding",
    repo: "web-toolkit",
    prompt:
      "Write test/retry.test.mjs with node:test and node:assert covering backoffDelays in src/retry.mjs: at least 3 cases, " +
      "including the cap and zero attempts. Do not change src/.",
    check: ({ workdir }) =>
      testsCatchMutant(workdir, "test/retry.test.mjs", 3, {
        path: "src/retry.mjs",
        content: "export function backoffDelays(attempts, baseMs) { return Array.from({ length: attempts }, (_, i) => baseMs * 2 ** i); }\n",
      }),
    solve: (workdir) => {
      writeFile(
        workdir,
        "test/retry.test.mjs",
        `${header}import { backoffDelays } from "../src/retry.mjs";\n\n` +
          'test("doubles each attempt", () => assert.deepEqual(backoffDelays(3, 100, 10000), [100, 200, 400]));\n' +
          'test("caps the delay", () => assert.deepEqual(backoffDelays(4, 100, 250), [100, 200, 250, 250]));\n' +
          'test("no attempts, no delays", () => assert.deepEqual(backoffDelays(0, 100, 1000), []));\n',
      );
      return "Added test/retry.test.mjs with three cases.";
    },
  },
];
