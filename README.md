# Proven — Restaurant Finder

Find restaurants ranked by review count and Bayesian score.

## Pages

| File | Description |
|---|---|
| `index.html` | Main search interface — geocodes a location, queries Google Places, and ranks results using a Bayesian formula |
| `about.html` | The idea behind the project — why ranking by review count matters |
| `formula.html` | Explains the Bayesian ranking formula with variable definitions and a worked example |

## Backend

`worker.js` — Cloudflare Worker that proxies requests to the Google Places API. Handles CORS, rate limiting (30 req / 60 s per IP), parameter sanitisation, and endpoint allow-listing.

## Tests

```
npm test                  # backend (Cloudflare workerd)
npm run test:frontend     # frontend (jsdom)
npm run test:all          # both suites
npm run coverage:frontend # frontend coverage report
```

Test files:

| File | Suite | Environment |
|---|---|---|
| `worker.test.js` | Worker logic | workerd |
| `worker.config.test.js` | Config / error paths | workerd |
| `index.integration.test.js` | DOM integration | jsdom |
| `index.unit.test.js` | Pure helper functions | jsdom |
| `index.security.test.js` | OWASP security tests | jsdom |
