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
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // The suites arrive with the scanner in P2; until then an empty run is a pass.
    passWithNoTests: true,
  },
});
