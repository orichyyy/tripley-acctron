import { defineConfig } from "tsup";

export default defineConfig([
  {
    clean: true,
    dts: true,
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    loader: { ".md": "text" },
    sourcemap: true,
  },
  {
    banner: { js: "#!/usr/bin/env node" },
    entry: ["src/cli.ts"],
    format: ["esm"],
    loader: { ".md": "text" },
    sourcemap: true,
  },
]);
