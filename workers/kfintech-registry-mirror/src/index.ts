export interface Env {
  MIRROR_SECRET?: string;
}

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface KfinMirrorItem {
  clientId: string;
  name: string;
}

export interface KfinMirrorResponse {
  source: 'kfintech-mirror';
  fetchedAt: string;
  bundleUrl: string;
  count: number;
  items: KfinMirrorItem[];
}

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
};

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: WorkerExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'kfintech-registry-mirror' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Shared secret authorization check
    if (env.MIRROR_SECRET) {
      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : '';

      if (!token || token !== env.MIRROR_SECRET.trim()) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized', message: 'Invalid or missing Bearer token' }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
    }

    // Check Cloudflare edge cache first (cache for 120s if not forced)
    const cache = typeof caches !== 'undefined' ? (caches as unknown as { default?: CacheStorage }).default : undefined;
    const forceRefresh = url.searchParams.get('refresh') === 'true';
    const cacheKey = new Request(url.origin + '/active-registry', {
      method: 'GET',
    });

    if (!forceRefresh && cache) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        return cached;
      }
    }

    try {
      const discovery = await discoverKfinActiveItems();
      const responsePayload: KfinMirrorResponse = {
        source: 'kfintech-mirror',
        fetchedAt: new Date().toISOString(),
        bundleUrl: discovery.bundleUrl,
        count: discovery.items.length,
        items: discovery.items,
      };

      const response = new Response(JSON.stringify(responsePayload, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=120, s-maxage=120',
          'Access-Control-Allow-Origin': '*',
        },
      });

      // Persist in Cloudflare edge cache asynchronously
      if (cache) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }
      return response;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(
        JSON.stringify({
          error: 'DiscoveryFailed',
          message: msg,
          timestamp: new Date().toISOString(),
        }),
        {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
  },
};

/**
 * Discovers the active KFintech bundle URL and extracts sanitized company items.
 */
async function discoverKfinActiveItems(): Promise<{
  bundleUrl: string;
  items: KfinMirrorItem[];
}> {
  let bundleUrl: string | null = null;

  // Step 1: Probe asset-manifest.json
  try {
    const manifestRes = await fetch(
      'https://ipostatus.kfintech.com/asset-manifest.json',
      {
        headers: {
          ...BROWSER_HEADERS,
          Accept: 'application/json, text/plain, */*',
        },
      },
    );

    if (manifestRes.ok) {
      const contentType = manifestRes.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        const manifest = (await manifestRes.json()) as {
          files?: Record<string, string>;
          entrypoints?: string[];
        };
        const mainJs =
          manifest?.files?.['main.js'] ||
          manifest?.entrypoints?.find((e) => typeof e === 'string' && /\.js(\?|$)/i.test(e));
        if (mainJs) {
          bundleUrl = new URL(mainJs, 'https://ipostatus.kfintech.com/').toString();
        }
      }
    }
  } catch {
    // Fall through to HTML scraping
  }

  // Step 2: Fallback to HTML script scraping if manifest didn't resolve
  if (!bundleUrl) {
    const htmlRes = await fetch('https://ipostatus.kfintech.com/', {
      headers: BROWSER_HEADERS,
    });
    if (!htmlRes.ok) {
      throw new Error(`Portal HTML request failed: HTTP ${htmlRes.status} ${htmlRes.statusText}`);
    }
    const html = await htmlRes.text();
    const scriptMatch = html.match(/src=["']?(\.?\/static\/js\/main\.[^"'\s>]+\.js)/i);
    if (!scriptMatch || !scriptMatch[1]) {
      throw new Error('Unable to locate main JS bundle in KFintech root HTML');
    }
    bundleUrl = new URL(scriptMatch[1], 'https://ipostatus.kfintech.com/').toString();
  }

  // Step 3: Fetch JS bundle
  const bundleRes = await fetch(bundleUrl, {
    headers: BROWSER_HEADERS,
  });

  if (!bundleRes.ok) {
    throw new Error(`KFintech bundle fetch failed: HTTP ${bundleRes.status} ${bundleRes.statusText}`);
  }

  const contentType = bundleRes.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error('KFintech bundle returned HTML error page instead of JavaScript');
  }

  const bundleText = await bundleRes.text();
  if (bundleText.trim().startsWith('<!doctype') || bundleText.trim().startsWith('<html')) {
    throw new Error('KFintech bundle payload is HTML instead of JavaScript');
  }

  // Step 4: Extract and sanitize company items
  const items = extractCompanyItems(bundleText);
  if (!items || items.length === 0) {
    throw new Error('No valid company entries extracted from KFintech JS bundle');
  }

  return { bundleUrl, items };
}

/**
 * Extracts and validates clientId + company name records from bundle JS.
 */
function extractCompanyItems(bundleCode: string): KfinMirrorItem[] {
  let rawArray: unknown[] = [];

  const jsonRegex = /JSON\.parse\((['"`])(\[\s*\{[\s\S]*?\}\s*\])\1\)/;
  const match = jsonRegex.exec(bundleCode);

  if (match && match[2]) {
    try {
      const unescaped = match[2]
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
      const parsed = JSON.parse(unescaped);
      if (Array.isArray(parsed)) {
        rawArray = parsed;
      }
    } catch {
      // Fall through to literal array fallback
    }
  }

  if (rawArray.length === 0) {
    const directArrayRegex =
      /\[\s*\{"clientId"\s*:\s*"[^"]+"\s*,\s*"name"\s*:\s*"[^"]+"\}[\s\S]*?\]/;
    const directMatch = directArrayRegex.exec(bundleCode);
    if (directMatch) {
      try {
        const parsed = JSON.parse(directMatch[0]);
        if (Array.isArray(parsed)) {
          rawArray = parsed;
        }
      } catch {
        // Fall through
      }
    }
  }

  const seen = new Set<string>();
  const sanitized: KfinMirrorItem[] = [];

  for (const entry of rawArray) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const clientId = String(rec.clientId || rec.client_id || '').trim();
    const name = String(rec.name || rec.company_name || '').trim();

    // Must be non-empty, length >= 5, not UUID, name length >= 2
    if (
      clientId &&
      clientId.length >= 5 &&
      name &&
      name.length >= 2 &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)
    ) {
      if (!seen.has(clientId)) {
        seen.add(clientId);
        sanitized.push({ clientId, name });
      }
    }
  }

  return sanitized;
}
