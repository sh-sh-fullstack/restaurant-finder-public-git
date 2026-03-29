import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    // Exclude frontend tests — they require jsdom (browser DOM) which is
    // incompatible with the Cloudflare Workers V8 isolate environment.
    // Frontend tests are run separately via vitest.config.frontend.js.
    // Phase 2.59: removed *.frontend.test.js from exclude — file deleted as redundant.
    exclude: ['**/*.integration.test.js', '**/index.unit.test.js', '**/index.security.test.js', '**/node_modules/**'],
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.toml',
        },
      },
    },
    // Phase 2.510 — Backend V8 coverage is NOT supported with vitest-pool-workers.
    // @vitest/coverage-v8 requires node:inspector, which is unavailable inside
    // workerd (Cloudflare's sandboxed V8 runtime). This is a documented known
    // issue: https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/
    // Backend coverage is assessed manually — see Phase 2.510 analysis in commit notes.
  },
});