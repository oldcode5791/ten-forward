import { useState, useMemo, useEffect, useCallback, type ChangeEvent } from 'react';
import { InfoTooltip } from './components/InfoTooltip';
import { QrCodeBox } from './components/QrCodeBox';
import { STARFLEET_SAMPLE_RECIPES } from './data/starfleetRecipes';
import {
  compileRecipeMarkdown,
  compileStandaloneRecipeHtml,
} from './utils/exportCompilers';
import {
  convertStepTemperatures,
  transformIngredientLine,
} from './utils/ingredientScaler';
import {
  cleanCanonicalUrl,
  extractDomain,
  parseRawRecipeText,
} from './utils/recipeScraper';
import type {
  PrintPhotoMode,
  RecipeData,
  SavedRecipeEntry,
  UnitSystem,
} from './utils/recipeTypes';

const STORAGE_KEY = 'the_lal_ten_forward_saved_v1';

export function App() {
  // Active recipe state initialized to Guinan's Ten Forward preset
  const [recipe, setRecipe] = useState<RecipeData>(STARFLEET_SAMPLE_RECIPES[0]);

  // Input mode ('url' | 'paste' | 'presets' | 'saved')
  const [inputTab, setInputTab] = useState<'url' | 'paste' | 'presets' | 'saved'>('url');
  const [urlInput, setUrlInput] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const paramUrl = params.get('url')?.trim() || '';
    return /^https?:\/\//i.test(paramUrl) ? paramUrl : '';
  });
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  // Paste Raw Text / HTML fallback state
  const [rawPasteText, setRawPasteText] = useState('');
  const [pasteSourceUrl, setPasteSourceUrl] = useState('');
  const [pasteAuthorName, setPasteAuthorName] = useState('');
  const [pasteSiteName, setPasteSiteName] = useState('');

  // Interactive Scaling, Unit Conversion & Print Controls
  const [targetServings, setTargetServings] = useState<number>(
    STARFLEET_SAMPLE_RECIPES[0].baseServings
  );
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('original');
  const [photoMode, setPhotoMode] = useState<PrintPhotoMode>('hero-only');
  const [showQrCode, setShowQrCode] = useState<boolean>(true);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isEmbeddingPhoto, setIsEmbeddingPhoto] = useState<boolean>(false);

  // Cook Mode state (checked ingredients, active step highlight, screen wake lock)
  const [checkedIngredients, setCheckedIngredients] = useState<Record<number, boolean>>({});
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);
  const [wakeLockActive, setWakeLockActive] = useState<boolean>(false);

  // Toast feedback & Post-Export Support Modal
  const [toast, setToast] = useState<string | null>(null);
  const [exportModalAction, setExportModalAction] = useState<string | null>(null);
  const [pulseSupportPill, setPulseSupportPill] = useState<boolean>(true);

  useEffect(() => {
    const timer = setTimeout(() => setPulseSupportPill(false), 4500);
    return () => clearTimeout(timer);
  }, []);

  // Saved recipes in browser localStorage
  const [savedRecipes, setSavedRecipes] = useState<SavedRecipeEntry[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedRecipes));
    } catch {
      // Ignore storage quota errors in private browsing
    }
  }, [savedRecipes]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const loadRecipe = useCallback((next: RecipeData) => {
    setRecipe(next);
    setTargetServings(next.baseServings || 4);
    setCheckedIngredients({});
    setActiveStepIndex(null);
    setExtractError(null);
  }, []);

  /**
   * Calls the stateless /api/extract Worker endpoint to scrape JSON-LD, dish photos, and attribution.
   */
  const handleExtractUrl = useCallback(
    async (overrideUrl?: string) => {
      const target = (overrideUrl ?? urlInput).trim();
      if (!target) {
        setExtractError('Please paste a recipe URL starting with https:// or http://');
        return;
      }

      setIsExtracting(true);
      setExtractError(null);

      try {
        const res = await fetch(`/api/extract?url=${encodeURIComponent(target)}`);
        const data = (await res.json()) as { recipe?: RecipeData; error?: string };

        if (!res.ok || !data.recipe) {
          setExtractError(
            data.error ||
              'Could not extract recipe from that URL. Try switching to "Paste Text / HTML" tab.'
          );
          return;
        }

        loadRecipe(data.recipe);
        showToast(
          `Extracted "${data.recipe.title}" with creator attribution for ${data.recipe.attribution.authorName}.`
        );
      } catch {
        setExtractError(
          'Network error reaching extraction endpoint. You can paste raw recipe text or HTML in the "Paste Text / HTML" tab.'
        );
      } finally {
        setIsExtracting(false);
      }
    },
    [urlInput, loadRecipe, showToast]
  );

  // Support ?url=https://... query parameter for instant bookmarklet/address-bar extraction
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paramUrl = params.get('url')?.trim();
    if (!paramUrl || !/^https?:\/\//i.test(paramUrl)) return;
    let cancelled = false;
    fetch(`/api/extract?url=${encodeURIComponent(paramUrl)}`)
      .then((res) => res.json() as Promise<{ recipe?: RecipeData; error?: string }>)
      .then((data) => {
        if (cancelled) return;
        if (data.recipe) {
          loadRecipe(data.recipe);
        } else if (data.error) {
          setExtractError(data.error);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExtractError('Could not auto-extract URL from query string.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadRecipe]);

  /**
   * Parses raw pasted recipe text or HTML 100% in browser RAM.
   */
  const handleParsePastedText = () => {
    if (!rawPasteText.trim()) {
      showToast('Paste some recipe text or HTML first.');
      return;
    }
    const parsed = parseRawRecipeText(rawPasteText, {
      sourceUrl: pasteSourceUrl.trim() || undefined,
      authorName: pasteAuthorName.trim() || undefined,
      siteName: pasteSiteName.trim() || undefined,
    });
    loadRecipe(parsed);
    showToast(`Parsed "${parsed.title}" into a clean Galley Card.`);
  };

  /**
   * Converts the currently selected hero image into an inline compressed Data URI via Canvas
   * so offline HTML downloads and local saves never suffer from broken hotlinks.
   */
  const handleEmbedHeroPhotoOffline = async () => {
    if (!recipe.heroImage || recipe.heroImage.startsWith('data:image/')) {
      showToast('Hero photo is already embedded offline as a Data URI.');
      return;
    }
    setIsEmbeddingPhoto(true);
    try {
      const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(recipe.heroImage)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error('Image fetch failed');
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);

      const maxW = 900;
      const scale = Math.min(1, maxW / bitmap.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dataUri = canvas.toDataURL('image/jpeg', 0.84);

      setRecipe((prev) => ({
        ...prev,
        heroImage: dataUri,
      }));
      showToast('Embedded dish photo into browser memory for 100% offline saving!');
    } catch {
      showToast('Could not inline remote image due to origin restrictions; standard URL retained.');
    } finally {
      setIsEmbeddingPhoto(false);
    }
  };

  /**
   * Allows user to upload a custom dish photo from their device (compressed in RAM).
   */
  const handleCustomPhotoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxW = 900;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.84);
        setRecipe((prev) => ({
          ...prev,
          heroImage: dataUrl,
          candidateImages: [
            { url: dataUrl, caption: file.name, source: 'custom', score: 110 },
            ...prev.candidateImages,
          ],
        }));
        showToast('Added custom dish photo in browser memory.');
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  /**
   * Toggles Screen Wake Lock so the kitchen tablet/phone doesn't dim while cooking.
   */
  const handleToggleWakeLock = async () => {
    if (!('wakeLock' in navigator)) {
      showToast('Screen Wake Lock API is not supported by this browser.');
      return;
    }
    try {
      if (!wakeLockActive) {
        await navigator.wakeLock.request('screen');
        setWakeLockActive(true);
        showToast('Galley Cook Mode active: screen will stay awake while this tab is open.');
      } else {
        setWakeLockActive(false);
        showToast('Screen Wake Lock released.');
      }
    } catch {
      showToast('Could not acquire Screen Wake Lock.');
    }
  };

  // Compute scaled & unit-converted ingredients and steps
  const scaleFactor = useMemo(
    () => targetServings / Math.max(1, recipe.baseServings),
    [targetServings, recipe.baseServings]
  );

  const displayedIngredients = useMemo(
    () =>
      recipe.ingredients.map((line) =>
        transformIngredientLine(line, scaleFactor, unitSystem)
      ),
    [recipe.ingredients, scaleFactor, unitSystem]
  );

  const displayedSteps = useMemo(
    () =>
      recipe.steps.map((step) => ({
        ...step,
        text: convertStepTemperatures(step.text, unitSystem),
      })),
    [recipe.steps, unitSystem]
  );

  // Export & Save Handlers
  const handlePrintCard = () => {
    window.print();
    setExportModalAction('Your printable Galley Card is ready!');
  };

  const handleDownloadStandaloneHtml = () => {
    const html = compileStandaloneRecipeHtml(
      recipe,
      targetServings,
      unitSystem,
      photoMode,
      showQrCode
    );
    const slug = (recipe.title || 'recipe')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug || 'galley'}-recipe-card.html`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Downloaded standalone offline card: ${slug}-recipe-card.html`);
    setExportModalAction(`Downloaded ${slug}-recipe-card.html!`);
  };

  const handleDownloadMarkdown = () => {
    const md = compileRecipeMarkdown(recipe, targetServings, unitSystem);
    const slug = (recipe.title || 'recipe')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug || 'galley'}-recipe.md`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Downloaded Markdown with attribution frontmatter: ${slug}-recipe.md`);
    setExportModalAction(`Downloaded ${slug}-recipe.md!`);
  };

  const handleCopyMarkdown = async () => {
    const md = compileRecipeMarkdown(recipe, targetServings, unitSystem);
    await navigator.clipboard.writeText(md);
    showToast('Copied Markdown recipe (with Creator Attribution header) to clipboard!');
  };

  const handleSaveToGalleyBox = () => {
    const entry: SavedRecipeEntry = {
      id: `${recipe.id}-${Date.now()}`,
      savedAt: new Date().toISOString().slice(0, 10),
      recipe: { ...recipe },
    };
    setSavedRecipes((prev) => [entry, ...prev]);
    setInputTab('saved');
    showToast(`Saved "${recipe.title}" into your Galley Box (in-browser saved recipes)!`);
  };

  const handleDeleteSaved = (id: string) => {
    setSavedRecipes((prev) => prev.filter((item) => item.id !== id));
    showToast('Removed recipe from your Galley Box.');
  };

  const handleExportGalleyBoxJson = () => {
    const blob = new Blob([JSON.stringify(savedRecipes, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ten-forward-galley-box-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Downloaded Galley Box recipe backup (.json).');
  };

  const handleImportGalleyBoxJson = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed)) throw new Error('Invalid format');
        const valid = parsed.filter(
          (item): item is SavedRecipeEntry =>
            Boolean(item && typeof item === 'object' && item.recipe && item.recipe.title)
        );
        setSavedRecipes((prev) => [...valid, ...prev]);
        showToast(`Imported ${valid.length} recipe(s) into your Galley Box!`);
      } catch {
        showToast('Could not parse backup file — make sure it is a valid Galley Box .json export.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Sticky Navigation Bar (Hidden when printing) */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-30 no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-mono font-bold text-sm"
              title="Ten Forward — Deck 10, Forward Section 1"
            >
              10F
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white flex flex-wrap items-center gap-2">
                Ten Forward
                <span
                  className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-cyan-950 border border-cyan-500/30 text-cyan-400"
                  title="Ten Forward Application Version 1.3"
                >
                  v1.3
                </span>
                <span className="text-xs font-normal text-slate-400 hidden sm:inline">
                  — Recipe Extractor &amp; Printable Galley Card
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-mono uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  Creator Attribution + Zero Tracking
                  <InfoTooltip
                    position="bottom"
                    text="Stateless edge extraction strips ads and popups while permanently preserving the original chef/author name, site name, clickable link, and printable QR code."
                  />
                </span>
              </h1>
              <p className="text-xs text-slate-400">
                Intelligent JSON-LD &amp; Dish Photo Scraper &bull; Portion Scaler &bull; Offline HTML, Markdown &amp; Print PDF
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="inline-flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setInputTab('saved')}
                title="Galley Box is your personal Recipe Box saved privately inside this browser. Click to view your saved recipes."
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border font-medium transition-colors cursor-pointer ${
                  inputTab === 'saved'
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-cyan-300'
                }`}
              >
                <svg
                  className="w-4 h-4 text-cyan-400 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                  />
                </svg>
                <span>Galley Box</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-slate-950/90 text-cyan-300 border border-slate-700">
                  {savedRecipes.length} saved
                </span>
              </button>
              <InfoTooltip
                position="bottom"
                text="Galley Box is your personal Recipe Box stored privately inside your browser (localStorage). Save your favorite extracted recipes here to build your own ad-free cookbook—100% offline with no account required."
              />
            </div>
            <a
              href="https://apps.the-lal.net"
              title="Return to the full the-lal.net browser utility directory"
              className="text-slate-400 hover:text-cyan-400 transition-colors"
            >
              &larr; App Showcase
            </a>
          </div>
        </div>
      </header>

      {/* Floating Guidance / Status Toast Banner */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 backdrop-blur border border-cyan-500/40 text-cyan-200 px-5 py-2.5 rounded-full shadow-2xl text-sm font-medium max-w-md text-center no-print">
          {toast}
        </div>
      )}

      {/* Post-Export Confirmation & Buy Me a Coffee Support Modal */}
      {exportModalAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm transition-opacity no-print">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-8 shadow-2xl flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-5">
              <svg
                className="w-8 h-8"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>

            <h3 className="text-xl font-bold text-white mb-2">{exportModalAction}</h3>
            <p className="text-slate-400 text-sm mb-6">
              Your clean Galley Card preserves full attribution and QR source links for{' '}
              <strong className="text-slate-200">{recipe.attribution.authorName}</strong> with zero
              tracking or server storage.
            </p>

            <div className="flex flex-col gap-3 w-full">
              <button
                type="button"
                onClick={() => {
                  setExportModalAction(null);
                  setInputTab('url');
                }}
                title="Extract another recipe URL"
                className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold py-3 px-6 rounded-xl shadow-lg shadow-cyan-500/25 transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer"
              >
                Extract Another Recipe
              </button>
              <button
                type="button"
                onClick={() => setExportModalAction(null)}
                title="Return to the current recipe card"
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium py-2.5 px-6 rounded-xl border border-slate-700 transition-colors cursor-pointer"
              >
                Keep Viewing This Recipe
              </button>
            </div>

            <div className="mt-6 pt-5 border-t border-slate-800/80 w-full flex flex-col items-center">
              <p className="text-xs text-slate-400 mb-3">
                Saved you from scrolling past 15 pop-up ads?
              </p>
              <a
                href="https://buymeacoffee.com/curiouslyso"
                target="_blank"
                rel="noopener noreferrer"
                title="Support independent privacy-first browser utilities"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/25 text-amber-300 text-sm font-semibold border border-amber-500/40 transition-all hover:scale-105 shadow-md"
              >
                <span className="text-lg">☕</span>
                <span>Buy Me a Coffee</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Floating Developer Support Pill (Standard across the-lal.net fleet) */}
      <a
        id="btn-support-pill"
        href="https://buymeacoffee.com/curiouslyso"
        target="_blank"
        rel="noopener noreferrer"
        title="Support independent privacy-first browser tools on Buy Me a Coffee"
        className={`fixed bottom-5 right-5 z-30 inline-flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-slate-900/95 hover:bg-slate-800 text-amber-300 font-medium text-sm border border-amber-500/40 hover:border-amber-400 shadow-xl backdrop-blur transition-all duration-300 hover:scale-105 no-print ${
          pulseSupportPill ? 'animate-pulse ring-2 ring-amber-400/50 border-amber-400' : ''
        }`}
      >
        <span className="text-lg leading-none">☕</span>
        <span>Support the dev</span>
      </a>

      {/* Main Content Container */}
      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 print:px-0 print:py-0 flex-1 space-y-6">
        {/* 1. Extraction & Source Input Deck (Hidden in Print) */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl no-print">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3.5 mb-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setInputTab('url')}
                  title="Extract a recipe, dish photos, and creator attribution from any public URL"
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    inputTab === 'url'
                      ? 'bg-cyan-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  🔗 1. Scrape Recipe URL
                </button>
                <InfoTooltip text="Paste any link from a recipe blog or cooking site to strip out ads and life stories while keeping dish photos and creator credit." />
              </div>

              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setInputTab('paste')}
                  title="Paste copied recipe text or raw HTML directly (works 100% offline with zero network calls)"
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    inputTab === 'paste'
                      ? 'bg-cyan-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  📋 2. Paste Text / HTML (Offline)
                </button>
                <InfoTooltip text="Copy and paste text from an email, document, or paywalled webpage to format it into a clean Galley Card 100% offline." />
              </div>

              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setInputTab('presets')}
                  title="Load Star Trek: The Next Generation sample recipes from Ten Forward"
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    inputTab === 'presets'
                      ? 'bg-cyan-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  🖖 3. Starfleet Sample Recipes
                </button>
                <InfoTooltip text="Try Ten Forward immediately with sample recipes from Guinan, Captain Picard, and Commander Riker." />
              </div>

              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setInputTab('saved')}
                  title="Galley Box: Open your personal collection of recipes saved inside this browser"
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    inputTab === 'saved'
                      ? 'bg-cyan-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  🗃️ 4. Galley Box • Saved Recipes ({savedRecipes.length})
                </button>
                <InfoTooltip text="Think of the Galley Box as the recipe tin on your kitchen counter. Any recipe you save here stays in your browser's local storage so you can reopen or print it anytime." />
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <span>Anti-Garbage Image Filter Active</span>
              <InfoTooltip text="Ten Forward prioritizes schema.org/Recipe dish & step photos and automatically rejects ad banners, author avatars, social icons, SVGs, GIFs, and tracking pixels." />
            </div>
          </div>

          {/* Tab 1: Scrape by URL */}
          {inputTab === 'url' && (
            <div className="space-y-3">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                Recipe Page URL
                <InfoTooltip text="Paste any link from Serious Eats, NYT Cooking, Allrecipes, BBC Good Food, Simply Recipes, or any food blog using standard recipe schema." />
              </label>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleExtractUrl();
                  }}
                  placeholder="https://www.seriouseats.com/... or any food blog URL"
                  title="Enter the full URL of the recipe webpage you want to extract"
                  className="flex-1 rounded-xl bg-slate-950 border border-slate-700 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
                />
                <button
                  type="button"
                  disabled={isExtracting}
                  onClick={() => void handleExtractUrl()}
                  title="Fetch the recipe URL, filter out ads and garbage images, and format a printable Galley Card"
                  className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-sm transition-colors shrink-0 cursor-pointer"
                >
                  {isExtracting ? 'Scanning Recipe...' : 'Extract Galley Card'}
                </button>
              </div>
              {extractError && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-200 text-xs flex items-center justify-between gap-3">
                  <span>{extractError}</span>
                  <button
                    type="button"
                    onClick={() => setInputTab('paste')}
                    title="Switch to manual text/HTML paste mode"
                    className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 font-semibold shrink-0"
                  >
                    Switch to Paste Mode &rarr;
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Paste Raw Text / HTML */}
          {inputTab === 'paste' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] font-semibold uppercase text-slate-400 flex items-center gap-1 mb-1">
                    Creator / Author Name
                    <InfoTooltip text="Who wrote or shared this recipe? (e.g., J. Kenji López-Alt, Grandma Rose, Chef Guinan). Preserved on all printouts." />
                  </label>
                  <input
                    type="text"
                    value={pasteAuthorName}
                    onChange={(e) => setPasteAuthorName(e.target.value)}
                    placeholder="e.g., Grandma Rose or Chef Name"
                    title="Author or creator name for attribution"
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase text-slate-400 flex items-center gap-1 mb-1">
                    Publication / Cookbook Source
                    <InfoTooltip text="Website name, family cookbook, or magazine where this recipe originated." />
                  </label>
                  <input
                    type="text"
                    value={pasteSiteName}
                    onChange={(e) => setPasteSiteName(e.target.value)}
                    placeholder="e.g., Family Recipe Binder"
                    title="Website or publication name for attribution"
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase text-slate-400 flex items-center gap-1 mb-1">
                    Original URL (Optional for QR)
                    <InfoTooltip text="If from a webpage, include the link so Ten Forward can generate a scannable QR code on the printed sheet." />
                  </label>
                  <input
                    type="url"
                    value={pasteSourceUrl}
                    onChange={(e) => setPasteSourceUrl(e.target.value)}
                    placeholder="https://..."
                    title="Optional source URL for clickable link and print QR code"
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold uppercase text-slate-400 flex items-center gap-1 mb-1">
                  Paste Recipe Text or Page HTML
                  <InfoTooltip text="Paste plain text (First line = Title, followed by Ingredients: and Instructions:) OR paste raw HTML source from any webpage." />
                </label>
                <textarea
                  rows={5}
                  value={rawPasteText}
                  onChange={(e) => setRawPasteText(e.target.value)}
                  placeholder={`Guinan's Spiced Tea Cake\nIngredients:\n2 cups flour\n1 cup sugar\nInstructions:\n1. Preheat oven to 350°F.\n2. Mix ingredients and bake for 30 minutes.`}
                  title="Paste copied recipe text or HTML source code here"
                  className="w-full rounded-xl bg-slate-950 border border-slate-700 p-3 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleParsePastedText}
                  title="Parse the pasted text or HTML into a structured Galley Card"
                  className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs cursor-pointer"
                >
                  Format Into Galley Card
                </button>
              </div>
            </div>
          )}

          {/* Tab 3: Starfleet Sample Presets */}
          {inputTab === 'presets' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {STARFLEET_SAMPLE_RECIPES.map((sample) => {
                const active = recipe.id === sample.id;
                return (
                  <button
                    key={sample.id}
                    type="button"
                    onClick={() => {
                      loadRecipe(sample);
                      showToast(`Loaded Starfleet preset: ${sample.title}`);
                    }}
                    title={`Load sample recipe: ${sample.title}`}
                    className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                      active
                        ? 'bg-cyan-500/10 border-cyan-400 text-white'
                        : 'bg-slate-950/70 border-slate-800 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="text-[10px] font-mono uppercase text-cyan-400 mb-1">
                      {sample.attribution.authorName}
                    </div>
                    <div className="font-bold text-sm text-white mb-1">{sample.title}</div>
                    <p className="text-xs text-slate-400 line-clamp-2">{sample.description}</p>
                  </button>
                );
              })}
            </div>
          )}

          {/* Tab 4: Saved Local Galley Box */}
          {inputTab === 'saved' && (
            <div className="space-y-4">
              {/* Visual Aid Banner Explaining the Galley Box */}
              <div className="p-4 rounded-xl bg-slate-950/90 border border-cyan-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="w-11 h-11 rounded-xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0 mt-0.5">
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.8"
                        d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                      />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-white">
                        Your Personal Galley Box (In-Browser Recipe Tin)
                      </h3>
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        100% On-Device Storage
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                      In naval and Starfleet terminology, the <strong className="text-slate-200">galley</strong> is the kitchen.
                      Your <strong className="text-cyan-300">Galley Box</strong> works like a classic recipe card box on your counter:
                      any recipe you save is stored privately inside this browser so you can reopen, scale, or print it anytime—and you can export or import a <code className="text-cyan-300">.json</code> backup file to move your collection between devices.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleSaveToGalleyBox}
                    title={`Save the currently open recipe ("${recipe.title}") into your Galley Box`}
                    className="px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-colors cursor-pointer"
                  >
                    + Save Current Recipe
                  </button>
                  {savedRecipes.length > 0 && (
                    <button
                      type="button"
                      onClick={handleExportGalleyBoxJson}
                      title="Download all saved Galley Box recipes as a portable .json backup file"
                      className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                    >
                      Export Backup (.JSON)
                    </button>
                  )}
                  <label
                    title="Restore or merge recipes from a previously exported Galley Box .json backup file"
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                  >
                    Import .JSON
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={handleImportGalleyBoxJson}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {savedRecipes.length === 0 ? (
                <div className="p-6 rounded-xl bg-slate-950/50 border border-dashed border-slate-800 text-center space-y-2">
                  <p className="text-sm font-semibold text-slate-300">
                    Your Galley Box doesn&apos;t have any saved recipe cards yet.
                  </p>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    Click <strong className="text-cyan-300">&ldquo;+ Save Current Recipe&rdquo;</strong> above (or{' '}
                    <strong className="text-cyan-300">&ldquo;🗃️ Save to Galley Box&rdquo;</strong> in the toolbar below)
                    to bookmark <em className="text-slate-200">{recipe.title}</em> into your personal collection.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {savedRecipes.map((entry) => (
                    <div
                      key={entry.id}
                      className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 flex flex-col justify-between gap-3 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        {entry.recipe.heroImage && (
                          <img
                            src={entry.recipe.heroImage}
                            alt={entry.recipe.title}
                            className="w-16 h-16 rounded-lg object-cover border border-slate-800 shrink-0"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-mono text-cyan-400 truncate">
                            By {entry.recipe.attribution.authorName} &bull; {entry.recipe.attribution.siteName}
                          </div>
                          <div className="font-bold text-sm text-white mt-0.5 line-clamp-2">
                            {entry.recipe.title}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-1">
                            Saved {entry.savedAt} &bull; {entry.recipe.ingredients.length} ingredients
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                        <button
                          type="button"
                          onClick={() => {
                            loadRecipe(entry.recipe);
                            showToast(`Opened "${entry.recipe.title}" from your Galley Box.`);
                          }}
                          title="Load this saved recipe card into the main view below"
                          className="flex-1 px-2.5 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 text-xs font-semibold cursor-pointer"
                        >
                          Open Recipe Card
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSaved(entry.id)}
                          title="Remove this recipe from your browser's Galley Box"
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-300 text-xs cursor-pointer"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* 2. Interactive Galley Control Toolbar (Portion Scaling, Units, Photo Picker, Print/Export) */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-4 no-print">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Portion Multiplier & Servings */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                Portions:
                <InfoTooltip text="Scale ingredient quantities automatically. Fractions (like 1/2, 1/3, 3/4) are recalculated into clean kitchen measurements." />
              </span>
              <div className="inline-flex items-center rounded-xl bg-slate-950 border border-slate-800 p-1 gap-1">
                <button
                  type="button"
                  onClick={() => setTargetServings((s) => Math.max(1, s - 1))}
                  title="Decrease servings by 1"
                  className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-sm cursor-pointer"
                >
                  &minus;
                </button>
                <span
                  className="px-2.5 text-xs font-mono font-bold text-cyan-300"
                  title="Current target serving count"
                >
                  {targetServings} srv
                </span>
                <button
                  type="button"
                  onClick={() => setTargetServings((s) => s + 1)}
                  title="Increase servings by 1"
                  className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-sm cursor-pointer"
                >
                  +
                </button>
              </div>

              <div className="inline-flex items-center gap-1">
                {[0.5, 1, 2, 3].map((mult) => {
                  const target = Math.max(1, Math.round(recipe.baseServings * mult));
                  const isCurrent = targetServings === target;
                  return (
                    <button
                      key={mult}
                      type="button"
                      onClick={() => setTargetServings(target)}
                      title={`Scale recipe to ${mult}x original yield (${target} servings)`}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold border transition-colors cursor-pointer ${
                        isCurrent
                          ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {mult}x
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Unit System Converter */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                Units:
                <InfoTooltip text="Convert weights, volumes, and oven temperatures (°F <-> °C) between Original, Metric (grams/ml/°C), and US Imperial (oz/cups/°F)." />
              </span>
              <div className="inline-flex rounded-xl bg-slate-950 border border-slate-800 p-1 gap-1">
                {(
                  [
                    { id: 'original', label: 'Original' },
                    { id: 'metric', label: 'Metric (g/ml/°C)' },
                    { id: 'imperial', label: 'Imperial (oz/°F)' },
                  ] as const
                ).map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setUnitSystem(u.id)}
                    title={`Display measurements in ${u.label}`}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      unitSystem === u.id
                        ? 'bg-cyan-500 text-slate-950'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {u.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Photo & QR Print Options */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                Photos:
                <InfoTooltip text="Choose whether to include the main dish photo, dish + step photos, or no photos (ink-saver mode) on the card and printout." />
              </span>
              <select
                value={photoMode}
                onChange={(e) => setPhotoMode(e.target.value as PrintPhotoMode)}
                title="Select photo display mode for screen and print"
                className="rounded-xl bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-400"
              >
                <option value="hero-only">Dish Cover Photo Only</option>
                <option value="hero-and-steps">Dish + Step Photos</option>
                <option value="no-photos">No Photos (Ink Saver)</option>
              </select>

              <label
                className="inline-flex items-center gap-1.5 text-xs text-slate-300 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 cursor-pointer"
                title="Include a scannable QR code linking back to the creator's original recipe URL"
              >
                <input
                  type="checkbox"
                  checked={showQrCode}
                  onChange={(e) => setShowQrCode(e.target.checked)}
                  className="accent-cyan-400"
                />
                <span>Attribution QR</span>
                <InfoTooltip text="Generates a scannable QR code on the card and printout so you can scan your printed paper with your phone camera to open the original webpage." />
              </label>
            </div>
          </div>

          {/* Action Bar: Print, Export, Edit, Wake Lock */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsEditing((v) => !v)}
                title="Edit recipe title, creator attribution, ingredients, steps, or notes before printing"
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                  isEditing
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                    : 'bg-slate-800 border-slate-700 text-slate-200 hover:border-slate-600'
                }`}
              >
                {isEditing ? 'Done Editing' : 'Edit Recipe & Attribution'}
              </button>

              <button
                type="button"
                onClick={() => void handleToggleWakeLock()}
                title="Keep your screen from dimming while you follow the recipe in the kitchen"
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                  wakeLockActive
                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                }`}
              >
                {wakeLockActive ? 'Cook Mode: Screen Awake' : 'Keep Screen Awake'}
              </button>

              {recipe.heroImage && !recipe.heroImage.startsWith('data:image/') && (
                <button
                  type="button"
                  disabled={isEmbeddingPhoto}
                  onClick={() => void handleEmbedHeroPhotoOffline()}
                  title="Download and compress the dish photo into a self-contained Base64 image so exported HTML files work 100% offline"
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 cursor-pointer"
                >
                  {isEmbeddingPhoto ? 'Embedding Photo...' : 'Inline Photo for Offline Save'}
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleSaveToGalleyBox}
                  title="Bookmark this recipe inside your browser's personal Galley Box (Saved Recipes) for instant offline access later"
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                >
                  🗃️ Save to Galley Box
                </button>
                <InfoTooltip text="Saves a copy of this recipe inside your browser's personal Galley Box (Tab 4) so you can reopen it anytime without re-scraping the website." />
              </div>

              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleCopyMarkdown}
                  title="Copy formatted Markdown (with YAML attribution frontmatter) to clipboard"
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                >
                  📋 Copy .MD
                </button>
                <InfoTooltip text="Copies the recipe in Markdown format (including creator attribution and scaled ingredients) so you can paste it into Notion, Obsidian, or Apple Notes." />
              </div>

              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleDownloadMarkdown}
                  title="Download as a Markdown (.md) file for Obsidian, Notion, or local folders"
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                >
                  ⬇️ Download .MD
                </button>
              </div>

              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleDownloadStandaloneHtml}
                  title="Download a self-contained, printable .html recipe card with embedded QR code and attribution"
                  className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-cyan-500/40 text-cyan-300 text-xs font-semibold cursor-pointer"
                >
                  💾 Save Offline .HTML
                </button>
                <InfoTooltip text="Downloads a standalone .html file containing the styled recipe card, attribution link, and QR code that opens in any browser even without internet." />
              </div>

              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={handlePrintCard}
                  title="Open your browser's print / Save-as-PDF dialog using the ink-friendly light stylesheet"
                  className="px-4 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-lg shadow-cyan-500/10 cursor-pointer"
                >
                  🖨️ Print / Save PDF
                </button>
                <InfoTooltip text="Formats the recipe onto a clean, ink-friendly white sheet with a scannable QR code pointing back to the original creator's webpage." />
              </div>
            </div>
          </div>

          {/* Candidate Dish Photo Picker Strip (when images are available or user wants to upload one) */}
          {photoMode !== 'no-photos' && (
            <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 overflow-x-auto py-1">
                <span className="text-[11px] font-semibold uppercase text-slate-400 flex items-center gap-1 shrink-0">
                  Verified Dish Photos ({recipe.candidateImages.length}):
                  <InfoTooltip text="Click any scraped candidate photo to set it as the recipe cover image, or upload your own photo from your device." />
                </span>
                {recipe.candidateImages.map((img, i) => {
                  const selected = recipe.heroImage === img.url;
                  return (
                    <button
                      key={`${img.url}-${i}`}
                      type="button"
                      onClick={() => setRecipe((prev) => ({ ...prev, heroImage: img.url }))}
                      title={`Select photo #${i + 1} (${img.source})`}
                      className={`relative w-16 h-12 rounded-lg overflow-hidden border-2 shrink-0 transition-all cursor-pointer ${
                        selected
                          ? 'border-cyan-400 ring-2 ring-cyan-400/30'
                          : 'border-slate-700 opacity-70 hover:opacity-100'
                      }`}
                    >
                      <img
                        src={img.url}
                        alt={img.caption || `Candidate ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  );
                })}
              </div>

              <label
                className="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-xs text-slate-300 cursor-pointer shrink-0"
                title="Choose a photo from your device (processed locally in browser RAM)"
              >
                + Custom Photo
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleCustomPhotoUpload}
                  className="hidden"
                />
              </label>
            </div>
          )}
        </section>

        {/* 3. Optional Inline Recipe & Attribution Editor Drawer */}
        {isEditing && (
          <section className="bg-slate-900 border border-cyan-500/40 rounded-2xl p-5 shadow-xl space-y-4 no-print">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h2 className="text-sm font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-2">
                Edit Recipe &amp; Creator Attribution
                <InfoTooltip text="Customize any detail or fix a scraped ingredient line before printing or saving." />
              </h2>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                title="Close editor panel"
                className="text-xs text-slate-400 hover:text-white"
              >
                Close &times;
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-[11px] uppercase text-slate-400 font-semibold mb-1">
                  Recipe Title
                </label>
                <input
                  type="text"
                  value={recipe.title}
                  onChange={(e) => setRecipe((p) => ({ ...p, title: e.target.value }))}
                  title="Edit recipe title"
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase text-slate-400 font-semibold mb-1">
                  Author / Chef Attribution
                </label>
                <input
                  type="text"
                  value={recipe.attribution.authorName}
                  onChange={(e) =>
                    setRecipe((p) => ({
                      ...p,
                      attribution: { ...p.attribution, authorName: e.target.value },
                    }))
                  }
                  title="Edit original author or chef name"
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase text-slate-400 font-semibold mb-1">
                  Publication / Site Name
                </label>
                <input
                  type="text"
                  value={recipe.attribution.siteName}
                  onChange={(e) =>
                    setRecipe((p) => ({
                      ...p,
                      attribution: { ...p.attribution, siteName: e.target.value },
                    }))
                  }
                  title="Edit source website or cookbook name"
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] uppercase text-slate-400 font-semibold mb-1">
                  Canonical Source URL (Used for Link &amp; Print QR Code)
                </label>
                <input
                  type="url"
                  value={recipe.attribution.sourceUrl}
                  onChange={(e) => {
                    const nextUrl = cleanCanonicalUrl(e.target.value);
                    setRecipe((p) => ({
                      ...p,
                      attribution: {
                        ...p.attribution,
                        sourceUrl: nextUrl,
                        domain: extractDomain(nextUrl),
                      },
                    }));
                  }}
                  title="Edit canonical URL for source attribution and QR code"
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase text-slate-400 font-semibold mb-1">
                  Prep Time
                </label>
                <input
                  type="text"
                  value={recipe.prepTime}
                  onChange={(e) => setRecipe((p) => ({ ...p, prepTime: e.target.value }))}
                  title="Edit preparation time"
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase text-slate-400 font-semibold mb-1">
                  Cook Time
                </label>
                <input
                  type="text"
                  value={recipe.cookTime}
                  onChange={(e) => setRecipe((p) => ({ ...p, cookTime: e.target.value }))}
                  title="Edit cook time"
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] uppercase text-slate-400 font-semibold mb-1">
                  Ingredients (One per line, at base {recipe.baseServings} servings)
                </label>
                <textarea
                  rows={7}
                  value={recipe.ingredients.join('\n')}
                  onChange={(e) =>
                    setRecipe((p) => ({
                      ...p,
                      ingredients: e.target.value.split('\n').filter((l) => l.trim().length > 0),
                    }))
                  }
                  title="Edit ingredient list (one ingredient per line)"
                  className="w-full rounded-xl bg-slate-950 border border-slate-700 p-3 text-xs text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase text-slate-400 font-semibold mb-1">
                  Preparation Steps (One step per line)
                </label>
                <textarea
                  rows={7}
                  value={recipe.steps.map((s) => s.text).join('\n')}
                  onChange={(e) =>
                    setRecipe((p) => ({
                      ...p,
                      steps: e.target.value
                        .split('\n')
                        .filter((l) => l.trim().length > 0)
                        .map((text, idx) => ({
                          id: `step-${idx + 1}`,
                          text,
                        })),
                    }))
                  }
                  title="Edit instruction steps (one step per line)"
                  className="w-full rounded-xl bg-slate-950 border border-slate-700 p-3 text-xs text-white font-mono"
                />
              </div>
            </div>
          </section>
        )}

        {/* 4. Printable / Saveable Galley Recipe Card */}
        <article className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl print-card">
          {/* Card Header + Mandatory Creator Attribution Banner + QR Code */}
          <div className="flex flex-col sm:flex-row items-start justify-between gap-6 pb-6 mb-6 border-b border-slate-800 print:border-slate-300">
            <div className="space-y-3 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[11px] font-mono uppercase tracking-wider px-3 py-1 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 print:bg-slate-100 print:text-slate-800 print:border-slate-400">
                  {recipe.category || 'Galley Recipe'}
                </span>
                {recipe.cuisine && (
                  <span className="text-[11px] font-mono text-slate-400 print:text-slate-600">
                    &bull; {recipe.cuisine}
                  </span>
                )}
              </div>

              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white print:text-slate-950 leading-snug">
                {recipe.title}
              </h2>

              {recipe.description && (
                <p className="text-sm text-slate-300 print:text-slate-700 leading-relaxed max-w-3xl">
                  {recipe.description}
                </p>
              )}

              {/* Prominent Creator Attribution Banner (Never hidden in print or screen) */}
              <div className="mt-4 p-4 sm:px-5 sm:py-4 rounded-xl bg-slate-950/90 border-l-4 border-cyan-400 border border-slate-800 print:bg-slate-50 print:border-slate-300 print:border-l-4 print:border-l-cyan-600">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs leading-relaxed">
                  <span className="font-bold text-cyan-300 print:text-slate-900">
                    Recipe by {recipe.attribution.authorName}
                  </span>
                  <span className="text-slate-500">&bull;</span>
                  <span className="text-slate-200 print:text-slate-800 font-medium">
                    Published on <strong>{recipe.attribution.siteName}</strong>
                  </span>
                  {recipe.attribution.publishedDate && (
                    <>
                      <span className="text-slate-500">&bull;</span>
                      <span className="text-slate-400 print:text-slate-600">
                        Published {recipe.attribution.publishedDate}
                      </span>
                    </>
                  )}
                </div>
                <div className="mt-1.5 text-xs text-slate-400 print:text-slate-700 break-all leading-relaxed">
                  Original Source:{' '}
                  <a
                    href={recipe.attribution.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open the original recipe webpage in a new tab"
                    className="text-cyan-400 hover:text-cyan-300 underline print:text-cyan-800 font-mono"
                  >
                    {recipe.attribution.sourceUrl}
                  </a>
                </div>
              </div>
            </div>

            {/* Scannable QR Code for Print & Mobile Cross-Device Handoff */}
            {showQrCode && (
              <QrCodeBox
                url={recipe.attribution.sourceUrl}
                domain={recipe.attribution.domain}
                size={88}
              />
            )}
          </div>

          {/* Timing & Yield Metadata Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 my-6 px-5 py-4 rounded-xl bg-slate-950/70 border border-slate-800/90 print:bg-slate-50 print:border-slate-300 text-xs">
            <div className="space-y-0.5">
              <span className="block text-[10px] font-mono uppercase text-slate-400 print:text-slate-600">
                Servings
              </span>
              <span className="font-bold text-white print:text-slate-950">
                {targetServings}{' '}
                {targetServings !== recipe.baseServings && (
                  <span className="text-cyan-400 print:text-slate-600 font-normal">
                    (from {recipe.baseServings})
                  </span>
                )}
              </span>
            </div>
            <div className="space-y-0.5">
              <span className="block text-[10px] font-mono uppercase text-slate-400 print:text-slate-600">
                Prep Time
              </span>
              <span className="font-bold text-white print:text-slate-950">
                {recipe.prepTime || '—'}
              </span>
            </div>
            <div className="space-y-0.5">
              <span className="block text-[10px] font-mono uppercase text-slate-400 print:text-slate-600">
                Cook Time
              </span>
              <span className="font-bold text-white print:text-slate-950">
                {recipe.cookTime || '—'}
              </span>
            </div>
            <div className="space-y-0.5">
              <span className="block text-[10px] font-mono uppercase text-slate-400 print:text-slate-600">
                Total Time
              </span>
              <span className="font-bold text-white print:text-slate-950">
                {recipe.totalTime || '—'}
              </span>
            </div>
            <div className="space-y-0.5">
              <span className="block text-[10px] font-mono uppercase text-slate-400 print:text-slate-600">
                Calories
              </span>
              <span className="font-bold text-white print:text-slate-950">
                {recipe.nutrition?.calories || '—'}
              </span>
            </div>
          </div>

          {/* Hero Dish Photo */}
          {photoMode !== 'no-photos' && recipe.heroImage && (
            <div className="mb-7 rounded-xl overflow-hidden border border-slate-800 print:border-slate-300 bg-slate-950">
              <img
                src={recipe.heroImage}
                alt={recipe.title}
                className="w-full max-h-80 object-cover"
              />
            </div>
          )}

          {/* 2-Column Recipe Body: Ingredients + Preparation Steps */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column: Checkable Ingredients */}
            <div className="lg:col-span-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 print:border-slate-300 pb-3 mb-2">
                <h3 className="text-sm font-bold uppercase tracking-wider text-cyan-400 print:text-slate-900 flex items-center gap-1.5">
                  Ingredients
                  <InfoTooltip text="Click any ingredient while prepping to check it off." />
                </h3>
                <span className="text-[11px] font-mono text-slate-400 print:text-slate-600">
                  {unitSystem === 'original'
                    ? 'Original Units'
                    : unitSystem === 'metric'
                      ? 'Metric (g/ml/°C)'
                      : 'Imperial (oz/°F)'}
                </span>
              </div>

              <ul className="divide-y divide-slate-800/70 print:divide-slate-200">
                {displayedIngredients.map((line, idx) => {
                  const checked = Boolean(checkedIngredients[idx]);
                  return (
                    <li key={idx} className="py-2.5 px-1">
                      <label
                        className="flex items-start gap-3 text-sm leading-relaxed cursor-pointer select-none"
                        title="Click to check or uncheck this ingredient"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setCheckedIngredients((prev) => ({
                              ...prev,
                              [idx]: !prev[idx],
                            }))
                          }
                          className="mt-1 accent-cyan-400 rounded shrink-0"
                        />
                        <span
                          className={
                            checked
                              ? 'line-through text-slate-500 print:text-slate-400'
                              : 'text-slate-100 print:text-slate-900'
                          }
                        >
                          {line}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Right Column: Numbered Steps + Chef Notes */}
            <div className="lg:col-span-8 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 print:border-slate-300 pb-3 mb-2">
                <h3 className="text-sm font-bold uppercase tracking-wider text-cyan-400 print:text-slate-900 flex items-center gap-1.5">
                  Preparation Instructions
                  <InfoTooltip text="Click any step while cooking to highlight your current place in the recipe." />
                </h3>
                <span className="text-[11px] font-mono text-slate-400 no-print">
                  Click a step to highlight while cooking
                </span>
              </div>

              <ol className="space-y-3.5">
                {displayedSteps.map((step, idx) => {
                  const isFocused = activeStepIndex === idx;
                  return (
                    <li
                      key={step.id}
                      onClick={() => setActiveStepIndex(isFocused ? null : idx)}
                      title="Click to highlight this step as your current cooking stage"
                      className={`p-4 rounded-xl border transition-colors cursor-pointer print:p-4 print:bg-slate-50/60 print:border-slate-300 ${
                        isFocused
                          ? 'bg-cyan-500/10 border-cyan-400 text-white'
                          : 'bg-slate-950/60 border-slate-800/80 text-slate-200 hover:border-slate-700 print:text-slate-900'
                      }`}
                    >
                      <div className="flex items-start gap-3.5">
                        <span className="w-6 h-6 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 print:bg-slate-200 print:text-slate-900 print:border-slate-400 text-xs font-mono font-bold flex items-center justify-center shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <div className="space-y-2 flex-1">
                          {step.section && (
                            <div className="text-[11px] font-mono uppercase text-cyan-400 print:text-slate-700 font-semibold">
                              {step.section}
                            </div>
                          )}
                          <p className="text-sm leading-relaxed">{step.text}</p>
                          {photoMode === 'hero-and-steps' && step.imageUrl && (
                            <img
                              src={step.imageUrl}
                              alt={`Step ${idx + 1}`}
                              className="max-w-xs max-h-44 rounded-lg border border-slate-700 print:border-slate-300 mt-2 object-cover"
                            />
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>

              {/* Chef & Galley Notes */}
              {recipe.notes.length > 0 && (
                <div className="mt-6 p-5 rounded-xl bg-slate-950/80 border border-slate-800 print:bg-slate-50 print:border-slate-300">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-400 print:text-slate-900 mb-2.5">
                    Chef &amp; Galley Notes
                  </h4>
                  <ul className="list-disc pl-5 space-y-1.5 text-xs leading-relaxed text-slate-300 print:text-slate-800">
                    {recipe.notes.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* Permanent Bottom Attribution Footer */}
          <footer className="mt-8 pt-5 border-t border-slate-800 print:border-slate-300 flex flex-wrap items-center justify-between gap-3 text-[11px] leading-relaxed text-slate-400 print:text-slate-600">
            <div>
              Credit: <strong>{recipe.attribution.authorName}</strong> &bull;{' '}
              <strong>{recipe.attribution.siteName}</strong> (
              <a
                href={recipe.attribution.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 print:text-slate-900 underline"
              >
                {recipe.attribution.sourceUrl}
              </a>
              )
            </div>
            <div className="flex items-center gap-3">
              <span>
                Formatted with Ten Forward v1.3 (ten-forward.the-lal.net) &bull; Extracted{' '}
                {recipe.attribution.extractedAt}
              </span>
              <a
                href="https://buymeacoffee.com/curiouslyso"
                target="_blank"
                rel="noopener noreferrer"
                title="Support independent privacy-first browser utilities on Buy Me a Coffee"
                className="text-amber-300 hover:text-amber-200 font-medium transition-colors no-print"
              >
                ☕ Support the dev
              </a>
            </div>
          </footer>
        </article>
      </main>
    </div>
  );
}
