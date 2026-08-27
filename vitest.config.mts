import { defineConfig } from "vitest/config";
// __dirname は使わず import.meta.dirname を使う

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});
