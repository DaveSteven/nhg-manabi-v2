/// <reference types="vitest/config" />
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // Vitest must not load the reactRouter plugin: tests import route
  // modules as plain components; the plugin's SPA preamble only exists
  // under the dev server / build.
  plugins: process.env.VITEST ? [] : [reactRouter()],
  server: {
    // Dev: same-origin proxy to FastAPI (no CORS middleware needed).
    // Production: the static host proxies /api to FastAPI the same way.
    proxy: {
      "/api": {
        target: process.env.BACKEND_URL || "http://localhost:8001",
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./app/test/setup.ts"],
    css: false,
    environmentOptions: {
      happyDOM: { url: "http://localhost/" },
    },
  },
});
