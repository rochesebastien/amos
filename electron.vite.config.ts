import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The root package is `"type": "module"`, so `__dirname` does not exist here.
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: path.resolve(root, "src/main/index.ts") },
      },
    },
    resolve: {
      alias: { "@shared": path.resolve(root, "src/shared") },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // Sandboxed preload scripts cannot be ESM, and the root package.json is
      // `"type": "module"` — so emit an explicitly CommonJS `.cjs` bundle.
      rollupOptions: {
        input: { index: path.resolve(root, "src/preload/index.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
    resolve: {
      alias: { "@shared": path.resolve(root, "src/shared") },
    },
  },
  renderer: {
    root: path.resolve(root, "src/renderer"),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(root, "src/renderer/src"),
        "@shared": path.resolve(root, "src/shared"),
      },
    },
    build: {
      rollupOptions: {
        input: { index: path.resolve(root, "src/renderer/index.html") },
      },
    },
    server: { port: 5173 },
  },
});
