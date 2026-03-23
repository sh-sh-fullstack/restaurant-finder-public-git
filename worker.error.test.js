import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from './worker.js';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';

/**
 * Error Handling Tests for Cloudflare Worker
 * Phase 2.545 - Worker Error Handling
 *
 * These tests verify the Worker handles failures gracefully:
 * - Google API error responses (ZERO_RESULTS, INVALID_REQUEST, etc.)
 * - Network failures (timeout, unreachable, malformed JSON)
 * - Partial results and missing required fields
 * - Slow responses and connection drops
 * - Privacy: No sensitive data in error responses
 * - Performance: Errors return quickly, don't hang
 * - Logging: Errors logged for debugging without exposing secrets
 *
 * Real-world scenarios these protect against:
 * - User searches nonexistent city → ZERO_RESULTS (no crash)
 * - Google quota exhausted → OVER_QUERY_LIMIT (user sees helpful message)
 * - Google API down → Network timeout (fallback behavior)
 * - API key rotated wrong → REQUEST_DENIED (admin alerted, key not exposed)
 *
 * The Worker should:
 * - Return error responses to user (not crash)
 * - NOT expose sensitive information (API keys, user queries, IPs)
 * - Log errors for debugging with safe, structured data
 * - Maintain security even during failures
 * - Handle incomplete or malformed data gracefully
 * - Respond quickly even during errors (<2 seconds)
 * - Not consume extra Google quota during error states
 *
 * How to run:
 * - All tests: npm test
 * - Error tests only: npm test worker.error.test.js
 * - Specific test: npm test -- -t "ZERO_RESULTS"
 */

let fetchMock;

beforeEach(() => {
  fetchMock = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  fetchMock.mockRestore();
});

async function makeRequest(endpoint, params, method = 'GET', origin = 'https://sh-sh-fullstack.github.io') {
  const url = `https://worker.dev/?endpoint=${encodeURIComponent(endpoint)}&params=${encodeURIComponent(params)}`;

  const headers = {
    'CF-Connecting-IP': '1.2.3.4',
    'Origin': origin,
  };

  const request = new Request(url, { method, headers });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);

  return response;
}

// ---------------------------------------------------------------------------

describe('Google API error responses', () => {
  it('handles ZERO_RESULTS gracefully', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        status: 'ZERO_RESULTS',
        results: [],
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const response = await makeRequest('maps/api/geocode/json', 'address=NonexistentCity12345');

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('ZERO_RESULTS');
    expect(data.results).toEqual([]);
  });

  it('handles INVALID_REQUEST gracefully', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        status: 'INVALID_REQUEST',
        error_message: 'Invalid parameters',
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const response = await makeRequest('maps/api/geocode/json', 'address=test');

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('INVALID_REQUEST');
  });

  it('handles OVER_QUERY_LIMIT gracefully', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        status: 'OVER_QUERY_LIMIT',
        error_message: 'You have exceeded your daily request quota',
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const response = await makeRequest('maps/api/geocode/json', 'address=New+York');

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('OVER_QUERY_LIMIT');

    // CRITICAL: Verify Worker doesn't expose API key in error
    const responseText = JSON.stringify(data);
    expect(responseText).not.toContain('AIza');
    expect(responseText).not.toContain('GOOGLE_API_KEY');
  });

  it('handles REQUEST_DENIED gracefully', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        status: 'REQUEST_DENIED',
        error_message: 'This API key is not authorized',
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const response = await makeRequest('maps/api/geocode/json', 'address=New+York');

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('REQUEST_DENIED');

    // CRITICAL: Verify Worker doesn't expose API key
    const responseText = JSON.stringify(data);
    expect(responseText).not.toContain(env.GOOGLE_API_KEY || 'AIza');
  });

  it('handles UNKNOWN_ERROR gracefully', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        status: 'UNKNOWN_ERROR',
        error_message: 'A server error occurred',
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const response = await makeRequest('maps/api/geocode/json', 'address=New+York');

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('UNKNOWN_ERROR');
  });

  it('handles OK status with empty results array', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        status: 'OK',
        results: [],
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const response = await makeRequest('maps/api/geocode/json', 'address=New+York');

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('OK');
    expect(data.results).toEqual([]);
  });

  it('handles multiple error codes in sequence without crashing', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'INVALID_REQUEST' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );

    let response = await makeRequest('maps/api/geocode/json', 'address=test');
    expect(response.status).toBe(200);
    let data = await response.json();
    expect(data.status).toBe('INVALID_REQUEST');

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'OVER_QUERY_LIMIT' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );

    response = await makeRequest('maps/api/geocode/json', 'address=NYC');
    expect(response.status).toBe(200);
    data = await response.json();
    expect(data.status).toBe('OVER_QUERY_LIMIT');

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'OK', results: [] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );

    response = await makeRequest('maps/api/geocode/json', 'address=NYC');
    expect(response.status).toBe(200);
    data = await response.json();
    expect(data.status).toBe('OK');
  });
});

// ---------------------------------------------------------------------------

describe('Network failures', () => {
  it('handles fetch timeout gracefully', async () => {
    fetchMock.mockRejectedValue(new Error('Request timeout'));

    const startTime = Date.now();
    const response = await makeRequest('maps/api/geocode/json', 'address=New+York');
    const duration = Date.now() - startTime;

    expect([500, 502, 503, 504]).toContain(response.status);

    const text = await response.text();
    expect(text.length).toBeGreaterThan(0);

    // CRITICAL: Should not expose internal error details
    expect(text).not.toContain('GOOGLE_API_KEY');
    expect(text).not.toContain('env.');

    // PERFORMANCE: Should fail fast, not hang
    expect(duration).toBeLessThan(2000);
  });

  it('handles network unreachable gracefully', async () => {
    fetchMock.mockRejectedValue(new Error('Network unreachable'));

    const response = await makeRequest('maps/api/geocode/json', 'address=New+York');

    expect([500, 502, 503, 504]).toContain(response.status);

    const text = await response.text();
    expect(text.length).toBeGreaterThan(0);

    // PRIVACY: Should not leak user's search query in error
    expect(text.toLowerCase()).not.toContain('new york');
  });

  it('handles malformed JSON response gracefully', async () => {
    fetchMock.mockResolvedValue(
      new Response('<!DOCTYPE html><html>Error 500</html>', {
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const response = await makeRequest('maps/api/geocode/json', 'address=New+York');

    expect([200, 500, 502]).toContain(response.status);

    const text = await response.text();
    expect(text.length).toBeGreaterThan(0);
  });

  it('handles missing status field in response', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        results: [],
        // Missing 'status' field entirely
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const response = await makeRequest('maps/api/geocode/json', 'address=New+York');

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toBeDefined();
  });
});

// ---------------------------------------------------------------------------

describe('Partial and incomplete results', () => {
  it('handles partial results after filtering', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        status: 'OK',
        results: [
          { name: 'Restaurant A', user_ratings_total: 1500, rating: 4.5 },
          { name: 'Restaurant B', user_ratings_total: 50, rating: 4.8 },
          { name: 'Restaurant C', user_ratings_total: 1200, rating: 4.3 },
          { name: 'Restaurant D', user_ratings_total: 200, rating: 4.9 },
        ],
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const response = await makeRequest(
      'maps/api/place/nearbysearch/json',
      'location=40.7,-74.0&radius=5000&type=restaurant'
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('OK');
    expect(data.results.length).toBe(4);
  });

  it('handles response with missing required fields', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        status: 'OK',
        results: [
          { name: 'Restaurant A', rating: 4.5 },  // Missing user_ratings_total
          { user_ratings_total: 1500 },             // Missing name
          {},                                        // Completely empty object
        ],
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const response = await makeRequest(
      'maps/api/place/nearbysearch/json',
      'location=40.7,-74.0&radius=5000&type=restaurant'
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('OK');
  });

  it('handles slow response from Google without timing out prematurely', async () => {
    fetchMock.mockImplementation(() =>
      new Promise((resolve) =>
        setTimeout(() =>
          resolve(new Response(JSON.stringify({ status: 'OK', results: [] }), {
            headers: { 'Content-Type': 'application/json' },
          })), 100)
      )
    );

    const startTime = Date.now();
    const response = await makeRequest('maps/api/geocode/json', 'address=New+York');
    const duration = Date.now() - startTime;

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('OK');

    // Delay was respected (didn't timeout prematurely)
    expect(duration).toBeGreaterThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------

describe('Privacy and security in error responses', () => {
  it('does not expose user search query in error responses', async () => {
    fetchMock.mockRejectedValue(new Error('Internal error'));

    const response = await makeRequest(
      'maps/api/geocode/json',
      'address=123+Secret+Street+SafeHouse'
    );

    const text = await response.text();

    expect(text.toLowerCase()).not.toContain('secret');
    expect(text.toLowerCase()).not.toContain('safehouse');
    expect(text).not.toContain('123');
  });

  it('does not expose user IP in error responses', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));

    const response = await makeRequest('maps/api/geocode/json', 'address=New+York');

    const text = await response.text();

    // IP address from CF-Connecting-IP should not appear in response body
    expect(text).not.toContain('1.2.3.4');
  });
});

// ---------------------------------------------------------------------------

describe('Performance under failure conditions', () => {
  it('error responses return quickly (under 2 seconds)', async () => {
    fetchMock.mockRejectedValue(new Error('Simulated failure'));

    const startTime = Date.now();
    await makeRequest('maps/api/geocode/json', 'address=Test');
    const duration = Date.now() - startTime;

    expect(duration).toBeLessThan(2000);
  });

  it('handles rapid successive errors without degrading', async () => {
    fetchMock.mockRejectedValue(new Error('Persistent error'));

    const times = [];

    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      await makeRequest('maps/api/geocode/json', 'address=Test');
      times.push(Date.now() - start);
    }

    // 5th error should be no more than 1.5x slower than 1st (no degradation)
    expect(times[4]).toBeLessThanOrEqual(times[0] * 1.5);
  });
});
