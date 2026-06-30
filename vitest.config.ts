import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      reporter: ["text", "html"],
    },
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
  },
});
