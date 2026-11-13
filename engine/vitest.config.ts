import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "packages/*/tests/**/*.test.ts", "tools/**/*.test.ts"],
    exclude: ["**/node_modules/**", "tools/**/fixtures/**"],
  },
});
