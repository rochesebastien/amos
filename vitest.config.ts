import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(root, "src/shared"),
      "@": path.resolve(root, "src/renderer/src"),
    },
  },
  // The renderer tests are `.tsx`; esbuild needs to be told which JSX runtime
  // to compile them with, since vitest does not read tsconfig.web.json.
  esbuild: {
    jsx: "automatic",
  },
  test: {
    // Node by default — the main-process suites are the bulk of it. A renderer
    // test opts into a DOM with a `@vitest-environment jsdom` docblock.
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts"],
    setupFiles: ["tests/renderer/setup-dom.ts"],
  },
});
