/**
 * vitest.config.frontend.js
 *
 * Frontend test configuration using jsdom to simulate a browser environment.
 * Kept separate from vitest.config.js (Cloudflare Workers) because:
 * - Workers run in a V8 isolate — no real DOM, window, or localStorage
 * - Frontend tests need a real browser-like DOM (jsdom provides this)
 * - Mixing the two environments causes test failures in both directions
 *
 * Pattern: *.frontend.test.js
 * Run: npm run test:frontend
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom simulates browser globals: document, window, localStorage, etc.
    environment: 'jsdom',
    include: ['**/*.frontend.test.js', '**/*.integration.test.js'],
    exclude: ['**/node_modules/**'],
  },
});
