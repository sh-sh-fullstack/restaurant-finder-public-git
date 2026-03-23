import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from './worker.js';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';

/**
 * Configuration Validation Tests for Cloudflare Worker
 * Phase 2.55 - Config Validation
 *
 * These tests verify the Worker handles misconfiguration gracefully:
 * - Missing or empty GOOGLE_API_KEY
 * - Missing RATE_LIMITER KV binding
 * - Worker degrades safely without exposing what's wrong
 *
 * Security requirements:
 * - User-facing errors: GENERIC "Service temporarily unavailable" (503)
 * - Must NOT expose: "API", "key", "config", "KV", "RATE_LIMITER", "missing"
 * - Detailed errors: server-side console.log ONLY (visible in Cloudflare dashboard)
 * - No Google API calls with invalid config (saves quota)
 *
 * How to run:
 * - All tests:    npm test
 * - Config only:  npm test worker.config.test.js
 */

let fetchMock;

beforeEach(() => {
  fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ status: 'OK', results: [] }), {
      headers: { 'Content-Type': 'application/json' },
    })
  );
});

afterEach(() => {
  fetchMock.mockRestore();
});

// Accepts optional customEnv to test missing/broken bindings
async function makeRequest(endpoint, params, customEnv = null) {
  const url = `https://worker.dev/?endpoint=${encodeURIComponent(endpoint)}&params=${encodeURIComponent(params)}`;

  const request = new Request(url, {
    method: 'GET',
    headers: {
      'CF-Connecting-IP': '1.2.3.4',
      'Origin': 'https://sh-sh-fullstack.github.io',
    },
  });

  const testEnv = customEnv ?? { ...env, GOOGLE_API_KEY: 'test-key-12345' };
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, testEnv, ctx);
  await waitOnExecutionContext(ctx);

  return response;
}

// ---------------------------------------------------------------------------

describe('Configuration validation', () => {
  it('works normally with valid GOOGLE_API_KEY and RATE_LIMITER', async () => {
    const response = await makeRequest(
      'maps/api/geocode/json',
      'address=New+York'
      // uses default env with GOOGLE_API_KEY: 'test-key-12345'
    );

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls.length).toBe(1); // exactly one Google call
  });

  it('returns 503 and generic message when GOOGLE_API_KEY is missing', async () => {
    const envWithoutKey = { ...env }; // no GOOGLE_API_KEY

    const response = await makeRequest(
      'maps/api/geocode/json',
      'address=New+York',
      envWithoutKey
    );

    expect(response.status).toBe(503);

    const text = await response.text();
    // Generic user-facing message — must NOT expose config details
    expect(text.toLowerCase()).not.toContain('api');
    expect(text.toLowerCase()).not.toContain('key');
    expect(text.toLowerCase()).not.toContain('config');
    expect(text.toLowerCase()).not.toContain('missing');

    // CRITICAL: No Google API call should have been made (saves quota)
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  it('returns 503 and generic message when GOOGLE_API_KEY is empty string', async () => {
    const envWithEmptyKey = { ...env, GOOGLE_API_KEY: '' };

    const response = await makeRequest(
      'maps/api/geocode/json',
      'address=New+York',
      envWithEmptyKey
    );

    expect(response.status).toBe(503);

    const text = await response.text();
    expect(text.toLowerCase()).not.toContain('api');
    expect(text.toLowerCase()).not.toContain('key');
    expect(text.toLowerCase()).not.toContain('config');
    expect(text.toLowerCase()).not.toContain('missing');

    // CRITICAL: No Google API call with empty key (saves quota)
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  it('RATE_LIMITER KV namespace works normally', async () => {
    // Verify the KV binding provided by cloudflare:test functions correctly
    const response = await makeRequest(
      'maps/api/geocode/json',
      'address=New+York'
    );

    expect(response.status).toBe(200);
  });

  it('returns 503 and generic message when RATE_LIMITER binding is missing', async () => {
    const envWithoutKV = { GOOGLE_API_KEY: 'test-key-12345' }; // no RATE_LIMITER

    const response = await makeRequest(
      'maps/api/geocode/json',
      'address=New+York',
      envWithoutKV
    );

    expect(response.status).toBe(503);

    const text = await response.text();
    expect(text.toLowerCase()).not.toContain('rate');
    expect(text.toLowerCase()).not.toContain('limiter');
    expect(text.toLowerCase()).not.toContain('kv');
    expect(text.toLowerCase()).not.toContain('missing');

    // No Google API call should have been made
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  it('handles multiple requests with invalid config without crashing or degrading', async () => {
    const envWithoutKey = { ...env }; // no GOOGLE_API_KEY

    for (let i = 0; i < 3; i++) {
      const response = await makeRequest(
        'maps/api/geocode/json',
        'address=New+York',
        envWithoutKey
      );
      // Each request should fail gracefully with 503, not crash
      expect(response.status).toBe(503);
    }

    // No Google API calls across all 3 requests
    expect(fetchMock.mock.calls.length).toBe(0);
  });
});
