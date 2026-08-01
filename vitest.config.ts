import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // Database-backed tests need DATABASE_URL; Vitest does not read .env on
    // its own. Tests that require it skip themselves when it is absent.
    env: loadEnv(mode, process.cwd(), ""),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
}));
