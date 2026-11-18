import { extractRecipeFromHtml } from '../src/utils/recipeScraper';
import { searchDishImages, type ImageSearchSource } from '../src/utils/imageSearch';

export interface Env {
  ASSETS?: {
    fetch: (request: Request) => Promise<Response>;
  };
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function isSafePublicHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      host.startsWith('169.254.')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 1. Stateless Recipe Extraction Endpoint: /api/extract?url=...
    if (url.pathname === '/api/extract') {
      const targetUrl = url.searchParams.get('url')?.trim() || '';
      if (!targetUrl || !isSafePublicHttpUrl(targetUrl)) {
        return new Response(
          JSON.stringify({
            error: 'Please provide a valid public http:// or https:// recipe URL.',
          }),
          {
            status: 400,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
          }
        );
      }

      try {
        const upstream = await fetch(targetUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          redirect: 'follow',
        });

        if (!upstream.ok) {
          return new Response(
            JSON.stringify({
              error: `Origin site returned HTTP ${upstream.status}. You can use "Paste Recipe Text / HTML" mode if this site blocks automated fetches.`,
            }),
            {
              status: 502,
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
            }
          );
        }

        const html = await upstream.text();
        const finalUrl = upstream.url || targetUrl;
        const recipe = extractRecipeFromHtml(html, finalUrl);

        return new Response(JSON.stringify({ recipe }), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to reach recipe URL';
        return new Response(
          JSON.stringify({
            error: `Could not fetch URL (${msg}). Try "Paste Recipe Text / HTML" mode for offline or protected pages.`,
          }),
          {
            status: 502,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
          }
        );
      }
    }

    // 2. Stateless Web Dish Image Search: /api/image-search?q=...&source=wikimedia|openverse|all
    if (url.pathname === '/api/image-search') {
      const q = url.searchParams.get('q')?.trim() || '';
      const rawSource = url.searchParams.get('source')?.trim() || 'wikimedia';
      const source: ImageSearchSource =
        rawSource === 'openverse' || rawSource === 'all' ? rawSource : 'wikimedia';

      if (!q) {
        return new Response(
          JSON.stringify({ error: 'Please provide a dish search query (?q=...).' }),
          {
            status: 400,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
          }
        );
      }

      try {
        const images = await searchDishImages(q, source);
        return new Response(JSON.stringify({ images, query: q, source }), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=1800',
          },
        });
      } catch {
        return new Response(
          JSON.stringify({ error: 'Unable to fetch sample dish photos right now.' }),
          {
            status: 502,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
          }
        );
      }
    }

    // 3. Stateless Image Proxy for Offline Base64 Embedding: /api/image-proxy?url=...
    if (url.pathname === '/api/image-proxy') {
      const imgUrl = url.searchParams.get('url')?.trim() || '';
      if (!imgUrl || !isSafePublicHttpUrl(imgUrl)) {
        return new Response('Invalid image URL', { status: 400, headers: CORS_HEADERS });
      }
      try {
        const imgRes = await fetch(imgUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          },
        });
        if (!imgRes.ok) {
          return new Response('Upstream image error', { status: 502, headers: CORS_HEADERS });
        }
        const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
        const buf = await imgRes.arrayBuffer();
        return new Response(buf, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=3600',
          },
        });
      } catch {
        return new Response('Image proxy failed', { status: 502, headers: CORS_HEADERS });
      }
    }

    // 3. Static Asset Fallback
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
