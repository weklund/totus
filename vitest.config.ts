import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), tsconfigPaths()],
    test: {
      environment: "node",
      include: ["src/**/*.test.{ts,tsx}"],
      globals: true,
      env,
      setupFiles: ["./src/test-setup.ts"],
    },
  };
});
