import path from 'path'
import { defineConfig } from 'vitest/config'

/** Fast jsdom-free unit tests (happy-dom). The upstream browser-mode suite
 * (`pnpm test`) needs Playwright's Chromium and is not used for CI here. */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.unit.test.{ts,tsx}'],
    setupFiles: ['./src/test-utils/unit-setup.ts'],
    environmentOptions: { happyDOM: { url: 'http://localhost/' } },
  },
})
