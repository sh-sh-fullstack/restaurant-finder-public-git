/**
 * worker.test.js — Cloudflare Worker Integration Tests
 *
 * What these tests verify:
 *   - Security: param filtering strips unknown/dangerous keys before forwarding to Google
 *   - Endpoint allowlist: only whitelisted Google API paths are proxied (403 otherwise)
 *   - CORS: Access-Control-Allow-Origin is set correctly on all responses
 *
 * Why the 1000-char pagetoken limit exists:
 *   Google Maps pagetokens can exceed 600 chars (discovered during Phase 2 debugging).
 *   No official maximum is documented by Google. 1000 chars is used as a safe upper bound.
 *   NOTE: The worker TRUNCATES tokens over 1000 chars — it does not reject them with 400.
 *
 * How to run all tests:       npm test
 * How to run a specific test: npm test -- -t "test name"
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker from './worker.js';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';

let testEnv;
let fetchMock;

beforeEach(() => {
  // Spread the cloudflare:test env (which provides the RATE_LIMITER KV binding
  // from wrangler.toml) and add GOOGLE_API_KEY for tests.
  testEnv = {
    ...env,
    GOOGLE_API_KEY: 'test-key-12345',
  };

  // Mock global fetch so no real HTTP requests reach Google APIs.
  fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ status: 'OK', results: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Build a Request and run it through the worker.
 * Uses URL().searchParams.set() so params are correctly encoded/decoded
 * the same way the real frontend serializes them.
 */
async function makeRequest(
  endpoint,
  params,
  method = 'GET',
  origin = 'https://sh-sh-fullstack.github.io'
) {
  const workerUrl = new URL('https://worker.dev/');
  workerUrl.searchParams.set('endpoint', endpoint);
  workerUrl.searchParams.set('params', params);

  const request = new Request(workerUrl.toString(), {
    method,
    headers: { Origin: origin },
  });

  const ctx = createExecutionContext();
  const response = await worker.fetch(request, testEnv, ctx);
  // Wait for ctx.waitUntil() tasks (rate-limiter KV write) to finish.
  await waitOnExecutionContext(ctx);
  return response;
}

// ---------------------------------------------------------------------------

describe('Allowed and blocked params', () => {
  it('allows valid params through', async () => {
    const response = await makeRequest(
      'maps/api/place/nearbysearch/json',
      'location=40.7,-74.0&radius=1000&type=restaurant'
    );
    expect(response.status).toBe(200);
  });

  it('blocks invalid param keys', async () => {
    const response = await makeRequest(
      'maps/api/place/nearbysearch/json',
      'location=40.7,-74.0&malicious=hack'
    );
    expect(response.status).toBe(200);

    // Verify the URL actually sent to Google via vi.spyOn
    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).not.toContain('malicious');
    expect(calledUrl).toContain('location');
  });

  it('allows pagetoken up to 1000 chars', async () => {
    const token = 'a'.repeat(1000);
    const response = await makeRequest(
      'maps/api/place/nearbysearch/json',
      `pagetoken=${token}`
    );
    expect(response.status).toBe(200);
  });

  it('truncates pagetoken over 1000 chars rather than rejecting it', async () => {
    // NOTE: sanitizeParams uses .slice(0, 1000) on pagetoken — it does NOT return 400.
    // The 1001-char token is silently truncated to 1000 chars and forwarded to Google.
    // If rejection behavior is wanted, sanitizeParams would need to be updated.
    const token = 'a'.repeat(1001);
    const response = await makeRequest(
      'maps/api/place/nearbysearch/json',
      `pagetoken=${token}`
    );
    expect(response.status).toBe(200);

    // Confirm the URL sent to Google has the token truncated to 1000 chars
    const calledUrl = fetchMock.mock.calls[0][0];
    const sentParams = new URL(calledUrl).searchParams;
    expect(sentParams.get('pagetoken').length).toBe(1000);
  });
});

// ---------------------------------------------------------------------------

describe('Endpoint validation', () => {
  it('allows whitelisted geocode endpoint', async () => {
    const response = await makeRequest(
      'maps/api/geocode/json',
      'address=New+York'
    );
    expect(response.status).toBe(200);
  });

  it('allows whitelisted nearbysearch endpoint', async () => {
    const response = await makeRequest(
      'maps/api/place/nearbysearch/json',
      'location=40.7,-74.0&radius=1000'
    );
    expect(response.status).toBe(200);
  });

  it('blocks non-whitelisted endpoint', async () => {
    const response = await makeRequest(
      'maps/api/place/details/json',
      'place_id=ChIJ123'
    );
    expect(response.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------

describe('CORS headers', () => {
  it('sets correct CORS headers on success', async () => {
    const response = await makeRequest(
      'maps/api/place/nearbysearch/json',
      'location=40.7,-74.0&radius=1000'
    );
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://sh-sh-fullstack.github.io'
    );
  });

  it('handles OPTIONS preflight', async () => {
    const response = await makeRequest(
      'maps/api/place/nearbysearch/json',
      'location=40.7,-74.0&radius=1000',
      'OPTIONS'
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://sh-sh-fullstack.github.io'
    );
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });
});

// ---------------------------------------------------------------------------

describe('Origin validation', () => {
  it('does not block requests by origin — CORS is enforced browser-side only', async () => {
    // The worker sets Access-Control-Allow-Origin on responses but does NOT
    // inspect the incoming Origin header to gate access. Browsers use the
    // CORS response headers to decide whether JS can read the response;
    // the worker itself responds to all callers regardless of origin.
    const response = await makeRequest(
      'maps/api/place/nearbysearch/json',
      'location=40.7,-74.0&radius=1000',
      'GET',
      'https://evil-site.com'
    );
    expect(response.status).toBe(200);
    // The CORS header still names only the allowed origin — browsers will
    // block the evil-site.com JS from reading this response.
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://sh-sh-fullstack.github.io'
    );
  });
});

// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  it('handles empty params gracefully', async () => {
    const response = await makeRequest(
      'maps/api/place/nearbysearch/json',
      ''
    );
    // sanitizeParams('') produces no valid keys → worker returns 400 "No valid parameters"
    expect(response.status).not.toBe(500);
    expect([200, 400]).toContain(response.status);
  });

  it('responds within 2 seconds', async () => {
    const start = Date.now();
    await makeRequest(
      'maps/api/place/nearbysearch/json',
      'location=40.7,-74.0&radius=1000'
    );
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(2000);
  });
});
