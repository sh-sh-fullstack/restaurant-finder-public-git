/**
 * vitest.config.frontend.js
 *
 * Frontend test configuration using jsdom to simulate a browser environment.
 * Kept separate from vitest.config.js (Cloudflare Workers) because:
 * - Workers run in a V8 isolate — no real DOM, window, or localStorage
 * - Frontend tests need a real browser-like DOM (jsdom provides this)
 * - Mixing the two environments causes test failures in both directions
 *
 * Phase 2.59: removed *.frontend.test.js pattern — index.frontend.test.js
 * (jsdom smoke tests) was deleted as redundant once the real integration,
 * unit, and security suites proved the jsdom environment works correctly.
 *
 * Run: npm run test:frontend
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom simulates browser globals: document, window, localStorage, etc.
    environment: 'jsdom',
    include: ['**/*.integration.test.js', '**/index.unit.test.js', '**/index.security.test.js'],
    exclude: ['**/node_modules/**'],
    // Phase 2.510 — Coverage analysis, not enforcement.
    // NOTE: V8 cannot instrument scripts embedded inside <script> tags in
    // index.html when loaded via JSDOM runScripts:'dangerously'. Coverage
    // here reflects test-file instrumentation only (expected: ~0% on index.html).
    // The 30 passing tests are the real quality signal, not this number.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage/frontend',
    },
  },
});
