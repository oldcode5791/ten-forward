# Ten Forward (`ten-forward.the-lal.net`)

**Recipe Extractor & Printable Galley Card** — part of the `the-lal.net` utility fleet.

## Highlights
- **Creator-First Attribution:** Automatically extracts and preserves the original Chef/Author, Publication/Site Name, Publish Date, Canonical Source URL, and generates a scannable **SVG QR Code** on printed copies and standalone offline HTML cards.
- **Intelligent Dish Photo Scraper (Anti-Garbage Filter):** Extracts `schema.org/Recipe` hero & step photos first, deduplicates CDN resolution variants, and automatically filters out ad banners, author avatars, social icons, SVGs, GIFs, and tracking pixels.
- **Interactive Galley Tools:**
  - Portion scaler (`0.5x`, `1x`, `2x`, `3x`, or custom serving counts) with culinary fraction math (`1/2`, `1/3`, `3/4`).
  - Unit system converter (`Original`, `Metric g/ml/°C`, `Imperial oz/cups/°F`).
  - Cook Mode with checkable ingredients, clickable step highlights, and Screen Wake Lock (`navigator.wakeLock`).
  - Print / Save as PDF (`@media print` ink-friendly stylesheet), Standalone Offline `.html`, Obsidian/Notion `.md`, and Local Browser Galley Box (`localStorage`).

## Development & Deployment
```bash
npm run dev      # Start Vite dev server with local /api/extract middleware
npm run build    # Type-check and build production assets to ./dist
npm run deploy   # Build and deploy Worker + static assets via Wrangler
```
