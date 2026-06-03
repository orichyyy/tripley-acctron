import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@tripley-acctron/contracts": sourcePath("./packages/contracts/src/index.ts"),
      "@tripley-acctron/event-bus": sourcePath("./packages/event-bus/src/index.ts"),
      "@tripley-acctron/flow-engine": sourcePath("./packages/flow-engine/src/index.ts"),
      "@tripley-acctron/native": sourcePath("./packages/native/src/index.ts"),
      "@tripley-acctron/observability": sourcePath("./packages/observability/src/index.ts"),
      "@tripley-acctron/plugin-system": sourcePath("./packages/plugin-system/src/index.ts"),
      "@tripley-acctron/react-ui": sourcePath("./packages/react-ui/src/index.ts"),
      "@tripley-acctron/runtime-core": sourcePath("./packages/runtime-core/src/index.ts"),
      "@tripley-acctron/testing": sourcePath("./packages/testing/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
  },
});

function sourcePath(path: string): string {
  return fileURLToPath(new URL(path, import.meta.url));
}
