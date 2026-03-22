/**
 * worker.unit.test.js — Unit Tests for sanitizeParams()
 *
 * These are UNIT tests: they test sanitizeParams() in complete isolation,
 * with no HTTP requests, no Worker runtime, no mocks needed.
 *
 * What sanitizeParams() does:
 *   - Filters incoming params to an allowed list of 9 keys:
 *     location, radius, type, keyword, rankby, pagetoken, address, latlng, query
 *   - Truncates regular param values to 200 chars
 *   - Truncates pagetoken values to 1000 chars (Google pagetokens can exceed 600 chars)
 *   - Returns a query string with %2C replaced by literal commas (Google coordinate format)
 *
 * Why unit tests matter:
 *   Integration tests verify the Worker responds correctly end-to-end, but they
 *   can't easily pinpoint WHERE a bug is. Unit tests isolate sanitizeParams() so
 *   a failure here points directly at the filtering/truncation logic.
 *
 * How to run all tests:        npm test
 * How to run only unit tests:  npm test worker.unit.test.js
 */

import { describe, it, expect } from 'vitest';
import { sanitizeParams } from './worker.js';

// ---------------------------------------------------------------------------

describe('sanitizeParams() - valid params', () => {
  it('allows all valid param keys through', () => {
    const result = sanitizeParams('location=40.7,-74.0&radius=5000&type=restaurant&keyword=pizza');
    const params = new URLSearchParams(result);

    expect(params.has('location')).toBe(true);
    expect(params.has('radius')).toBe(true);
    expect(params.has('type')).toBe(true);
    expect(params.has('keyword')).toBe(true);
  });

  it('preserves param values exactly', () => {
    const result = sanitizeParams('address=New+York');
    const params = new URLSearchParams(result);

    expect(params.get('address')).toBe('New York');
  });

  it('allows all 9 expected params in one request', () => {
    const result = sanitizeParams(
      'location=40.7,-74&radius=5000&type=restaurant&keyword=pizza' +
      '&rankby=prominence&pagetoken=abc&address=NYC&latlng=40,-74&query=food'
    );
    const params = new URLSearchParams(result);

    expect(params.has('location')).toBe(true);
    expect(params.has('radius')).toBe(true);
    expect(params.has('type')).toBe(true);
    expect(params.has('keyword')).toBe(true);
    expect(params.has('rankby')).toBe(true);
    expect(params.has('pagetoken')).toBe(true);
    expect(params.has('address')).toBe(true);
    expect(params.has('latlng')).toBe(true);
    expect(params.has('query')).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('sanitizeParams() - invalid params', () => {
  it('filters out single invalid param', () => {
    const result = sanitizeParams('location=40.7&malicious=hack');
    const params = new URLSearchParams(result);

    expect(params.has('location')).toBe(true);
    expect(params.has('malicious')).toBe(false);
  });

  it('filters out multiple invalid params', () => {
    const result = sanitizeParams('location=40.7&evil=code&bad=stuff&radius=5000');
    const params = new URLSearchParams(result);

    expect(params.has('location')).toBe(true);
    expect(params.has('radius')).toBe(true);
    expect(params.has('evil')).toBe(false);
    expect(params.has('bad')).toBe(false);
  });

  it('returns empty string when all params invalid', () => {
    const result = sanitizeParams('malicious=hack&evil=code');
    expect(result).toBe('');
  });

  it('blocks common injection attempts', () => {
    const result = sanitizeParams("location=40.7&script=<script>&sql=DROP TABLE");
    const params = new URLSearchParams(result);

    expect(params.has('location')).toBe(true);
    expect(params.has('script')).toBe(false);
    expect(params.has('sql')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('sanitizeParams() - value length limits', () => {
  it('allows values under 200 chars for regular params', () => {
    const result = sanitizeParams('address=' + 'a'.repeat(150));
    const params = new URLSearchParams(result);

    expect(params.get('address').length).toBe(150);
  });

  it('truncates regular param values to exactly 200 chars', () => {
    const result = sanitizeParams('address=' + 'a'.repeat(250));
    const params = new URLSearchParams(result);

    expect(params.get('address').length).toBe(200);
  });

  it('allows pagetoken up to 1000 chars', () => {
    const result = sanitizeParams('pagetoken=' + 'b'.repeat(1000));
    const params = new URLSearchParams(result);

    expect(params.get('pagetoken').length).toBe(1000);
  });

  it('truncates pagetoken to exactly 1000 chars', () => {
    const result = sanitizeParams('pagetoken=' + 'b'.repeat(1500));
    const params = new URLSearchParams(result);

    expect(params.get('pagetoken').length).toBe(1000);
  });

  it('different params can have different length limits in same request', () => {
    const result = sanitizeParams(
      'address=' + 'a'.repeat(250) + '&pagetoken=' + 'b'.repeat(1500)
    );
    const params = new URLSearchParams(result);

    expect(params.get('address').length).toBe(200);
    expect(params.get('pagetoken').length).toBe(1000);
  });
});

// ---------------------------------------------------------------------------

describe('sanitizeParams() - edge cases', () => {
  it('handles empty string input', () => {
    const result = sanitizeParams('');
    expect(result).toBe('');
  });

  it('handles only invalid params', () => {
    const result = sanitizeParams('hack=1&exploit=2&inject=3');
    expect(result).toBe('');
  });

  it('preserves URL encoding in values', () => {
    const result = sanitizeParams('address=New%20York&type=restaurant');
    const params = new URLSearchParams(result);

    // URLSearchParams decodes %20 to a space when reading, but round-trips correctly
    expect(params.get('address')).toBe('New York');
    expect(params.has('type')).toBe(true);
  });

  it('handles params with equals signs in value', () => {
    const result = sanitizeParams('query=a=b');
    const params = new URLSearchParams(result);

    expect(params.get('query')).toBe('a=b');
  });

  it('handles duplicate param keys — URLSearchParams.set() keeps last value', () => {
    // NOTE: sanitizeParams uses output.set(key, value) which overwrites on duplicates.
    // URLSearchParams.entries() yields duplicates in order, so the last one wins.
    const result = sanitizeParams('location=40.7&location=41.0');
    const params = new URLSearchParams(result);

    expect(params.get('location')).toBe('41.0');
  });

  it('handles params with no value', () => {
    const result = sanitizeParams('location=40.7&type=');
    const params = new URLSearchParams(result);

    expect(params.has('location')).toBe(true);
    expect(params.get('location')).toBe('40.7');
    // 'type' is present but empty — output.set('type', '') still includes it
    expect(params.has('type')).toBe(true);
    expect(params.get('type')).toBe('');
  });
});

// ---------------------------------------------------------------------------

describe('sanitizeParams() - param matching rules', () => {
  it('param matching is case-sensitive', () => {
    const result = sanitizeParams('LOCATION=40.7&location=41.0');
    const params = new URLSearchParams(result);

    // Only lowercase 'location' is in ALLOWED_PARAMS
    expect(params.has('location')).toBe(true);
    expect(params.has('LOCATION')).toBe(false);
  });

  it('rejects params with similar names to allowed params', () => {
    const result = sanitizeParams('location=40.7&location2=41.0&locations=42.0');
    const params = new URLSearchParams(result);

    expect(params.has('location')).toBe(true);
    expect(params.has('location2')).toBe(false);
    expect(params.has('locations')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('ALLOWED_PARAMS constant verification', () => {
  it('contains exactly 9 allowed params', () => {
    // Verify all 9 known-allowed params pass through
    const allNine = 'location=1&radius=2&type=3&keyword=4&rankby=5&pagetoken=6&address=7&latlng=8&query=9';
    const result = sanitizeParams(allNine);
    const params = new URLSearchParams(result);

    const expectedKeys = ['location', 'radius', 'type', 'keyword', 'rankby', 'pagetoken', 'address', 'latlng', 'query'];
    for (const key of expectedKeys) {
      expect(params.has(key)).toBe(true);
    }
    // Confirm total count is exactly 9
    expect([...params.keys()].length).toBe(9);
  });

  it('rejects a param not in the list of 9', () => {
    const result = sanitizeParams('location=40.7&notinlist=value');
    const params = new URLSearchParams(result);

    expect(params.has('location')).toBe(true);
    expect(params.has('notinlist')).toBe(false);
  });
});
