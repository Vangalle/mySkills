import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "web/**/*.test.tsx"],
    exclude: ["**/*.playwright.test.ts", "**/node_modules/**", "**/dist/**"],
    environment: "node",
    testTimeout: 30_000,
  },
});