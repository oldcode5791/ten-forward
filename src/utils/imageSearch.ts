import { cleanText } from './recipeScraper.ts';
import type { CandidateImage } from './recipeTypes.ts';

export type ImageSearchSource = 'wikimedia' | 'openverse' | 'all';

const SEARCH_USER_AGENT = 'TenForwardGalleyCard/1.10 (https://ten-forward.the-lal.net)';

function normalizeUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return undefined;
}

function extractFirstHref(html: string): string | undefined {
  const m = /href=["']([^"']+)["']/i.exec(html);
  return m?.[1] ? normalizeUrl(m[1]) : undefined;
}

function isAcceptableDimensions(width: number, height: number): boolean {
  if (width > 0 && width < 320) return false;
  if (height > 0 && height < 200) return false;
  if (width > 0 && height > 0) {
    const ratio = width / height;
    if (ratio > 3.0 || ratio < 0.35) return false;
  }
  return true;
}

/**
 * Searches Wikimedia Commons for permissive-license dish photos with full artist & license metadata.
 */
async function searchWikimediaCommons(query: string, limit = 6): Promise<CandidateImage[]> {
  const apiUrl =
    `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6` +
    `&gsrsearch=${encodeURIComponent(`${query} filetype:bitmap`)}` +
    `&gsrlimit=${limit * 2}&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1000&format=json&origin=*`;

  const res = await fetch(apiUrl, {
    headers: {
      'User-Agent': SEARCH_USER_AGENT,
      Accept: 'application/json',
    },
  });
  if (!res.ok) return [];

  const data = (await res.json()) as {
    query?: {
      pages?: Record<
        string,
        {
          title?: string;
          imageinfo?: Array<{
            url?: string;
            thumburl?: string;
            descriptionurl?: string;
            width?: number;
            height?: number;
            mime?: string;
            extmetadata?: {
              Artist?: { value?: string };
              LicenseShortName?: { value?: string };
              ImageDescription?: { value?: string };
              ObjectName?: { value?: string };
            };
          }>;
        }
      >;
    };
  };

  const pages = Object.values(data.query?.pages || {});
  const results: CandidateImage[] = [];

  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info) continue;

    const mime = (info.mime || '').toLowerCase();
    if (!/^image\/(jpeg|jpg|png|webp)$/.test(mime)) continue;

    const width = Number(info.width || 0);
    const height = Number(info.height || 0);
    if (!isAcceptableDimensions(width, height)) continue;

    const imageUrl = normalizeUrl(info.thumburl || info.url || '');
    if (!imageUrl) continue;

    const meta = info.extmetadata || {};
    const rawLicense = cleanText(meta.LicenseShortName?.value || '');
    if (/all rights reserved|fair use|copyrighted/i.test(rawLicense)) continue;

    const rawArtistHtml = meta.Artist?.value || '';
    const authorName = cleanText(rawArtistHtml) || 'Wikimedia Commons Contributor';
    const authorUrl = extractFirstHref(rawArtistHtml);
    const sourcePageUrl =
      normalizeUrl(info.descriptionurl || '') ||
      `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title || '')}`;
    const caption =
      cleanText(meta.ObjectName?.value || meta.ImageDescription?.value || page.title || '')
        .replace(/^File:/i, '')
        .replace(/\.[a-z0-9]+$/i, '')
        .slice(0, 120) || query;

    results.push({
      url: imageUrl,
      caption,
      source: 'web-search',
      score: 90 - results.length,
      attribution: {
        authorName,
        authorUrl,
        sourcePageUrl,
        license: rawLicense || 'Wikimedia Commons',
        provider: 'Wikimedia Commons',
      },
    });

    if (results.length >= limit) break;
  }

  return results;
}

/**
 * Searches Openverse for CC-licensed dish photography with creator & license metadata.
 */
async function searchOpenverse(query: string, limit = 6): Promise<CandidateImage[]> {
  const apiUrl =
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}` +
    `&page_size=${limit * 2}&license_type=commercial,modification`;

  const res = await fetch(apiUrl, {
    headers: {
      'User-Agent': SEARCH_USER_AGENT,
      Accept: 'application/json',
    },
  });
  if (!res.ok) return [];

  const data = (await res.json()) as {
    results?: Array<{
      url?: string;
      thumbnail?: string;
      title?: string;
      creator?: string;
      creator_url?: string;
      foreign_landing_url?: string;
      license?: string;
      license_version?: string;
      width?: number;
      height?: number;
    }>;
  };

  const results: CandidateImage[] = [];
  for (const item of data.results || []) {
    const rawUrl = item.url || item.thumbnail || '';
    if (!rawUrl || /\.(?:svg|gif)(?:\?|$)/i.test(rawUrl)) continue;

    const imageUrl = normalizeUrl(rawUrl);
    if (!imageUrl) continue;

    const width = Number(item.width || 0);
    const height = Number(item.height || 0);
    if (!isAcceptableDimensions(width, height)) continue;

    const licenseLabel = item.license
      ? `${item.license.toUpperCase()} ${item.license_version || ''}`.trim()
      : 'Creative Commons';

    results.push({
      url: imageUrl,
      caption: cleanText(item.title || '') || query,
      source: 'web-search',
      score: 85 - results.length,
      attribution: {
        authorName: cleanText(item.creator || '') || 'Openverse Contributor',
        authorUrl: normalizeUrl(item.creator_url || ''),
        sourcePageUrl: normalizeUrl(item.foreign_landing_url || '') || imageUrl,
        license: licenseLabel,
        provider: 'Openverse',
      },
    });

    if (results.length >= limit) break;
  }

  return results;
}

/**
 * Searches the selected public image source(s) for sample dish photos with attribution.
 */
export async function searchDishImages(
  query: string,
  source: ImageSearchSource = 'wikimedia'
): Promise<CandidateImage[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  if (source === 'wikimedia') {
    return searchWikimediaCommons(cleanQuery, 6);
  }
  if (source === 'openverse') {
    return searchOpenverse(cleanQuery, 6);
  }

  const [wikiRes, openverseRes] = await Promise.allSettled([
    searchWikimediaCommons(cleanQuery, 4),
    searchOpenverse(cleanQuery, 4),
  ]);

  const combined: CandidateImage[] = [];
  const seen = new Set<string>();
  for (const settled of [wikiRes, openverseRes]) {
    if (settled.status !== 'fulfilled') continue;
    for (const img of settled.value) {
      if (seen.has(img.url)) continue;
      seen.add(img.url);
      combined.push(img);
    }
  }

  return combined.slice(0, 8);
}
