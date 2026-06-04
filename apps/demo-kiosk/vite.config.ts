import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const workspace = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": "/src",
      "@tripley-acctron/accessibility": workspace("packages/accessibility/src/index.ts"),
      "@tripley-acctron/atm-basic": workspace("apps/atm-basic/src/index.ts"),
      "@tripley-acctron/contracts": workspace("packages/contracts/src/index.ts"),
      "@tripley-acctron/flow-engine": workspace("packages/flow-engine/src/index.ts"),
      "@tripley-acctron/observability": workspace("packages/observability/src/index.ts"),
      "@tripley-acctron/react-ui": workspace("packages/react-ui/src/index.ts"),
      "@tripley-acctron/runtime-core": workspace("packages/runtime-core/src/index.ts"),
      "@tripley-acctron/testing": workspace("packages/testing/src/index.ts"),
      "@tripley-acctron/window-coordinator": workspace("packages/window-coordinator/src/index.ts"),
    },
  },
});
