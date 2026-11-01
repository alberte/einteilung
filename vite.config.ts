import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svelte()],
  css: {
    preprocessorOptions: {
      scss: {
        silenceDeprecations: [
          "import",
          "global-builtin",
          "legacy-js-api",
          "color-functions",
          "if-function",
        ],
      },
    },
  },
  build: {
    target: "es2022",
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
