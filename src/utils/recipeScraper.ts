import type {
  AttributionRecord,
  CandidateImage,
  NutritionInfo,
  RecipeData,
  RecipeStep,
} from './recipeTypes.ts';

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  '_ga',
]);

const GARBAGE_IMAGE_PATTERNS = [
  /avatar/i,
  /gravatar/i,
  /author/i,
  /profile/i,
  /logo/i,
  /favicon/i,
  /icon/i,
  /badge/i,
  /award/i,
  /seal/i,
  /ad[-_s/]/i,
  /banner/i,
  /sponsor/i,
  /affiliate/i,
  /amazon/i,
  /pinterest/i,
  /facebook/i,
  /instagram/i,
  /twitter/i,
  /social/i,
  /share/i,
  /print[-_]?button/i,
  /pixel/i,
  /tracker/i,
  /1x1/i,
  /spacer/i,
  /blank/i,
  /placeholder/i,
  /emoji/i,
  /wp-smiley/i,
  /rating/i,
  /stars/i,
  /\.svg(\?|$)/i,
  /\.gif(\?|$)/i,
  /^data:image\/svg/i,
  /^data:image\/gif/i,
];

/**
 * Normalizes a URL by stripping marketing/tracking query parameters and jump hashes.
 */
export function cleanCanonicalUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
}

/**
 * Extracts a clean domain host (without www.) from a URL.
 */
export function extractDomain(rawUrl: string): string {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host.replace(/^www\./, '');
  } catch {
    return 'manual-entry.local';
  }
}

/**
 * Converts a domain like "seriouseats.com" into a readable fallback site name ("Serious Eats").
 */
function domainToSiteName(domain: string): string {
  if (!domain || domain === 'manual-entry.local') return 'Personal Galley Entry';
  const base = domain.split('.')[0] || domain;
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Decodes common HTML entities and strips inline HTML tags from scraped strings.
 */
export function cleanText(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;|&#8217;|&#8216;/gi, "'")
    .replace(/&#8220;|&#8221;/gi, '"')
    .replace(/&#8211;|&ndash;/gi, '–')
    .replace(/&#8212;|&mdash;/gi, '—')
    .replace(/&frac12;|&#189;/gi, '1/2')
    .replace(/&frac14;|&#188;/gi, '1/4')
    .replace(/&frac34;|&#190;/gi, '3/4')
    .replace(/&frac13;|&#8531;/gi, '1/3')
    .replace(/&frac23;|&#8532;/gi, '2/3')
    .replace(/&deg;|&#176;/gi, '°')
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Converts ISO 8601 duration strings (e.g. "PT1H30M", "P0DT0H25M0S") into human-friendly text.
 */
export function formatIsoDuration(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const text = raw.trim();
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(text);
  if (!match) return cleanText(text);
  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0) + days * 24;
  const mins = Number(match[3] || 0);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hr' : 'hrs'}`);
  if (mins > 0) parts.push(`${mins} ${mins === 1 ? 'min' : 'mins'}`);
  return parts.join(' ') || '';
}

/**
 * Extracts a numeric serving count and readable yield text from schema.org recipeYield.
 */
export function parseYield(raw: unknown): { baseServings: number; yieldText: string } {
  const values = Array.isArray(raw) ? raw.map((v) => cleanText(String(v))) : [cleanText(String(raw ?? ''))];
  const nonEmpty = values.filter(Boolean);
  if (nonEmpty.length === 0) {
    return { baseServings: 4, yieldText: '4 servings' };
  }
  const primary = nonEmpty[0];
  const numMatch = /(\d+(?:\.\d+)?)/.exec(primary);
  const count = numMatch ? Math.max(1, Math.round(Number(numMatch[1]))) : 4;
  const yieldText = /^\d+$/.test(primary) ? `${primary} servings` : primary;
  return { baseServings: count, yieldText };
}

/**
 * Resolves a possibly relative image URL against the source page URL and rejects garbage patterns.
 */
export function resolveAndValidateImageUrl(
  rawUrl: unknown,
  baseUrl: string,
  contextHint = ''
): string | null {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('data:image/')) {
    for (const pattern of GARBAGE_IMAGE_PATTERNS) {
      if (pattern.test(trimmed)) return null;
    }
    return trimmed;
  }
  let resolved = trimmed;
  try {
    resolved = new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
  if (!/^https?:\/\//i.test(resolved)) return null;

  const combined = `${resolved} ${contextHint}`;
  for (const pattern of GARBAGE_IMAGE_PATTERNS) {
    if (pattern.test(combined)) return null;
  }

  // Reject tiny dimension hints embedded in filename (e.g. -100x100.jpg or -150x150.png)
  const dimSuffix = /-(\d+)x(\d+)\.(?:jpe?g|png|webp|avif)/i.exec(resolved);
  if (dimSuffix) {
    const w = Number(dimSuffix[1]);
    const h = Number(dimSuffix[2]);
    if (w < 220 || h < 160) return null;
  }

  return resolved;
}

/**
 * Deduplicates WordPress / CDN crop variants (e.g. dish-720x720.jpg vs dish-1200x800.jpg),
 * keeping the highest-scoring / highest-resolution URL per base image stem.
 */
export function deduplicateCandidateImages(candidates: CandidateImage[]): CandidateImage[] {
  const byStem = new Map<string, CandidateImage>();

  for (const item of candidates) {
    const stem = item.url
      .replace(/-\d+x\d+(?=\.(?:jpe?g|png|webp|avif))/i, '')
      .replace(/[?#].*$/, '');

    const existing = byStem.get(stem);
    if (!existing) {
      byStem.set(stem, item);
      continue;
    }

    // Prefer uncropped original or larger resolution suffix for identical stems
    const getArea = (u: string): number => {
      const m = /-(\d+)x(\d+)(?=\.(?:jpe?g|png|webp|avif))/i.exec(u);
      return m ? Number(m[1]) * Number(m[2]) : 2_000_000;
    };
    if (getArea(item.url) > getArea(existing.url)) {
      byStem.set(stem, { ...item, score: Math.max(item.score, existing.score) });
    } else if (item.score > existing.score) {
      byStem.set(stem, { ...existing, score: item.score });
    }
  }

  return [...byStem.values()].sort((a, b) => b.score - a.score).slice(0, 8);
}

/**
 * Extracts image URLs from schema.org image property (string, ImageObject, or array).
 */
function extractSchemaImages(
  imageProp: unknown,
  baseUrl: string,
  source: CandidateImage['source'],
  baseScore: number
): CandidateImage[] {
  const results: CandidateImage[] = [];
  const visit = (val: unknown, idx: number) => {
    if (!val) return;
    if (typeof val === 'string') {
      const valid = resolveAndValidateImageUrl(val, baseUrl);
      if (valid) results.push({ url: valid, source, score: baseScore - idx });
    } else if (Array.isArray(val)) {
      val.forEach((entry, i) => visit(entry, i));
    } else if (typeof val === 'object') {
      const obj = val as Record<string, unknown>;
      const rawUrl = obj.url || obj.contentUrl || obj['@id'];
      const caption = cleanText(obj.caption || obj.name || '');
      const width = Number(obj.width || 0);
      const height = Number(obj.height || 0);
      if ((width > 0 && width < 220) || (height > 0 && height < 160)) return;
      const valid = resolveAndValidateImageUrl(rawUrl, baseUrl, caption);
      if (valid) {
        results.push({ url: valid, caption: caption || undefined, source, score: baseScore - idx });
      }
    }
  };
  visit(imageProp, 0);
  return results;
}

/**
 * Recursively searches parsed JSON-LD structures for a schema.org/Recipe object.
 */
function findRecipeNodeInJsonLd(node: unknown): Record<string, unknown> | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipeNodeInJsonLd(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const rawType = obj['@type'];
    const types = Array.isArray(rawType) ? rawType : [rawType];
    const isRecipe = types.some(
      (t) => typeof t === 'string' && (/^recipe$/i.test(t.trim()) || /schema\.org\/Recipe$/i.test(t.trim()))
    );
    if (isRecipe) return obj;

    if (obj['@graph']) {
      const fromGraph = findRecipeNodeInJsonLd(obj['@graph']);
      if (fromGraph) return fromGraph;
    }
    if (obj.mainEntity) {
      const fromMain = findRecipeNodeInJsonLd(obj.mainEntity);
      if (fromMain) return fromMain;
    }
  }
  return null;
}

/**
 * Extracts author name or publisher name from a JSON-LD node or root @graph.
 */
function extractPersonOrOrgName(prop: unknown): { name: string; url?: string } {
  if (!prop) return { name: '' };
  if (typeof prop === 'string') return { name: cleanText(prop) };
  if (Array.isArray(prop)) {
    for (const item of prop) {
      const res = extractPersonOrOrgName(item);
      if (res.name) return res;
    }
    return { name: '' };
  }
  if (typeof prop === 'object') {
    const obj = prop as Record<string, unknown>;
    const name = cleanText(obj.name || obj.alternateName || '');
    const url = typeof obj.url === 'string' ? obj.url : undefined;
    return { name, url };
  }
  return { name: '' };
}

/**
 * Parses schema.org recipeInstructions into clean RecipeStep items (with per-step images if present).
 */
function parseSchemaInstructions(
  rawInstructions: unknown,
  baseUrl: string
): { steps: RecipeStep[]; stepImages: CandidateImage[] } {
  const steps: RecipeStep[] = [];
  const stepImages: CandidateImage[] = [];
  let counter = 1;

  const addStep = (text: string, section?: string, rawImg?: unknown) => {
    const cleaned = cleanText(text).replace(/^(?:step\s*\d+[:.)\s-]*|\d+[.)]\s+)/i, '').trim();
    if (!cleaned || cleaned.length < 2) return;
    const stepImgCandidates = extractSchemaImages(rawImg, baseUrl, 'json-ld-step', 80 - counter);
    const stepImageUrl = stepImgCandidates[0]?.url;
    if (stepImgCandidates.length > 0) {
      stepImages.push(...stepImgCandidates);
    }
    steps.push({
      id: `step-${counter++}`,
      section,
      text: cleaned,
      imageUrl: stepImageUrl,
    });
  };

  const visit = (node: unknown, currentSection?: string) => {
    if (!node) return;
    if (typeof node === 'string') {
      const lines = node
        .split(/\r?\n|(?<=\.)\s+(?=[A-Z0-9])/)
        .map((l) => l.trim())
        .filter((l) => l.length > 3);
      if (lines.length > 1 && node.includes('\n')) {
        lines.forEach((l) => addStep(l, currentSection));
      } else {
        addStep(node, currentSection);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child) => visit(child, currentSection));
      return;
    }
    if (typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const type = String(obj['@type'] || '');
      if (/HowToSection/i.test(type) || obj.itemListElement) {
        const secName = cleanText(obj.name || currentSection || '');
        visit(obj.itemListElement || obj.steps, secName || currentSection);
        return;
      }
      const stepText = String(obj.text || obj.description || obj.name || '');
      addStep(stepText, currentSection, obj.image || obj.video);
    }
  };

  visit(rawInstructions);
  return { steps, stepImages };
}

/**
 * Extracts <meta> tag content from raw HTML by property or name attribute.
 */
function extractMetaContent(html: string, attrName: string): string {
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex1 = new RegExp(
    `<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
    'i'
  );
  const m1 = regex1.exec(html);
  if (m1?.[1]) return cleanText(m1[1]);

  const regex2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${escaped}["']`,
    'i'
  );
  const m2 = regex2.exec(html);
  return m2?.[1] ? cleanText(m2[1]) : '';
}

/**
 * Scans HTML for high-confidence dish photos while rejecting ads, avatars, logos, and icons.
 */
function extractFilteredDomImages(html: string, baseUrl: string): CandidateImage[] {
  const results: CandidateImage[] = [];

  // 1. OpenGraph / Twitter image meta tags
  const ogImg = extractMetaContent(html, 'og:image') || extractMetaContent(html, 'og:image:secure_url');
  const twitterImg = extractMetaContent(html, 'twitter:image');
  for (const metaUrl of [ogImg, twitterImg]) {
    const valid = resolveAndValidateImageUrl(metaUrl, baseUrl, 'opengraph');
    if (valid) {
      results.push({ url: valid, source: 'opengraph', score: 88 });
    }
  }

  // 2. Scan <img> tags with lazy-loading attribute support and strict dimension/garbage filtering
  const imgTagRegex = /<img\b([^>]+)>/gi;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = imgTagRegex.exec(html)) !== null && idx < 45) {
    const attrs = match[1];
    idx++;

    const getAttr = (name: string): string => {
      const r = new RegExp(`\\b${name}=["']([^"']+)["']`, 'i').exec(attrs);
      return r?.[1] ? r[1].trim() : '';
    };

    const width = Number(getAttr('width') || 0);
    const height = Number(getAttr('height') || 0);
    if ((width > 0 && width < 250) || (height > 0 && height < 180)) continue;
    if (width > 0 && height > 0) {
      const ratio = width / height;
      if (ratio > 3.2 || ratio < 0.3) continue;
    }

    // Prefer high-res srcset or lazy-src over placeholder src
    const srcset = getAttr('data-lazy-srcset') || getAttr('data-srcset') || getAttr('srcset');
    let bestSrc = '';
    if (srcset) {
      const candidates = srcset
        .split(',')
        .map((part) => {
          const [u, wSpec] = part.trim().split(/\s+/);
          const w = wSpec?.endsWith('w') ? Number(wSpec.slice(0, -1)) : 0;
          return { u, w: Number.isFinite(w) ? w : 0 };
        })
        .filter((c) => Boolean(c.u))
        .sort((a, b) => b.w - a.w);
      if (candidates[0]) bestSrc = candidates[0].u;
    }

    if (!bestSrc) {
      bestSrc =
        getAttr('data-pin-media') ||
        getAttr('data-lazy-src') ||
        getAttr('data-src') ||
        getAttr('src');
    }

    const alt = cleanText(getAttr('alt'));
    const className = getAttr('class');
    const valid = resolveAndValidateImageUrl(bestSrc, baseUrl, `${alt} ${className}`);
    if (!valid) continue;

    let score = 60 - idx * 0.5;
    if (/recipe|wprm|tasty|mv-create|featured|hero|dish|food/i.test(className)) {
      score += 18;
    }
    if (alt.length > 6) {
      score += 5;
    }

    results.push({
      url: valid,
      caption: alt || undefined,
      source: 'dom-verified',
      score,
    });
  }

  return results;
}

/**
 * Extracts a RecipeData object from raw HTML and its source URL.
 */
export function extractRecipeFromHtml(html: string, sourceUrl: string): RecipeData {
  const canonicalFromMeta =
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(html)?.[1] || sourceUrl;
  const cleanUrl = cleanCanonicalUrl(canonicalFromMeta || sourceUrl);
  const domain = extractDomain(cleanUrl);
  const ogSiteName = extractMetaContent(html, 'og:site_name');
  const metaAuthor =
    extractMetaContent(html, 'author') ||
    extractMetaContent(html, 'article:author') ||
    extractMetaContent(html, 'twitter:creator');
  const metaPublished =
    extractMetaContent(html, 'article:published_time') ||
    extractMetaContent(html, 'datePublished') ||
    extractMetaContent(html, 'pubdate');

  // 1. Parse all <script type="application/ld+json"> blocks
  const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch: RegExpExecArray | null;
  let recipeJsonNode: Record<string, unknown> | null = null;
  let publisherFromGraph = '';
  let authorFromGraph = '';

  while ((scriptMatch = scriptRegex.exec(html)) !== null) {
    const rawJson = scriptMatch[1].trim();
    if (!rawJson) continue;
    try {
      const parsed = JSON.parse(rawJson);
      // Also look for WebSite / Organization / Person nodes in @graph for richer attribution
      const scanSupportNodes = (node: unknown) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          node.forEach(scanSupportNodes);
          return;
        }
        const obj = node as Record<string, unknown>;
        const t = String(obj['@type'] || '');
        if (/Organization|WebSite/i.test(t) && !publisherFromGraph && obj.name) {
          publisherFromGraph = cleanText(obj.name);
        }
        if (/Person/i.test(t) && !authorFromGraph && obj.name) {
          authorFromGraph = cleanText(obj.name);
        }
        if (obj['@graph']) scanSupportNodes(obj['@graph']);
      };
      scanSupportNodes(parsed);

      const found = findRecipeNodeInJsonLd(parsed);
      if (found) {
        recipeJsonNode = found;
        break;
      }
    } catch {
      // Ignore malformed JSON-LD blocks
    }
  }

  const domImages = extractFilteredDomImages(html, cleanUrl);

  // 2. If we found a schema.org/Recipe JSON-LD object, build the full structured RecipeData
  if (recipeJsonNode) {
    const title =
      cleanText(recipeJsonNode.name) ||
      extractMetaContent(html, 'og:title') ||
      'Untitled Galley Recipe';
    const description =
      cleanText(recipeJsonNode.description) ||
      extractMetaContent(html, 'og:description') ||
      extractMetaContent(html, 'description');

    const prepTime = formatIsoDuration(recipeJsonNode.prepTime);
    const cookTime = formatIsoDuration(recipeJsonNode.cookTime);
    const totalTime = formatIsoDuration(recipeJsonNode.totalTime);
    const { baseServings, yieldText } = parseYield(recipeJsonNode.recipeYield || recipeJsonNode.yield);

    const rawCategory = recipeJsonNode.recipeCategory;
    const category = Array.isArray(rawCategory)
      ? rawCategory.map(cleanText).filter(Boolean).join(', ')
      : cleanText(rawCategory) || 'Main Course';

    const rawCuisine = recipeJsonNode.recipeCuisine;
    const cuisine = Array.isArray(rawCuisine)
      ? rawCuisine.map(cleanText).filter(Boolean).join(', ')
      : cleanText(rawCuisine) || '';

    const rawIngredients = Array.isArray(recipeJsonNode.recipeIngredient)
      ? recipeJsonNode.recipeIngredient
      : Array.isArray(recipeJsonNode.ingredients)
        ? recipeJsonNode.ingredients
        : [];
    const ingredients = rawIngredients.map((item) => cleanText(item)).filter(Boolean);

    const { steps, stepImages } = parseSchemaInstructions(recipeJsonNode.recipeInstructions, cleanUrl);
    const schemaHeroImages = extractSchemaImages(recipeJsonNode.image, cleanUrl, 'json-ld-hero', 100);
    const candidateImages = deduplicateCandidateImages([
      ...schemaHeroImages,
      ...stepImages,
      ...domImages,
    ]);

    const authorInfo = extractPersonOrOrgName(recipeJsonNode.author);
    const publisherInfo = extractPersonOrOrgName(recipeJsonNode.publisher);
    const authorName =
      authorInfo.name || authorFromGraph || metaAuthor || publisherInfo.name || ogSiteName || domainToSiteName(domain);
    const siteName = publisherInfo.name || ogSiteName || publisherFromGraph || domainToSiteName(domain);
    const rawDate = String(recipeJsonNode.datePublished || metaPublished || '');
    const publishedDate = rawDate ? rawDate.slice(0, 10) : undefined;

    let nutrition: NutritionInfo | undefined;
    if (recipeJsonNode.nutrition && typeof recipeJsonNode.nutrition === 'object') {
      const n = recipeJsonNode.nutrition as Record<string, unknown>;
      nutrition = {
        calories: cleanText(n.calories),
        proteinContent: cleanText(n.proteinContent),
        carbohydrateContent: cleanText(n.carbohydrateContent),
        fatContent: cleanText(n.fatContent),
      };
    }

    const attribution: AttributionRecord = {
      sourceUrl: cleanUrl,
      domain,
      siteName,
      authorName,
      authorUrl: authorInfo.url,
      publishedDate,
      extractedAt: new Date().toISOString().slice(0, 10),
      creditNote: `Original recipe by ${authorName} on ${siteName}. Preserved for personal kitchen use.`,
    };

    return {
      id: `recipe-${Date.now()}`,
      title,
      description,
      prepTime,
      cookTime,
      totalTime,
      baseServings,
      yieldText,
      category,
      cuisine,
      ingredients,
      steps:
        steps.length > 0
          ? steps
          : [{ id: 'step-1', text: 'Refer to original source link for detailed preparation notes.' }],
      notes: [],
      heroImage: candidateImages[0]?.url || '',
      candidateImages,
      nutrition,
      attribution,
      extractionMethod: 'json-ld',
    };
  }

  // 3. Fallback: Heuristic DOM & text extraction when JSON-LD is missing
  const pageTitle =
    extractMetaContent(html, 'og:title') ||
    cleanText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '') ||
    'Extracted Recipe';
  const pageDesc =
    extractMetaContent(html, 'og:description') || extractMetaContent(html, 'description');

  // Extract list items from HTML as candidate ingredients/steps
  const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  const listItems: string[] = [];
  let liMatch: RegExpExecArray | null;
  while ((liMatch = liRegex.exec(html)) !== null) {
    const text = cleanText(liMatch[1]);
    if (text.length >= 4 && text.length <= 260) {
      listItems.push(text);
    }
  }

  const unitRegex =
    /\b(\d+\/\d+|\d+|\bcup|\bc\b|tbsp|tablespoon|tsp|teaspoon|oz|ounce|lb|pound|gram|\bg\b|\bkg\b|\bml\b|pinch|clove|slice|can|bunch)\b/i;
  const ingredients = listItems.filter((item) => unitRegex.test(item) && item.length < 120).slice(0, 30);
  const stepLines = listItems
    .filter((item) => item.length >= 35 && !ingredients.includes(item))
    .slice(0, 20);

  const candidateImages = deduplicateCandidateImages(domImages);
  const siteName = ogSiteName || domainToSiteName(domain);
  const authorName = metaAuthor || siteName;

  return {
    id: `recipe-${Date.now()}`,
    title: pageTitle.replace(/\s*[-|•].*$/, '').trim() || pageTitle,
    description: pageDesc,
    prepTime: '',
    cookTime: '',
    totalTime: '',
    baseServings: 4,
    yieldText: '4 servings',
    category: 'Recipe',
    cuisine: '',
    ingredients:
      ingredients.length > 0
        ? ingredients
        : ['1 cup primary ingredient (edit or paste full ingredient list below)'],
    steps:
      stepLines.length > 0
        ? stepLines.map((text, idx) => ({ id: `step-${idx + 1}`, text }))
        : [{ id: 'step-1', text: 'Combine ingredients and prepare according to source instructions.' }],
    notes: [],
    heroImage: candidateImages[0]?.url || '',
    candidateImages,
    attribution: {
      sourceUrl: cleanUrl,
      domain,
      siteName,
      authorName,
      publishedDate: metaPublished ? metaPublished.slice(0, 10) : undefined,
      extractedAt: new Date().toISOString().slice(0, 10),
      creditNote: `Original recipe by ${authorName} on ${siteName}. Preserved for personal kitchen use.`,
    },
    extractionMethod: 'dom-heuristic',
  };
}

const QUERY_FILLER_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'with',
  'for',
  'best',
  'ever',
  'easy',
  'quick',
  'simple',
  'amazing',
  'ultimate',
  'homemade',
  'classic',
  'perfect',
  'delicious',
  'favorite',
  'favourite',
  'authentic',
  'traditional',
  'recipe',
  'recipes',
  'custom',
  'galley',
  'style',
]);

/**
 * Builds a clean, focused dish-photo search query from a recipe title.
 */
export function buildImageSearchQuery(title: string): string {
  const cleaned = title
    .replace(/\b\d+\s*[- ]?(?:min|minute|minutes|hr|hour|hours)\b/gi, ' ')
    .replace(/['’]s\b/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const keywords = cleaned
    .split(' ')
    .filter((w) => w.length > 1 && !QUERY_FILLER_WORDS.has(w.toLowerCase()));

  if (keywords.length >= 2) {
    return keywords.slice(0, 5).join(' ');
  }
  return cleaned || title.trim() || 'homemade dish';
}

const NOISE_LINE_PATTERNS = [
  /^(?:jump to recipe|print recipe|pin recipe|save recipe|share recipe|rate this recipe|leave a review)$/i,
  /^(?:print|pin|save|share|scale|cook mode|us customary|metric|imperial)$/i,
  /^(?:1x|2x|3x|0\.5x)$/i,
  /^\d+(?:\.\d+)?\s*(?:stars?|out of 5)\b/i,
  /^\d+(?:\.\d+)?\s+from\s+\d+\s+(?:reviews?|votes?|ratings?)$/i,
  /^ingredients?\s*\(\d+\s*servings?\)$/i,
];

/**
 * Parses raw pasted recipe text or HTML (100% client-side zero-server mode).
 */
export function parseRawRecipeText(
  rawText: string,
  customAttribution?: Partial<AttributionRecord>
): RecipeData {
  const trimmed = rawText.trim();
  if (/<html|<script|<article|<div/i.test(trimmed)) {
    return extractRecipeFromHtml(trimmed, customAttribution?.sourceUrl || 'https://manual-entry.local/pasted');
  }

  const rawLines = trimmed
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•▢☐☑✓]|\[\s?[xX]?\s?\])\s*/, '').trim())
    .filter((l) => l.length > 0 && !NOISE_LINE_PATTERNS.some((p) => p.test(l)));

  let title = '';
  let prepTime = '';
  let cookTime = '';
  let totalTime = '';
  let baseServings = 4;
  let yieldText = '4 servings';
  let parsedAuthor = '';
  let category = 'Custom Entry';
  let cuisine = '';
  let calories = '';

  const ingredients: string[] = [];
  const steps: RecipeStep[] = [];
  const notes: string[] = [];

  let mode: 'auto' | 'ingredients' | 'steps' | 'notes' = 'auto';
  let currentStepSection: string | undefined;
  let pendingStepPrefix = false;

  const unitHint =
    /^(\d+|\d+\/\d+|[¼½¾⅓⅔⅛])|\b(cup|tbsp|tablespoon|tsp|teaspoon|oz|lb|gram|g|kg|ml|pinch|clove|dash|slice|can|bunch)\b/i;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    // Check metadata key:value lines
    const metaMatch = /^([a-zA-Z\s]{2,22}):\s*(.+)$/.exec(line);
    if (metaMatch && mode === 'auto') {
      const key = metaMatch[1].trim().toLowerCase();
      const val = metaMatch[2].trim();
      if (key === 'prep time' || key === 'prep') {
        prepTime = val;
        continue;
      }
      if (key === 'cook time' || key === 'cook') {
        cookTime = val;
        continue;
      }
      if (key === 'total time' || key === 'total') {
        totalTime = val;
        continue;
      }
      if (key === 'servings' || key === 'yield' || key === 'makes') {
        const parsedYield = parseYield(val);
        baseServings = parsedYield.baseServings;
        yieldText = parsedYield.yieldText;
        continue;
      }
      if (key === 'author' || key === 'recipe by' || key === 'by') {
        parsedAuthor = val;
        continue;
      }
      if (key === 'category' || key === 'course') {
        category = val;
        continue;
      }
      if (key === 'cuisine') {
        cuisine = val;
        continue;
      }
      if (key === 'calories') {
        calories = val;
        continue;
      }
    }

    if (/^by\s+[A-Z]/i.test(line) && !title && line.length < 60) {
      parsedAuthor = line.replace(/^by\s+/i, '').trim();
      continue;
    }

    if (/^ingredients?(?:\s*\(.*\))?[:\s]*$/i.test(line)) {
      mode = 'ingredients';
      continue;
    }
    if (/^(instructions?|directions?|method|steps?|preparation)[:\s]*$/i.test(line)) {
      mode = 'steps';
      currentStepSection = undefined;
      continue;
    }
    if (/^(notes?|chef'?s?\s*notes?|tips?|recipe notes?)[:\s]*$/i.test(line)) {
      mode = 'notes';
      continue;
    }

    if (!title) {
      title = line;
      continue;
    }

    if (mode === 'ingredients') {
      // Skip sub-headings like "For the sauce:" without adding as an ingredient if empty after colon
      if (/^for\s+the\s+.+:$/i.test(line) || (line.endsWith(':') && line.length < 45)) {
        ingredients.push(`— ${line.replace(/:$/, '')} —`);
      } else {
        ingredients.push(line);
      }
    } else if (mode === 'steps') {
      if (/^(?:step\s*)?\d+[.)]?$/i.test(line)) {
        pendingStepPrefix = true;
        continue;
      }
      if (line.endsWith(':') && line.length < 55 && !pendingStepPrefix) {
        currentStepSection = line.replace(/:$/, '').trim();
        continue;
      }
      const cleanedStep = line.replace(/^(?:step\s*\d+[:.)\s-]*|\d+[.)]\s+)/i, '').trim();
      if (cleanedStep) {
        steps.push({
          id: `step-${steps.length + 1}`,
          section: currentStepSection,
          text: cleanedStep,
        });
      }
      pendingStepPrefix = false;
    } else if (mode === 'notes') {
      notes.push(line);
    } else {
      if (unitHint.test(line) && line.length < 95) {
        ingredients.push(line);
      } else {
        const cleanedStep = line.replace(/^(?:step\s*\d+[:.)\s-]*|\d+[.)]\s+)/i, '').trim();
        if (cleanedStep) {
          steps.push({
            id: `step-${steps.length + 1}`,
            text: cleanedStep,
          });
        }
      }
    }
  }

  const finalTitle = title || 'Custom Galley Recipe';
  const sourceUrl = cleanCanonicalUrl(customAttribution?.sourceUrl || '');
  const domain = sourceUrl ? extractDomain(sourceUrl) : 'ten-forward.the-lal.net';
  const siteName = customAttribution?.siteName || (sourceUrl ? domainToSiteName(domain) : 'Personal Recipe Box');
  const authorName = customAttribution?.authorName || parsedAuthor || 'Family / Personal Collection';

  return {
    id: `recipe-${Date.now()}`,
    title: finalTitle,
    description: 'Formatted in Ten Forward from pasted recipe text.',
    prepTime,
    cookTime,
    totalTime,
    baseServings,
    yieldText,
    category,
    cuisine,
    ingredients: ingredients.length > 0 ? ingredients : ['Add ingredients using the editor'],
    steps: steps.length > 0 ? steps : [{ id: 'step-1', text: 'Add preparation steps using the editor.' }],
    notes,
    heroImage: '',
    candidateImages: [],
    nutrition: calories ? { calories } : undefined,
    attribution: {
      sourceUrl: sourceUrl || 'https://ten-forward.the-lal.net/',
      domain,
      siteName,
      authorName,
      extractedAt: new Date().toISOString().slice(0, 10),
      creditNote: `Credited to ${authorName} (${siteName}).`,
    },
    extractionMethod: 'raw-text',
  };
}
