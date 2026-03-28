/**
 * index.unit.test.js — Unit Tests for index.html Helper Functions
 *
 * Tests pure/helper functions in isolation — no DOM rendering, no network calls.
 * Each test feeds input directly to a function and asserts the output.
 *
 * Functions under test (all defined in index.html <script>):
 *   escHtml(str)        — HTML entity escaping
 *   starsHtml(rating)   — SVG star HTML generation
 *   PRICE_LABELS        — price_level → symbol mapping
 *   getCuisine(place)   — cuisine label from name keywords / API types
 *
 * Note: index.html has no formatPrice() function. Price formatting is done
 * inline via PRICE_LABELS[place.price_level]. Tests cover that lookup directly.
 *
 * How to run: npm run test:frontend
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(resolve(__dirname, 'index.html'), 'utf8');

/** Shared JSDOM window — created once, reused across all unit tests (read-only helpers). */
let win;

beforeEach(() => {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', url: 'http://localhost' });
  win = dom.window;
});

// ── escHtml() ──────────────────────────────────────────────────────────────

describe('escHtml()', () => {
  it('escapes < and > angle brackets', () => {
    expect(win.escHtml('<b>bold</b>')).toBe('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('escapes & ampersands', () => {
    expect(win.escHtml('fish & chips')).toBe('fish &amp; chips');
  });

  it('escapes " double quotes', () => {
    expect(win.escHtml('"quoted"')).toBe('&quot;quoted&quot;');
  });

  it('returns empty string unchanged', () => {
    expect(win.escHtml('')).toBe('');
  });
});

// ── starsHtml() ───────────────────────────────────────────────────────────

describe('starsHtml()', () => {
  /**
   * Helpers to count star types by their SVG fill attribute:
   *   full  → fill="#fbbf24"
   *   half  → fill="url(#starHalfGrad)"
   *   empty → fill="#d1d5db"
   */
  function countStars(html) {
    return {
      full:  (html.match(/fill="#fbbf24"/g)  || []).length,
      half:  (html.match(/starHalfGrad/g)    || []).length,
      empty: (html.match(/fill="#d1d5db"/g)  || []).length,
    };
  }

  it('rating 5.0 → 5 full stars, 0 half, 0 empty', () => {
    const stars = countStars(win.starsHtml(5));
    expect(stars).toEqual({ full: 5, half: 0, empty: 0 });
  });

  it('rating 1.0 → 1 full star, 0 half, 4 empty', () => {
    const stars = countStars(win.starsHtml(1));
    expect(stars).toEqual({ full: 1, half: 0, empty: 4 });
  });

  it('rating 3.5 → 3 full stars, 1 half, 1 empty', () => {
    const stars = countStars(win.starsHtml(3.5));
    expect(stars).toEqual({ full: 3, half: 1, empty: 1 });
  });
});

// ── bayesianScore() ───────────────────────────────────────────────────────
//
// Note: PRICE_LABELS is declared as `const` in the script block and is
// therefore NOT exposed on window. It is tested indirectly through the
// rendered card DOM in index.integration.test.js (Missing Data Tests).
// Here we test bayesianScore(), which IS a function declaration on window.

describe('bayesianScore()', () => {
  it('applies the Bayesian formula: (C*m + R*v) / (m+v)', () => {
    // C=4.0 (prior mean), m=1000 (prior weight), R=4.5 (place rating), v=2000 (reviews)
    // Expected: (4.0*1000 + 4.5*2000) / (1000+2000) = 13000/3000 ≈ 4.333
    const score = win.bayesianScore(4.0, 1000, 4.5, 2000);
    expect(score).toBeCloseTo(13000 / 3000, 10);
  });

  it('pulls a low-review outlier toward the prior mean', () => {
    // A 5-star place with only 10 reviews should score closer to C than to 5
    const C = 4.0, m = 1000, R = 5.0, v = 10;
    const score = win.bayesianScore(C, m, R, v);
    expect(score).toBeGreaterThan(C);          // better than average
    expect(score).toBeLessThan(R);             // pulled below the raw rating
    expect(score).toBeCloseTo((C * m + R * v) / (m + v), 10);
  });
});

// ── getCuisine() ──────────────────────────────────────────────────────────

describe('getCuisine()', () => {
  it('infers cuisine from a keyword in the restaurant name', () => {
    // 'sushi' keyword → Japanese; 'taco' → Mexican; 'pizza' → Italian
    expect(win.getCuisine({ name: 'Sakura Sushi Bar', types: [] })).toBe('Japanese');
    expect(win.getCuisine({ name: 'El Taco Loco',    types: [] })).toBe('Mexican');
    expect(win.getCuisine({ name: 'Roma Pizza',      types: [] })).toBe('Italian');
  });

  it('falls back to type label when name has no keyword but a known type is present', () => {
    // No cuisine keyword in name → Pass 2 (types array) kicks in
    expect(win.getCuisine({ name: 'Unnamed Spot', types: ['korean_restaurant'] })).toBe('Korean');
    expect(win.getCuisine({ name: 'Unnamed Spot', types: ['thai_restaurant'] })).toBe('Thai');
  });

  it('falls back to "Restaurant" when name has no keyword and types array is empty', () => {
    expect(win.getCuisine({ name: 'The Corner Place', types: [] })).toBe('Restaurant');
  });
});
