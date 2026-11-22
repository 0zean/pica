import { defineConfig } from "vitest/config";

const policyModule = "packages/core/src/policy/**";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "packages/*/tests/**/*.test.ts", "tools/**/*.test.ts"],
    exclude: ["**/node_modules/**", "tools/**/fixtures/**"],
    // No test may reach the developer's real home directory and its Pica data (tests/setup/isolated-home.ts).
    setupFiles: ["tests/setup/isolated-home.ts"],
    // Applies only to runs with --coverage (C-03 maps one; PLAN.md §10).
    coverage: {
      provider: "v8",
      include: [policyModule],
      reporter: ["text"],
      thresholds: {
        [policyModule]: { branches: 100, functions: 100, lines: 100, statements: 100 },
      },
    },
  },
});
