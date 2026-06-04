import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": sourcePath("./apps/demo-kiosk/src"),
      "@tripley-acctron/accessibility": sourcePath("./packages/accessibility/src/index.ts"),
      "@tripley-acctron/atm-basic": sourcePath("./apps/atm-basic/src/index.ts"),
      "@tripley-acctron/contracts": sourcePath("./packages/contracts/src/index.ts"),
      "@tripley-acctron/event-bus": sourcePath("./packages/event-bus/src/index.ts"),
      "@tripley-acctron/flow-engine": sourcePath("./packages/flow-engine/src/index.ts"),
      "@tripley-acctron/native": sourcePath("./packages/native/src/index.ts"),
      "@tripley-acctron/observability": sourcePath("./packages/observability/src/index.ts"),
      "@tripley-acctron/plugin-system": sourcePath("./packages/plugin-system/src/index.ts"),
      "@tripley-acctron/recipes": sourcePath("./packages/recipes/src/index.ts"),
      "@tripley-acctron/react-ui": sourcePath("./packages/react-ui/src/index.ts"),
      "@tripley-acctron/runtime-core": sourcePath("./packages/runtime-core/src/index.ts"),
      "@tripley-acctron/testing": sourcePath("./packages/testing/src/index.ts"),
      "@tripley-acctron/window-coordinator": sourcePath(
        "./packages/window-coordinator/src/index.ts",
      ),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "apps/**/*.test.tsx"],
  },
});

function sourcePath(path: string): string {
  return fileURLToPath(new URL(path, import.meta.url));
}
