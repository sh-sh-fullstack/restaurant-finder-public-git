/**
 * index.frontend.test.js — jsdom Environment Smoke Tests
 *
 * Verifies the jsdom test environment is correctly configured.
 * These tests must pass before writing any real frontend tests.
 *
 * Phase 2.56 will test the actual index.html behavior:
 * - Search form submission
 * - API response rendering
 * - Error message display
 * - Pagination controls
 *
 * How to run:
 * - Frontend only: npm run test:frontend
 * - Everything:    npm run test:all
 */

import { describe, it, expect } from 'vitest';

describe('jsdom environment smoke tests', () => {
  it('can create DOM elements', () => {
    const div = document.createElement('div');
    expect(div).toBeDefined();
    expect(div.tagName).toBe('DIV');
  });

  it('has window object with expected globals', () => {
    expect(window).toBeDefined();
    expect(typeof window.location).toBe('object');
    expect(typeof window.document).toBe('object');
  });

  it('has localStorage available', () => {
    expect(typeof localStorage).toBe('object');
    localStorage.setItem('test', 'value');
    expect(localStorage.getItem('test')).toBe('value');
    localStorage.removeItem('test');
  });
});
