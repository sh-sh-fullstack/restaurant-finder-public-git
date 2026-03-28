/**
 * index.security.test.js — Security Tests for index.html
 *
 * Verifies that the frontend correctly neutralizes malicious input before it
 * reaches the DOM. All payloads are FAKE test data — no real attacks are
 * performed. Tests run inside a jsdom sandbox with no actual script execution.
 *
 * OWASP Top 10 categories covered:
 *   A03:2021 – Injection        (XSS, HTML Injection)
 *   A04:2021 – Insecure Design  (DOM Clobbering)
 *   A08:2021 – Software and Data Integrity Failures (Prototype Pollution)
 *
 * Zero API calls — all restaurant data is mocked JavaScript objects.
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

function makeDom() {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', url: 'http://localhost' });
  return { win: dom.window, doc: dom.window.document };
}

/** Factory for mock place objects — all fields are fake test data. */
function makePlace(overrides = {}) {
  return {
    name: 'Safe Restaurant',
    rating: 4.2,
    user_ratings_total: 2000,
    vicinity: '123 Fake St',
    price_level: 2,
    types: ['restaurant'],
    ...overrides,
  };
}

// ── XSS Prevention ────────────────────────────────────────────────────────
// Verifies that escHtml() neutralizes all common cross-site scripting vectors
// before they reach innerHTML. A failure here would allow arbitrary JavaScript
// execution in every visitor's browser session.

describe('XSS Prevention', () => {
  /**
   * ATTACK PAYLOAD: Classic script-tag injection via restaurant name field.
   * OWASP: A03:2021 – Injection
   * Real-world impact: Attacker submits a malicious business name to Google
   *   Places that contains a <script> tag; if unescaped, every visitor to the
   *   app executes the attacker's code and exposes session data.
   * Prevention: escHtml() converts < → &lt; and > → &gt; so the browser
   *   renders the tag as visible text, never as an executable element.
   */
  it('blocks <script> tag injection in restaurant name — rendered as escaped text', () => {
    const { win, doc } = makeDom();

    // ATTACK PAYLOAD — XSS via script-tag injection
    const place = makePlace({ name: '<script>alert("xss")</script>' });
    win.renderResults([place]);

    const resultsEl = doc.getElementById('results');

    // Defense 1: no <script> elements may exist inside the results container
    expect(resultsEl.querySelectorAll('script').length).toBe(0);

    // Defense 2: the tag must survive as escaped text, confirming escHtml ran
    const card = resultsEl.querySelector('[data-testid="restaurant-card"]');
    expect(card.innerHTML).toContain('&lt;script&gt;');
    expect(card.innerHTML).not.toContain('<script>');
  });

  /**
   * ATTACK PAYLOAD: Event-handler injection via <img onerror> in address field.
   * OWASP: A03:2021 – Injection
   * Real-world impact: onerror fires automatically when the browser fails to
   *   load the image — no user interaction required. Attackers use this to run
   *   keyloggers or exfiltrate data silently.
   * Prevention: escHtml() escapes < so the img tag is never parsed by the browser.
   */
  it('blocks <img onerror> event-handler injection in address field', () => {
    const { win, doc } = makeDom();

    // ATTACK PAYLOAD — XSS via img onerror event handler
    const place = makePlace({ vicinity: '<img src=x onerror="alert(\'xss\')">' });
    win.renderResults([place]);

    const resultsEl = doc.getElementById('results');

    // Defense 1: no img elements with an onerror attribute may exist
    expect(resultsEl.querySelectorAll('img[onerror]').length).toBe(0);

    // Defense 2: raw attack string must not appear; escaped form must
    expect(resultsEl.innerHTML).not.toContain('<img src=x');
    expect(resultsEl.innerHTML).toContain('&lt;img');
  });

  /**
   * ATTACK PAYLOAD: javascript: URI scheme that executes code on navigation.
   * OWASP: A03:2021 – Injection
   * Real-world impact: If ever placed inside an <a href>, a single click
   *   runs arbitrary JavaScript in the user's session with full DOM access.
   * Prevention: escHtml() escapes " → &quot;, breaking the URI; the app
   *   also never renders user-supplied data inside href attributes.
   */
  it('neutralizes javascript: URI — quotes escaped, no clickable href created', () => {
    const { win, doc } = makeDom();

    // ATTACK PAYLOAD — javascript: URI that would fire on anchor click
    const ATTACK_URI = 'javascript:alert("xss")';

    // Defense 1: escHtml neutralizes the double-quote in the URI
    const escaped = win.escHtml(ATTACK_URI);
    expect(escaped).toContain('&quot;');
    expect(escaped).not.toContain('"');

    // Defense 2: end-to-end render produces no anchor pointing to a javascript: URI
    const place = makePlace({ vicinity: ATTACK_URI });
    win.renderResults([place]);
    const dangerousAnchors = doc.getElementById('results').querySelectorAll('a[href^="javascript:"]');
    expect(dangerousAnchors.length).toBe(0);
  });
});

// ── HTML Injection ────────────────────────────────────────────────────────
// Verifies that structural HTML tags injected through API data fields are
// escaped rather than parsed, preventing page-layout tampering and
// secondary script execution vectors.

describe('HTML Injection', () => {
  /**
   * ATTACK PAYLOAD: <iframe> injection to embed an attacker-controlled page.
   * OWASP: A03:2021 – Injection
   * Real-world impact: An iframe silently loads a phishing login form inside
   *   the app's trusted origin, stealing credentials under the real domain.
   * Prevention: escHtml() escapes < and > so the iframe tag becomes inert text.
   */
  it('blocks <iframe> injection — no iframe element is created in results', () => {
    const { win, doc } = makeDom();

    // ATTACK PAYLOAD — iframe embedding external malicious page
    const place = makePlace({ name: '<iframe src="http://evil.example.com"></iframe>' });
    win.renderResults([place]);

    const resultsEl = doc.getElementById('results');

    // Defense: no iframe elements may exist anywhere in the results section
    expect(resultsEl.querySelectorAll('iframe').length).toBe(0);
    expect(resultsEl.innerHTML).toContain('&lt;iframe');
    expect(resultsEl.innerHTML).not.toContain('<iframe');
  });

  /**
   * ATTACK PAYLOAD: <svg onload> injection — SVG executes JS via the onload event.
   * OWASP: A03:2021 – Injection
   * Real-world impact: Bypasses naive HTML-tag-only XSS filters that do not
   *   account for SVG's ability to carry inline event handlers in HTML5 contexts.
   * Prevention: escHtml() escapes < so the SVG tag is never parsed; the star
   *   icons use known-safe inline SVG without event attributes.
   */
  it('blocks <svg onload> injection — no SVG with onload attribute is created', () => {
    const { win, doc } = makeDom();

    // ATTACK PAYLOAD — SVG with onload event handler (common HTML5 XSS bypass)
    const place = makePlace({ name: '<svg onload="alert(\'xss\')">PAYLOAD</svg>' });
    win.renderResults([place]);

    const resultsEl = doc.getElementById('results');

    // Defense: legitimate star SVGs exist, but none may carry an onload attribute
    expect(resultsEl.querySelectorAll('svg[onload]').length).toBe(0);
    expect(resultsEl.innerHTML).toContain('&lt;svg');
    expect(resultsEl.innerHTML).not.toContain('<svg onload');
  });
});

// ── DOM Clobbering ────────────────────────────────────────────────────────
// Verifies that rendering text content with names matching DOM API properties
// or built-in globals does not overwrite those APIs. DOM clobbering requires
// elements with id= or name= attributes — escHtml() prevents injection of
// attribute syntax, so the attack surface never materialises.

describe('DOM Clobbering', () => {
  /**
   * ATTACK PAYLOAD: Restaurant named "getElementById" to shadow the DOM API.
   * OWASP: A04:2021 – Insecure Design
   * Real-world impact: Clobbering document.getElementById breaks every
   *   subsequent DOM lookup the app performs, enabling denial-of-service or,
   *   in frameworks that read named window properties, privilege escalation.
   * Prevention: Card names are rendered as text content via escHtml() with no
   *   id= or name= attribute injection, so no DOM clobbering is possible.
   */
  it('rendering a place named "getElementById" does not overwrite document.getElementById', () => {
    const { win, doc } = makeDom();

    // ATTACK PAYLOAD — name matching a critical DOM API method
    const place = makePlace({ name: 'getElementById' });
    win.renderResults([place]);

    // Core DOM API must remain a callable function after rendering
    expect(typeof doc.getElementById).toBe('function');
    expect(doc.getElementById('results')).not.toBeNull();
    expect(doc.getElementById('status')).not.toBeNull();
  });

  /**
   * ATTACK PAYLOAD: Restaurant named "constructor" to shadow Object's constructor.
   * OWASP: A04:2021 – Insecure Design
   * Real-world impact: Shadowing 'constructor' on the global scope can break
   *   isinstance checks and security assertions that rely on object identity,
   *   potentially enabling auth bypass in poorly-written guards.
   * Prevention: Same as above — text content is never assigned as an id or name
   *   attribute, so the global property cannot be overwritten.
   */
  it('rendering a place named "constructor" does not shadow Object.prototype.constructor', () => {
    const { win, doc } = makeDom();

    // ATTACK PAYLOAD — name matching a built-in prototype property
    const place = makePlace({ name: 'constructor' });
    win.renderResults([place]);

    // Verify within the JSDOM realm — cross-realm Object references are intentionally distinct
    expect(typeof win.Object.prototype.constructor).toBe('function');
    expect(win.Object.prototype.constructor).toBe(win.Object);
  });
});

// ── Prototype Pollution ───────────────────────────────────────────────────
// Verifies that processing API response data (modelled as JSON) cannot inject
// properties onto Object.prototype. Prototype pollution affects every object
// in the runtime and is the root cause of many high-severity CVEs.

describe('Prototype Pollution', () => {
  /**
   * ATTACK PAYLOAD: JSON response containing a "__proto__" key.
   * OWASP: A08:2021 – Software and Data Integrity Failures
   * Real-world impact: If the app deep-merges place objects with a utility that
   *   follows __proto__, the attacker adds arbitrary properties to every plain
   *   object in the app — enabling privilege escalation (e.g. isAdmin: true) or
   *   crashing security-sensitive code paths that check for property existence.
   * Prevention: The app uses Object.assign({}, p, ...) which copies only own
   *   enumerable properties; JSON.parse(__proto__) produces a regular key on
   *   the parsed object, not a prototype modification, so no pollution occurs.
   */
  it('processing a JSON place payload with __proto__ does not pollute Object.prototype', () => {
    const { win, doc } = makeDom();

    // ATTACK PAYLOAD — realistic server-response attack: __proto__ via JSON.parse
    // JSON.parse is the standard delivery vehicle for prototype pollution because
    // it treats "__proto__" as a regular string key rather than a property accessor.
    const maliciousJSON =
      '{"name":"Evil Bistro","rating":4.5,"user_ratings_total":1500,' +
      '"vicinity":"1 Hack St","price_level":1,"types":["restaurant"],' +
      '"__proto__":{"polluted":true}}';

    const maliciousPlace = JSON.parse(maliciousJSON);

    // Baseline: Object.prototype is clean before the app processes the payload
    expect(({}).polluted).toBeUndefined();
    expect(win.Object.prototype.polluted).toBeUndefined();

    win.renderResults([maliciousPlace]);

    // After rendering, Object.prototype must remain unpolluted
    expect(({}).polluted).toBeUndefined();
    expect(win.Object.prototype.polluted).toBeUndefined();
  });
});
