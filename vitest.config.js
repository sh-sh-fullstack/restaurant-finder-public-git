import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    // Exclude frontend tests — they require jsdom (browser DOM) which is
    // incompatible with the Cloudflare Workers V8 isolate environment.
    // Frontend tests are run separately via vitest.config.frontend.js.
    exclude: ['**/*.frontend.test.js', '**/*.integration.test.js', '**/node_modules/**'],
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.toml',
        },
      },
    },
  },
});