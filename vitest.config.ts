import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      enforce: "pre",
      name: "markdown-as-text",
      transform(source, id) {
        if (!id.split("?", 1)[0]?.endsWith(".md")) {
          return null;
        }
        return `export default ${JSON.stringify(source)};`;
      },
    },
  ],
  test: {
    coverage: {
      reporter: ["text", "html"],
    },
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
  },
});
