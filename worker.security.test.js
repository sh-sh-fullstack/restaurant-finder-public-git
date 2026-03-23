import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from './worker.js';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';

/**
 * Security Tests for Cloudflare Worker
 * Phase 2.54 - Server-Side Origin Validation
 *
 * These tests verify the Worker is protected against:
 * - Origin-based attacks (cross-origin requests from malicious sites)
 * - Protocol mismatches (http vs https)
 * - Subdomain attacks
 * - Case-sensitivity bypasses
 *
 * Option C Implementation (Balanced):
 * - Blocks: Wrong origins from browsers
 * - Allows: Correct origin + no origin (testing tools)
 * - Logs: All requests for monitoring
 *
 * How to run:
 * - All tests: npm test
 * - Security only: npm test worker.security.test.js
 * - Specific test: npm test -- -t "origin matching"
 *
 * Tests use real Worker code with mocked Google API responses.
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

async function makeRequest(endpoint, params, method = 'GET', origin = null) {
  const url = `https://worker.dev/?endpoint=${encodeURIComponent(endpoint)}&params=${encodeURIComponent(params)}`;

  const headers = { 'CF-Connecting-IP': '1.2.3.4' };
  if (origin !== null) {
    headers['Origin'] = origin;
  }

  const request = new Request(url, { method, headers });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, { ...env, GOOGLE_API_KEY: 'test-key-12345' }, ctx);
  await waitOnExecutionContext(ctx);

  return response;
}

// ---------------------------------------------------------------------------

describe('Server-side origin validation', () => {
  it('accepts requests from allowed origin', async () => {
    const response = await makeRequest(
      'maps/api/geocode/json',
      'address=New+York',
      'GET',
      'https://sh-sh-fullstack.github.io'
    );

    expect(response.status).toBe(200);
  });

  it('rejects requests from wrong origin with 403', async () => {
    const response = await makeRequest(
      'maps/api/geocode/json',
      'address=New+York',
      'GET',
      'https://evil-site.com'
    );

    expect(response.status).toBe(403);
    const text = await response.text();
    expect(text).toContain('Forbidden');
  });

  it('allows requests with no origin header (testing tools)', async () => {
    // No origin header at all (simulates curl/Postman)
    const response = await makeRequest(
      'maps/api/geocode/json',
      'address=New+York',
      'GET',
      null  // No origin header
    );

    // Option C allows these (logged but not blocked)
    expect(response.status).toBe(200);
  });

  it('rejects null origin', async () => {
    // Browsers send "null" string for file:// URLs and sandboxed iframes
    const response = await makeRequest(
      'maps/api/geocode/json',
      'address=New+York',
      'GET',
      'null'
    );

    expect(response.status).toBe(403);
  });

  it('origin matching is case-sensitive', async () => {
    const response = await makeRequest(
      'maps/api/geocode/json',
      'address=New+York',
      'GET',
      'https://SH-SH-FULLSTACK.GITHUB.IO'  // Wrong case
    );

    expect(response.status).toBe(403);
  });

  it('rejects different protocol (http vs https)', async () => {
    const response = await makeRequest(
      'maps/api/geocode/json',
      'address=New+York',
      'GET',
      'http://sh-sh-fullstack.github.io'  // http instead of https
    );

    expect(response.status).toBe(403);
  });

  it('rejects different subdomain', async () => {
    const response = await makeRequest(
      'maps/api/geocode/json',
      'address=New+York',
      'GET',
      'https://evil.sh-sh-fullstack.github.io'
    );

    expect(response.status).toBe(403);
  });

  it('rejects origin with port number', async () => {
    const response = await makeRequest(
      'maps/api/geocode/json',
      'address=New+York',
      'GET',
      'https://sh-sh-fullstack.github.io:8080'
    );

    expect(response.status).toBe(403);
  });
});
