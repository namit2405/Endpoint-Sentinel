import { fileURLToPath, URL } from "url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: "declarations",
        replacement: fileURLToPath(new URL("../declarations", import.meta.url)),
      },
      {
        find: "@",
        replacement: fileURLToPath(new URL("./src", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // Explicitly bound pool sizes. Vitest's default forks pool derives
    // minThreads/maxThreads from the host CPU count, which can resolve to a
    // conflicting range (minThreads > maxThreads) in CPU-restricted sandboxes
    // and abort the whole run before any test executes. Pin a single worker so
    // the range can never conflict.
    pool: "threads",
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 4,
      },
    },
  },
});
