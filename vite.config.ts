import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { extractRecipeFromHtml } from './src/utils/recipeScraper.ts';
import { searchDishImages, type ImageSearchSource } from './src/utils/imageSearch.ts';

/**
 * Local Vite dev-server middleware so /api/extract and /api/image-proxy work
 * seamlessly during `npm run dev` as well as in production Cloudflare Workers.
 */
function tenForwardApiDevPlugin(): Plugin {
  return {
    name: 'ten-forward-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();
        const parsed = new URL(req.url, 'http://localhost');

        if (parsed.pathname === '/api/extract') {
          const targetUrl = parsed.searchParams.get('url')?.trim() || '';
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Please enter a valid http:// or https:// recipe URL.' }));
            return;
          }
          try {
            const upstream = await fetch(targetUrl, {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              },
              redirect: 'follow',
            });
            if (!upstream.ok) {
              res.statusCode = 502;
              res.end(
                JSON.stringify({
                  error: `Origin returned HTTP ${upstream.status}. Try "Paste Recipe Text / HTML" mode if the site blocks automated requests.`,
                })
              );
              return;
            }
            const html = await upstream.text();
            const recipe = extractRecipeFromHtml(html, upstream.url || targetUrl);
            res.statusCode = 200;
            res.end(JSON.stringify({ recipe }));
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Network error';
            res.statusCode = 502;
            res.end(
              JSON.stringify({
                error: `Unable to fetch URL (${msg}). Use "Paste Recipe Text / HTML" mode when offline.`,
              })
            );
          }
          return;
        }

        if (parsed.pathname === '/api/image-search') {
          const q = parsed.searchParams.get('q')?.trim() || '';
          const rawSource = parsed.searchParams.get('source')?.trim() || 'wikimedia';
          const source: ImageSearchSource =
            rawSource === 'openverse' || rawSource === 'all' ? rawSource : 'wikimedia';
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          if (!q) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Please provide a dish search query (?q=...).' }));
            return;
          }
          try {
            const images = await searchDishImages(q, source);
            res.statusCode = 200;
            res.end(JSON.stringify({ images, query: q, source }));
          } catch {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: 'Unable to fetch sample dish photos right now.' }));
          }
          return;
        }

        if (parsed.pathname === '/api/image-proxy') {
          const imgUrl = parsed.searchParams.get('url')?.trim() || '';
          if (!imgUrl || !/^https?:\/\//i.test(imgUrl)) {
            res.statusCode = 400;
            res.end('Invalid image URL');
            return;
          }
          try {
            const imgRes = await fetch(imgUrl);
            const buf = Buffer.from(await imgRes.arrayBuffer());
            res.setHeader('Content-Type', imgRes.headers.get('content-type') || 'image/jpeg');
            res.statusCode = 200;
            res.end(buf);
          } catch {
            res.statusCode = 502;
            res.end('Image fetch error');
          }
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), tenForwardApiDevPlugin()],
});
