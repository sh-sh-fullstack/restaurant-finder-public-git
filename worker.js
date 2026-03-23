const ALLOWED_ORIGIN = 'https://sh-sh-fullstack.github.io';
const RATE_LIMIT_REQUESTS = 30;  // max requests
const RATE_LIMIT_WINDOW = 60;    // per 60 seconds

// Only these param keys are allowed through to Google
const ALLOWED_PARAMS = new Set([
  'location',
  'radius',
  'type',
  'keyword',
  'rankby',
  'pagetoken',
  'address',
  'latlng',
  'query',
]);

export function sanitizeParams(rawParams) {
  // NOTE: %2C is replaced with literal commas after serialization because
  // Google Maps expects unencoded commas in coordinate values like lat,lng.
  // URLSearchParams encodes them by default. Both forms are valid per the
  // Google API but literal commas are more readable in logs.
  const PARAM_MAX_LENGTHS = {
    pagetoken: 1000,
    // 1000 chars based on observed Google pagetoken lengths exceeding 600.
    // No official Google doc specifies a maximum — treat as a safe upper bound.
  };
  console.log('[sanitize] input:', rawParams.slice(0, 200));

  const input = new URLSearchParams(rawParams);
  const output = new URLSearchParams();

  for (const [key, value] of input.entries()) {
    if (ALLOWED_PARAMS.has(key)) {
      output.set(key, value.slice(0, PARAM_MAX_LENGTHS[key] || 200));
    }
  }

  return output.toString().replace(/%2C/gi, ',');
}


export default {
  async fetch(request, env, ctx) {
    // Rate limiting using Cloudflare's CF-Connecting-IP header
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

    // Config validation — fail fast before any external calls
    if (!env.GOOGLE_API_KEY) {
      console.log('[error] Missing GOOGLE_API_KEY binding', { ip: clientIP });
      return new Response(JSON.stringify({ status: 'ERROR', error_message: 'Service temporarily unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
      });
    }

    const rateLimitKey = `rate_limit:${clientIP}`;

    let currentCount;
    try {
      currentCount = await env.RATE_LIMITER.get(rateLimitKey);
    } catch (err) {
      console.log('[error] RATE_LIMITER unavailable', { ip: clientIP, error: err.message });
      return new Response(JSON.stringify({ status: 'ERROR', error_message: 'Service temporarily unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
      });
    }

    if (currentCount && parseInt(currentCount) >= RATE_LIMIT_REQUESTS) {
      return new Response('Too many requests', {
        status: 429,
        headers: {
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
          'Retry-After': RATE_LIMIT_WINDOW.toString(),
        },
      });
    }

    // Increment counter
    const newCount = currentCount ? parseInt(currentCount) + 1 : 1;
    ctx.waitUntil(
      env.RATE_LIMITER.put(rateLimitKey, newCount.toString(), {
        expirationTtl: RATE_LIMIT_WINDOW,
      }).catch(err => console.log('[error] RATE_LIMITER put failed', { ip: clientIP, error: err.message }))
    );

    // Origin validation (balanced approach - logs missing origins, blocks wrong ones)
    const origin = request.headers.get('Origin');

    // Log requests without origin header (curl, Postman, etc.)
    if (!origin) {
      console.log('[warning] Request without Origin header', {
        ip: clientIP,
        method: request.method,
      });
      // Allow to continue - these are typically testing tools
    }

    // Block requests from wrong origins (malicious browser-based attacks)
    if (origin && origin !== ALLOWED_ORIGIN) {
      console.log('[blocked] Invalid origin', {
        ip: clientIP,
        origin,
        allowed: ALLOWED_ORIGIN,
      });
      return new Response('Forbidden - Invalid Origin', {
        status: 403,
        headers: {
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        },
      });
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Only allow GET requests
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }

    const url = new URL(request.url);
    const endpoint = url.searchParams.get('endpoint');
    const params = url.searchParams.get('params');

    if (!endpoint || !params) {
      return new Response('Missing parameters', { status: 400 });
    }

    // Only allow specific Google API endpoints
    const allowedEndpoints = [
      'maps/api/geocode/json',
      'maps/api/place/nearbysearch/json',
      'maps/api/place/textsearch/json',
    ];

    if (!allowedEndpoints.includes(endpoint)) {
      console.log('[blocked] endpoint not allowed', { ip: clientIP, endpoint });
      return new Response('Endpoint not allowed', { status: 403 });
    }

    // params is already decoded once by url.searchParams.get() — do not call decodeURIComponent again
    const cleanParams = sanitizeParams(params);

    if (!cleanParams) {
      console.log('[blocked] no valid params after sanitization', { ip: clientIP, endpoint, params });
      return new Response('No valid parameters', { status: 400 });
    }
    
    const googleUrl = `https://maps.googleapis.com/${endpoint}?${cleanParams}&key=${env.GOOGLE_API_KEY}`;
    console.log('[request]', { ip: clientIP, origin: origin || 'none', endpoint, cleanParams });

    let data;
    try {
      const googleResponse = await fetch(googleUrl);
      data = await googleResponse.json();
    } catch (err) {
      console.log('[error] Google API request failed', {
        ip: clientIP,
        endpoint,
        error: err.message,
        timestamp: new Date().toISOString(),
      });

      let errorMessage = 'Service unavailable';
      let statusCode = 502;

      if (err.message.includes('timeout') || err.message.includes('time')) {
        errorMessage = 'Google Maps is taking too long to respond. Please try again.';
        statusCode = 504;

      } else if (err.message.includes('JSON') || err.message.includes('parse') || err.message.includes('Unexpected')) {
        errorMessage = 'Received invalid data from Google Maps. Please try again.';
        statusCode = 502;

      } else if (err.message.includes('network') || err.message.includes('fetch') || err.message.includes('unreachable')) {
        errorMessage = 'Cannot reach Google Maps. Check your internet connection.';
        statusCode = 503;
      }

      return new Response(JSON.stringify({
        status: 'ERROR',
        error_message: errorMessage,
      }), {
        status: statusCode,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        },
      });
    }

    console.log('[google]', { status: data.status, results: data.results?.length ?? 0 });
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      },
    });
  },
};