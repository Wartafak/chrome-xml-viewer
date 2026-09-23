import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    target: "chrome88",
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: "src/content.ts",
      output: {
        format: "iife",
        entryFileNames: "content.js",
      },
    },
    minify: "oxc",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    environmentOptions: { jsdom: { url: "https://example.com/" } },
  },
});
