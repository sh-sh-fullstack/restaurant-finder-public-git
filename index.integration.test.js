/**
 * index.integration.test.js — Frontend Integration Tests
 *
 * Tests DOM manipulation and rendering logic from index.html.
 * Does NOT call the Cloudflare Worker or Google Places API.
 * All restaurant data is mocked JavaScript objects.
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

/**
 * Creates an isolated JSDOM instance with index.html loaded and scripts executed.
 * Each test gets its own DOM so state never leaks between tests.
 */
function makeDom() {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'http://localhost',
  });
  return { dom, win: dom.window, doc: dom.window.document };
}

/**
 * Factory for mock restaurant objects. All fields match the Google Places API
 * shape used by renderResults() and renderCardList() in index.html.
 */
function makePlace(overrides = {}) {
  return {
    name: 'Test Restaurant',
    rating: 4.2,
    user_ratings_total: 2000,
    vicinity: '123 Main St',
    price_level: 2,
    types: ['restaurant'],
    ...overrides,
  };
}

// ── 1. Review Filter Tests ─────────────────────────────────────────────────

describe('Review Filter Tests', () => {
  it('filters out restaurants with fewer than 1000 reviews', () => {
    const { win, doc } = makeDom();
    const lowReviewPlace = makePlace({ name: 'Low Crowd Diner', user_ratings_total: 999 });

    win.renderResults([lowReviewPlace]);

    const cards = doc.querySelectorAll('[data-testid="restaurant-card"]');
    expect(cards.length).toBe(0);
    expect(doc.getElementById('results').innerHTML).toContain('No results found');
  });

  it('keeps restaurants with 1000 or more reviews', () => {
    const { win, doc } = makeDom();
    const goodPlace = makePlace({ name: 'Popular Bistro', user_ratings_total: 1500 });

    win.renderResults([goodPlace]);

    const cards = doc.querySelectorAll('[data-testid="restaurant-card"]');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Popular Bistro');
  });

  it('handles edge case of exactly 1000 reviews (should pass the filter)', () => {
    const { win, doc } = makeDom();
    const edgePlace = makePlace({ name: 'Just Enough', user_ratings_total: 1000 });

    win.renderResults([edgePlace]);

    const cards = doc.querySelectorAll('[data-testid="restaurant-card"]');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Just Enough');
  });
});

// ── 2. Star Rendering Tests ────────────────────────────────────────────────

describe('Star Rendering Tests', () => {
  it('renders 4 full stars and 1 empty star for a rating of 4.0', () => {
    const { win } = makeDom();
    const html = win.starsHtml(4);

    // Full stars use fill="#fbbf24", half stars use starHalfGrad, empty use fill="#d1d5db"
    const fullCount  = (html.match(/fill="#fbbf24"/g)    || []).length;
    const halfCount  = (html.match(/starHalfGrad/g)      || []).length;
    const emptyCount = (html.match(/fill="#d1d5db"/g)    || []).length;

    expect(fullCount).toBe(4);
    expect(halfCount).toBe(0);
    expect(emptyCount).toBe(1);
  });

  it('renders 4 full stars and 1 half star for a rating of 4.5', () => {
    const { win } = makeDom();
    const html = win.starsHtml(4.5);

    const fullCount  = (html.match(/fill="#fbbf24"/g)    || []).length;
    const halfCount  = (html.match(/starHalfGrad/g)      || []).length;
    const emptyCount = (html.match(/fill="#d1d5db"/g)    || []).length;

    expect(fullCount).toBe(4);
    expect(halfCount).toBe(1);
    expect(emptyCount).toBe(0);
  });
});

// ── 3. XSS Protection Tests ────────────────────────────────────────────────

describe('XSS Protection Tests', () => {
  it('escHtml() escapes <script> injection in restaurant names', () => {
    const { win, doc } = makeDom();
    const maliciousPlace = makePlace({ name: '<script>alert("xss")</script>' });

    win.renderResults([maliciousPlace]);

    const card = doc.querySelector('[data-testid="restaurant-card"]');
    expect(card).toBeTruthy();

    // The raw <script> tag must not appear in the DOM as executable HTML
    expect(card.innerHTML).not.toContain('<script>');
    // It must be present as escaped text
    expect(card.innerHTML).toContain('&lt;script&gt;');
  });

  it('escHtml() prevents HTML injection in cuisine / vicinity fields', () => {
    const { win } = makeDom();
    const injectionString = '<img src=x onerror="alert(1)">';
    const escaped = win.escHtml(injectionString);

    // Must not retain the raw tag
    expect(escaped).not.toContain('<img');
    // Must be fully escaped
    expect(escaped).toContain('&lt;img');
    expect(escaped).toContain('&quot;');
  });
});

// ── 4. Empty State Tests ───────────────────────────────────────────────────

describe('Empty State Tests', () => {
  it('shows "No results found" message when all restaurants are below the review threshold', () => {
    const { win, doc } = makeDom();
    const places = [
      makePlace({ name: 'Quiet Corner', user_ratings_total: 42 }),
      makePlace({ name: 'Tiny Tearoom', user_ratings_total: 500 }),
    ];

    win.renderResults(places);

    const results = doc.getElementById('results');
    expect(results.innerHTML).toContain('No results found');
  });
});

// ── 5. Missing Data Tests ──────────────────────────────────────────────────

describe('Missing Data Tests', () => {
  it('handles missing price_level gracefully — no price tag rendered', () => {
    const { win, doc } = makeDom();
    const noPrice = makePlace({ name: 'Price Unknown', price_level: undefined });

    win.renderResults([noPrice]);

    const card = doc.querySelector('[data-testid="restaurant-card"]');
    expect(card).toBeTruthy();
    // No .tag-price element should appear when price_level is absent
    expect(card.querySelector('.tag-price')).toBeNull();
  });

  it('handles missing opening_hours — card renders without open/closed tag', () => {
    const { win, doc } = makeDom();
    const noHours = makePlace({ name: 'Mystery Hours', opening_hours: undefined });

    win.renderResults([noHours]);

    const card = doc.querySelector('[data-testid="restaurant-card"]');
    expect(card).toBeTruthy();
    expect(card.querySelector('.tag-open')).toBeNull();
    expect(card.querySelector('.tag-closed')).toBeNull();
  });
});
