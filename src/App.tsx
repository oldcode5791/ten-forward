import { useState, useMemo, useEffect, useCallback, type ChangeEvent } from 'react';
import { InfoTooltip } from './components/InfoTooltip';
import { QrCodeBox } from './components/QrCodeBox';
import { STARFLEET_SAMPLE_RECIPES } from './data/starfleetRecipes';
import {
  compilePlainRecipeText,
  compileStandaloneRecipeHtml,
} from './utils/exportCompilers';
import {
  convertStepTemperatures,
  transformIngredientLine,
} from './utils/ingredientScaler';
import {
  buildImageSearchQuery,
  cleanCanonicalUrl,
  extractDomain,
  parseRawRecipeText,
} from './utils/recipeScraper';
import type { ImageSearchSource } from './utils/imageSearch';
import type {
  CandidateImage,
  ImageAttribution,
  PrintPhotoMode,
  RecipeData,
  SavedRecipeEntry,
  UnitSystem,
} from './utils/recipeTypes';

const STORAGE_KEY = 'the_lal_ten_forward_saved_v1';

export function App() {
  // Saved recipes in browser localStorage (loaded first so initial recipe defaults to latest saved)
  const [savedRecipes, setSavedRecipes] = useState<SavedRecipeEntry[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Active recipe state initialized to the most recently saved Galley Box recipe (or Guinan's preset if empty)
  const [recipe, setRecipe] = useState<RecipeData>(
    () => savedRecipes[0]?.recipe ?? STARFLEET_SAMPLE_RECIPES[0]
  );

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
  const [pasteImageMode, setPasteImageMode] = useState<'web-search' | 'upload' | 'none'>('web-search');
  const [pasteUploadedImage, setPasteUploadedImage] = useState('');
  const [pasteUploadedCaption, setPasteUploadedCaption] = useState('');
  const [pasteImageUrlInput, setPasteImageUrlInput] = useState('');
  const [pasteImageCredit, setPasteImageCredit] = useState('');

  // Web sample dish photo search state
  const [imageSearchQuery, setImageSearchQuery] = useState(() =>
    buildImageSearchQuery((savedRecipes[0]?.recipe ?? STARFLEET_SAMPLE_RECIPES[0]).title)
  );
  const [imageSearchSource, setImageSearchSource] = useState<ImageSearchSource>('wikimedia');
  const [isSearchingImages, setIsSearchingImages] = useState(false);

  // Interactive Scaling, Unit Conversion & Print Controls
  const [targetServings, setTargetServings] = useState<number>(
    () => (savedRecipes[0]?.recipe ?? STARFLEET_SAMPLE_RECIPES[0]).baseServings || 4
  );
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('original');
  const [photoMode, setPhotoMode] = useState<PrintPhotoMode>('hero-only');
  const [showQrCode, setShowQrCode] = useState<boolean>(true);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isEmbeddingPhoto, setIsEmbeddingPhoto] = useState<boolean>(false);
  const [showMobileTools, setShowMobileTools] = useState<boolean>(false);

  // Cook Mode state (checked ingredients, active step highlight, screen wake lock)
  const [checkedIngredients, setCheckedIngredients] = useState<Record<number, boolean>>({});
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);
  const [wakeLockActive, setWakeLockActive] = useState<boolean>(false);

  // Inline Kitchen & Chef Notes state (quick-add & click-to-edit right on the recipe card)
  const [newNoteInput, setNewNoteInput] = useState<string>('');
  const [editingNoteIndex, setEditingNoteIndex] = useState<number | null>(null);
  const [editingNoteText, setEditingNoteText] = useState<string>('');

  // Toast feedback & Post-Export Support Modal
  const [toast, setToast] = useState<string | null>(null);
  const [exportModalAction, setExportModalAction] = useState<string | null>(null);
  const [pulseSupportPill, setPulseSupportPill] = useState<boolean>(true);

  useEffect(() => {
    const timer = setTimeout(() => setPulseSupportPill(false), 4500);
    return () => clearTimeout(timer);
  }, []);

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
    setImageSearchQuery(buildImageSearchQuery(next.title));
    setCheckedIngredients({});
    setActiveStepIndex(null);
    setEditingNoteIndex(null);
    setEditingNoteText('');
    setExtractError(null);
  }, []);

  // Whether the currently displayed recipe is already saved in the user's Galley Box
  const isCurrentRecipeSaved = useMemo(
    () =>
      savedRecipes.some(
        (entry) => entry.recipe.id === recipe.id || entry.recipe.title === recipe.title
      ),
    [savedRecipes, recipe.id, recipe.title]
  );

  /**
   * Updates the active recipe and automatically syncs changes into the Galley Box (localStorage)
   * if this recipe is already saved in the user's collection.
   */
  const updateActiveRecipe = useCallback((updater: (prev: RecipeData) => RecipeData) => {
    setRecipe((prev) => {
      const next = updater(prev);
      setSavedRecipes((savedList) => {
        const matchIdx = savedList.findIndex(
          (item) => item.recipe.id === prev.id || item.recipe.title === prev.title
        );
        if (matchIdx === -1) return savedList;
        const updatedList = [...savedList];
        updatedList[matchIdx] = {
          ...updatedList[matchIdx],
          recipe: next,
        };
        return updatedList;
      });
      return next;
    });
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
   * Compresses a user-selected image file (from phone or PC) into a Data URI in browser RAM.
   */
  const compressImageFileToDataUri = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Invalid image file'));
        img.onload = () => {
          const maxW = 900;
          const scale = Math.min(1, maxW / img.width);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas unavailable'));
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.84));
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  /**
   * Queries /api/image-search for attributed sample dish photos and merges them into candidateImages.
   */
  const handleSearchWebImages = useCallback(
    async (
      overrideQuery?: string,
      overrideSource?: ImageSearchSource,
      targetRecipeId?: string
    ) => {
      const q = (overrideQuery ?? imageSearchQuery).trim();
      const source = overrideSource ?? imageSearchSource;
      if (!q) {
        showToast('Enter a dish name or keywords to search for sample photos.');
        return;
      }

      setIsSearchingImages(true);
      try {
        const res = await fetch(
          `/api/image-search?q=${encodeURIComponent(q)}&source=${encodeURIComponent(source)}`
        );
        const data = (await res.json()) as { images?: CandidateImage[]; error?: string };
        if (!res.ok || !Array.isArray(data.images)) {
          showToast(data.error || 'Could not fetch sample dish photos.');
          return;
        }
        const found = data.images;
        if (found.length === 0) {
          showToast(`No sample photos found for "${q}". Try shorter keywords or upload your own.`);
          return;
        }

        updateActiveRecipe((prev) => {
          if (targetRecipeId && prev.id !== targetRecipeId) return prev;
          const existingUrls = new Set(prev.candidateImages.map((c) => c.url));
          const fresh = found.filter((c) => !existingUrls.has(c.url));
          const merged = [...prev.candidateImages, ...fresh];
          const shouldSetHero = !prev.heroImage;
          return {
            ...prev,
            heroImage: shouldSetHero ? found[0].url : prev.heroImage,
            heroImageAttribution: shouldSetHero ? found[0].attribution : prev.heroImageAttribution,
            candidateImages: merged,
          };
        });
        showToast(`Found ${found.length} attributed sample photo(s) for "${q}".`);
      } catch {
        showToast('Offline or network unavailable — you can still upload a photo from your device.');
      } finally {
        setIsSearchingImages(false);
      }
    },
    [imageSearchQuery, imageSearchSource, showToast, updateActiveRecipe]
  );

  /**
   * Parses raw pasted recipe text or HTML 100% in browser RAM, with optional user upload or web sample photo search.
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

    if (pasteImageMode === 'upload') {
      const customUrl = pasteUploadedImage || pasteImageUrlInput.trim();
      if (customUrl) {
        const customAttr: ImageAttribution | undefined = pasteImageCredit.trim()
          ? {
              authorName: pasteImageCredit.trim(),
              provider: pasteUploadedImage ? 'User Upload' : 'Custom URL',
            }
          : pasteUploadedImage
            ? {
                authorName: 'Personal Photo',
                provider: 'User Upload',
              }
            : undefined;
        parsed.heroImage = customUrl;
        parsed.heroImageAttribution = customAttr;
        parsed.candidateImages = [
          {
            url: customUrl,
            caption: pasteUploadedCaption || parsed.title,
            source: 'custom',
            score: 110,
            attribution: customAttr,
          },
          ...parsed.candidateImages,
        ];
      }
    }

    loadRecipe(parsed);
    const query = buildImageSearchQuery(parsed.title);
    setImageSearchQuery(query);

    if (pasteImageMode === 'web-search' && !parsed.heroImage) {
      showToast(`Formatted "${parsed.title}" — searching for sample dish photos...`);
      void handleSearchWebImages(query, imageSearchSource, parsed.id);
    } else {
      showToast(`Parsed "${parsed.title}" into a clean Galley Card.`);
    }
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

      updateActiveRecipe((prev) => ({
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
   * Allows user to upload a custom dish photo from their phone or PC (compressed in RAM).
   */
  const handleCustomPhotoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageFileToDataUri(file);
      const customAttr: ImageAttribution = {
        authorName: 'Personal Photo',
        provider: 'User Upload',
      };
      updateActiveRecipe((prev) => ({
        ...prev,
        heroImage: dataUrl,
        heroImageAttribution: customAttr,
        candidateImages: [
          {
            url: dataUrl,
            caption: file.name,
            source: 'custom',
            score: 110,
            attribution: customAttr,
          },
          ...prev.candidateImages,
        ],
      }));
      showToast('Added custom dish photo from your device.');
    } catch {
      showToast('Could not process that image file.');
    }
  };

  /**
   * Handles uploading a photo directly inside the Paste Text tab before formatting.
   */
  const handlePasteTabPhotoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageFileToDataUri(file);
      setPasteUploadedImage(dataUrl);
      setPasteUploadedCaption(file.name);
      setPasteImageMode('upload');
      showToast(`Attached "${file.name}" for your pasted recipe.`);
    } catch {
      showToast('Could not read that image file.');
    }
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

  // Compute scaled & unit-converted ingredients, steps, and notes
  const scaleFactor = useMemo(
    () => targetServings / Math.max(1, recipe.baseServings),
    [targetServings, recipe.baseServings]
  );

  const displayedIngredients = useMemo(
    () =>
      recipe.ingredients
        .filter((line) => line.trim().length > 0)
        .map((line) => transformIngredientLine(line, scaleFactor, unitSystem)),
    [recipe.ingredients, scaleFactor, unitSystem]
  );

  const displayedSteps = useMemo(
    () =>
      recipe.steps
        .filter((step) => step.text.trim().length > 0)
        .map((step) => ({
          ...step,
          text: convertStepTemperatures(step.text, unitSystem),
        })),
    [recipe.steps, unitSystem]
  );

  const displayedNotes = useMemo(
    () => recipe.notes.filter((note) => note.trim().length > 0),
    [recipe.notes]
  );

  // Inline Kitchen & Chef Notes Handlers
  const handleAddNote = () => {
    const trimmed = newNoteInput.trim();
    if (!trimmed) return;
    updateActiveRecipe((prev) => ({
      ...prev,
      notes: [...prev.notes.filter((n) => n.trim().length > 0), trimmed],
    }));
    setNewNoteInput('');
    showToast(
      isCurrentRecipeSaved
        ? 'Added kitchen note (auto-saved in your Galley Box)!'
        : 'Added kitchen note to recipe card!'
    );
  };

  const handleStartEditNote = (index: number, currentText: string) => {
    setEditingNoteIndex(index);
    setEditingNoteText(currentText);
  };

  const handleSaveEditedNote = (index: number) => {
    const trimmed = editingNoteText.trim();
    updateActiveRecipe((prev) => {
      const clean = prev.notes.filter((n) => n.trim().length > 0);
      if (!trimmed) {
        return { ...prev, notes: clean.filter((_, i) => i !== index) };
      }
      return {
        ...prev,
        notes: clean.map((n, i) => (i === index ? trimmed : n)),
      };
    });
    setEditingNoteIndex(null);
    setEditingNoteText('');
    showToast(
      isCurrentRecipeSaved
        ? 'Updated kitchen note (auto-saved in your Galley Box)!'
        : 'Updated kitchen note!'
    );
  };

  const handleDeleteNote = (index: number) => {
    updateActiveRecipe((prev) => ({
      ...prev,
      notes: prev.notes.filter((n) => n.trim().length > 0).filter((_, i) => i !== index),
    }));
    if (editingNoteIndex === index) {
      setEditingNoteIndex(null);
      setEditingNoteText('');
    }
    showToast('Removed kitchen note.');
  };

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

  const handleCopyRecipeText = async () => {
    const plain = compilePlainRecipeText(recipe, targetServings, unitSystem);
    await navigator.clipboard.writeText(plain);
    showToast('Copied recipe text (with creator credit & source link) to clipboard!');
  };

  /**
   * Opens the device's native Share Sheet (iMessage, WhatsApp, AirDrop, Email) on phones/tablets,
   * or falls back to copying the formatted recipe text & link to the clipboard on desktop.
   */
  const handleShareRecipe = async () => {
    const plain = compilePlainRecipeText(recipe, targetServings, unitSystem);
    const isExternalSource =
      /^https?:\/\//i.test(recipe.attribution.sourceUrl) &&
      !recipe.attribution.sourceUrl.includes('ten-forward.the-lal.net');
    const shareCardUrl = isExternalSource
      ? `https://ten-forward.the-lal.net/?url=${encodeURIComponent(recipe.attribution.sourceUrl)}`
      : 'https://ten-forward.the-lal.net';

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `${recipe.title} — Recipe by ${recipe.attribution.authorName}`,
          text: plain,
          url: shareCardUrl,
        });
        showToast('Opened device Share sheet!');
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
      }
    }

    await navigator.clipboard.writeText(`${plain}\n\nOpen in Ten Forward: ${shareCardUrl}`);
    showToast('Copied recipe text & shareable link to clipboard!');
  };

  const handleSaveToGalleyBox = () => {
    const today = new Date().toISOString().slice(0, 10);
    const cleanRecipe: RecipeData = {
      ...recipe,
      ingredients: recipe.ingredients.filter((l) => l.trim().length > 0),
      steps: recipe.steps.filter((s) => s.text.trim().length > 0),
      notes: recipe.notes.filter((n) => n.trim().length > 0),
    };

    setSavedRecipes((prev) => {
      const existingIdx = prev.findIndex(
        (item) =>
          item.recipe.id === cleanRecipe.id || item.recipe.title === cleanRecipe.title
      );
      if (existingIdx !== -1) {
        const updatedEntry: SavedRecipeEntry = {
          ...prev[existingIdx],
          savedAt: today,
          recipe: cleanRecipe,
        };
        const rest = prev.filter((_, i) => i !== existingIdx);
        return [updatedEntry, ...rest];
      }
      const newEntry: SavedRecipeEntry = {
        id: `${cleanRecipe.id}-${Date.now()}`,
        savedAt: today,
        recipe: cleanRecipe,
      };
      return [newEntry, ...prev];
    });

    loadRecipe(cleanRecipe);
    setInputTab('saved');
    showToast(
      isCurrentRecipeSaved
        ? `Updated "${cleanRecipe.title}" in your Galley Box!`
        : `Saved "${cleanRecipe.title}" into your Galley Box (and set as active recipe below)!`
    );
  };

  const handleDeleteSaved = (id: string) => {
    setSavedRecipes((prev) => {
      const next = prev.filter((item) => item.id !== id);
      if (next.length > 0 && recipe.title === prev.find((p) => p.id === id)?.recipe.title) {
        loadRecipe(next[0].recipe);
      }
      return next;
    });
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
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30 no-print">
        <div className="max-w-7xl mx-auto px-3.5 sm:px-6 py-2.5 sm:py-3.5 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-mono font-bold text-xs sm:text-sm shrink-0"
              title="Ten Forward — Deck 10, Forward Section 1"
            >
              10F
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-white flex flex-wrap items-center gap-1.5 sm:gap-2">
                <span>Ten Forward</span>
                <span
                  className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-cyan-950 border border-cyan-500/30 text-cyan-400"
                  title="Ten Forward Application Version 1.10.1"
                >
                  v1.10.1
                </span>
                <span className="hidden lg:inline-flex items-center gap-1 text-[11px] font-mono uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  Creator Attribution + Zero Tracking
                  <InfoTooltip
                    position="bottom"
                    text="Stateless edge extraction strips ads and popups while permanently preserving the original chef/author name, site name, clickable link, and printable QR code."
                  />
                </span>
              </h1>
              <p className="text-[11px] sm:text-xs text-cyan-300/90 sm:text-slate-300 font-medium truncate">
                Recipe Extractor &amp; Printable Galley Card
                <span className="hidden md:inline text-slate-400 font-normal">
                  {' '}
                  &bull; Dish Photo Scraper, Portion Scaler &amp; Offline Print/PDF
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 text-xs shrink-0">
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => setInputTab((prev) => (prev === 'saved' ? 'url' : 'saved'))}
                title={
                  inputTab === 'saved'
                    ? 'Close Galley Box and return to URL extractor'
                    : 'Galley Box is your personal Recipe Box saved privately inside this browser. Click to view your saved recipes.'
                }
                className={`inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-xl border font-medium transition-colors cursor-pointer ${
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
                <span>{inputTab === 'saved' ? 'Close Box ✕' : 'Galley Box'}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-slate-950/90 text-cyan-300 border border-slate-700">
                  {savedRecipes.length}
                </span>
              </button>
              <span className="hidden sm:inline-flex">
                <InfoTooltip
                  position="bottom"
                  text="Galley Box is your personal Recipe Box stored privately inside your browser (localStorage). Click to open or close your saved recipe collection."
                />
              </span>
            </div>
            <a
              href="https://apps.the-lal.net"
              title="Return to the full the-lal.net browser utility directory"
              className="text-slate-400 hover:text-cyan-400 transition-colors hidden sm:inline"
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
        className={`fixed bottom-4 right-4 sm:bottom-5 sm:right-5 z-30 inline-flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-2.5 rounded-2xl bg-slate-900/95 hover:bg-slate-800 text-amber-300 font-medium text-xs sm:text-sm border border-amber-500/40 hover:border-amber-400 shadow-xl backdrop-blur transition-all duration-300 hover:scale-105 no-print ${
          pulseSupportPill ? 'animate-pulse ring-2 ring-amber-400/50 border-amber-400' : ''
        }`}
      >
        <span className="text-base sm:text-lg leading-none">☕</span>
        <span>Support the dev</span>
      </a>

      {/* Main Content Container */}
      <main className="max-w-7xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 print:px-0 print:py-0 flex-1 space-y-4 sm:space-y-6">
        {/* 1. Extraction & Source Input Deck (Hidden in Print) */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 sm:p-5 shadow-xl no-print">
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-800 pb-3 mb-3.5">
            {/* Responsive 2x2 Grid on Phone, Inline Pills on Tablet/Desktop */}
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full sm:w-auto">
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setInputTab('url')}
                  title="Extract a recipe, dish photos, and creator attribution from any public URL"
                  className={`w-full sm:w-auto px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer text-center ${
                    inputTab === 'url'
                      ? 'bg-cyan-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  🔗 <span className="sm:hidden">Extract URL</span>
                  <span className="hidden sm:inline">1. Scrape Recipe URL</span>
                </button>
                <span className="hidden sm:inline-flex">
                  <InfoTooltip text="Paste any link from a recipe blog or cooking site to strip out ads and life stories while keeping dish photos and creator credit." />
                </span>
              </div>

              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setInputTab('paste')}
                  title="Paste copied recipe text or raw HTML directly (works 100% offline with zero network calls)"
                  className={`w-full sm:w-auto px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer text-center ${
                    inputTab === 'paste'
                      ? 'bg-cyan-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  📋 <span className="sm:hidden">Paste Text</span>
                  <span className="hidden sm:inline">2. Paste Text / HTML</span>
                </button>
                <span className="hidden sm:inline-flex">
                  <InfoTooltip text="Copy and paste text from an email, document, or paywalled webpage to format it into a clean Galley Card 100% offline." />
                </span>
              </div>

              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setInputTab('presets')}
                  title="Load Star Trek: The Next Generation sample recipes from Ten Forward"
                  className={`w-full sm:w-auto px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer text-center ${
                    inputTab === 'presets'
                      ? 'bg-cyan-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  🖖 <span className="sm:hidden">Samples</span>
                  <span className="hidden sm:inline">3. Starfleet Samples</span>
                </button>
                <span className="hidden sm:inline-flex">
                  <InfoTooltip text="Try Ten Forward immediately with sample recipes from Guinan, Captain Picard, and Commander Riker." />
                </span>
              </div>

              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setInputTab((prev) => (prev === 'saved' ? 'url' : 'saved'))}
                  title="Galley Box: Click to open or close your personal collection of recipes saved inside this browser"
                  className={`w-full sm:w-auto px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer text-center ${
                    inputTab === 'saved'
                      ? 'bg-cyan-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  🗃️ <span className="sm:hidden">Galley Box ({savedRecipes.length})</span>
                  <span className="hidden sm:inline">
                    4. Galley Box • Saved ({savedRecipes.length})
                  </span>
                </button>
                <span className="hidden sm:inline-flex">
                  <InfoTooltip text="Think of the Galley Box as the recipe tin on your kitchen counter. Any recipe you save here stays in your browser's local storage so you can reopen or print it anytime." />
                </span>
              </div>
            </div>

            <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-400">
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

              {/* Dish Photo Option for Pasted Recipe */}
              <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase text-slate-400 flex items-center gap-1.5">
                    Dish Photo Source
                    <InfoTooltip text="Choose how to add a photo to your pasted recipe: auto-fetch attributed sample photos from the web, upload your own photo from your phone or PC, or keep it text-only." />
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(
                      [
                        { id: 'web-search', label: '🌐 Auto-Fetch Web Samples', tip: 'Automatically search for attributed sample dish photos based on your recipe title' },
                        { id: 'upload', label: '📷 Upload Phone / PC Photo', tip: 'Attach a photo from your phone gallery, camera, or computer' },
                        { id: 'none', label: '🚫 No Photo', tip: 'Create a clean text-only Galley Card' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setPasteImageMode(opt.id)}
                        title={opt.tip}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                          pasteImageMode === opt.id
                            ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {pasteImageMode === 'web-search' && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 pt-1 border-t border-slate-800/70">
                    <span>
                      Will fetch attributed sample photos matching your recipe title (you can refine keywords or swap sources after formatting).
                    </span>
                    <div className="inline-flex items-center gap-1.5 shrink-0">
                      <span className="text-[11px] uppercase font-semibold text-slate-400">Source:</span>
                      <select
                        value={imageSearchSource}
                        onChange={(e) => setImageSearchSource(e.target.value as ImageSearchSource)}
                        title="Choose which public image source to search by default"
                        className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-400"
                      >
                        <option value="wikimedia">Wikimedia Commons (Default)</option>
                        <option value="openverse">Openverse (Creative Commons)</option>
                        <option value="all">Both (Wikimedia + Openverse)</option>
                      </select>
                    </div>
                  </div>
                )}

                {pasteImageMode === 'upload' && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-slate-800/70 items-center">
                    <div className="flex items-center gap-2">
                      <label
                        title="Choose a dish photo from your phone or computer (compressed locally in browser RAM)"
                        className="px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 text-xs font-semibold cursor-pointer shrink-0"
                      >
                        📷 Choose File
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => void handlePasteTabPhotoUpload(e)}
                          className="hidden"
                        />
                      </label>
                      {pasteUploadedImage && (
                        <div className="flex items-center gap-2 min-w-0">
                          <img
                            src={pasteUploadedImage}
                            alt="Uploaded preview"
                            className="w-10 h-10 rounded-lg object-cover border border-cyan-400/60 shrink-0"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setPasteUploadedImage('');
                              setPasteUploadedCaption('');
                            }}
                            title="Remove uploaded photo"
                            className="text-[11px] text-slate-400 hover:text-red-300 cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                    <input
                      type="url"
                      value={pasteImageUrlInput}
                      onChange={(e) => setPasteImageUrlInput(e.target.value)}
                      placeholder="Or paste direct image URL (https://...)"
                      title="Optional direct image URL if not uploading a file"
                      className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-100"
                    />
                    <input
                      type="text"
                      value={pasteImageCredit}
                      onChange={(e) => setPasteImageCredit(e.target.value)}
                      placeholder="Photo credit (optional, e.g. My kitchen)"
                      title="Optional photographer or credit note for your custom photo"
                      className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-100"
                    />
                  </div>
                )}
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
                    title={
                      isCurrentRecipeSaved
                        ? `Update "${recipe.title}" in your Galley Box`
                        : `Save the currently open recipe ("${recipe.title}") into your Galley Box`
                    }
                    className={`px-3.5 py-2 rounded-xl font-bold text-xs transition-colors cursor-pointer ${
                      isCurrentRecipeSaved
                        ? 'bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300'
                        : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
                    }`}
                  >
                    {isCurrentRecipeSaved ? '✓ Saved in Galley Box' : '+ Save Current Recipe'}
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
                  <button
                    type="button"
                    onClick={() => setInputTab('url')}
                    title="Close the Galley Box drawer and return to the URL extractor bar"
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 hover:text-white text-xs font-semibold cursor-pointer"
                  >
                    ✕ Close Galley Box
                  </button>
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
                  {savedRecipes.map((entry) => {
                    const isDisplayedBelow = recipe.title === entry.recipe.title;
                    return (
                      <div
                        key={entry.id}
                        className={`p-3.5 rounded-xl bg-slate-950 border flex flex-col justify-between gap-3 transition-colors ${
                          isDisplayedBelow
                            ? 'border-cyan-400 ring-1 ring-cyan-400/30'
                            : 'border-slate-800 hover:border-slate-700'
                        }`}
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
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[10px] font-mono text-cyan-400 truncate">
                                By {entry.recipe.attribution.authorName} &bull; {entry.recipe.attribution.siteName}
                              </span>
                              {isDisplayedBelow && (
                                <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">
                                  Active Below
                                </span>
                              )}
                            </div>
                            <div className="font-bold text-sm text-white mt-0.5 line-clamp-2">
                              {entry.recipe.title}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-1">
                              Saved {entry.savedAt} &bull; {entry.recipe.ingredients.length} ingredients
                              {entry.recipe.notes && entry.recipe.notes.length > 0
                                ? ` • 📝 ${entry.recipe.notes.length} note${entry.recipe.notes.length === 1 ? '' : 's'}`
                                : ''}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                          <button
                            type="button"
                            onClick={() => {
                              loadRecipe(entry.recipe);
                              setInputTab('url');
                              showToast(`Loaded "${entry.recipe.title}" below and closed Galley Box.`);
                            }}
                            title="Display this saved recipe card below and close the Galley Box drawer"
                            className="flex-1 px-2.5 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 text-xs font-semibold cursor-pointer"
                          >
                            {isDisplayedBelow ? 'Viewing Below (Close Box)' : 'Open Recipe Card'}
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
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        {/* 2. Interactive Galley Control Toolbar (Compact on Phone, Full on Tablet/Desktop) */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 sm:p-4 shadow-xl space-y-3 sm:space-y-4 no-print">
          {/* Primary Row: Portions, Units, and Essential Actions on Mobile */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-4">
            {/* Portion Multiplier & Servings */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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
                  className="px-2 sm:px-2.5 text-xs font-mono font-bold text-cyan-300"
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

              <div className="hidden sm:inline-flex items-center gap-1">
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
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 hidden sm:flex items-center gap-1">
                Units:
                <InfoTooltip text="Convert weights, volumes, and oven temperatures (°F <-> °C) between Original, Metric (grams/ml/°C), and US Imperial (oz/cups/°F)." />
              </span>
              <div className="inline-flex rounded-xl bg-slate-950 border border-slate-800 p-1 gap-1">
                {(
                  [
                    { id: 'original', shortLabel: 'Orig', fullLabel: 'Original' },
                    { id: 'metric', shortLabel: 'Metric', fullLabel: 'Metric (g/ml/°C)' },
                    { id: 'imperial', shortLabel: 'Imperial', fullLabel: 'Imperial (oz/°F)' },
                  ] as const
                ).map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setUnitSystem(u.id)}
                    title={`Display measurements in ${u.fullLabel}`}
                    className={`px-2 sm:px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      unitSystem === u.id
                        ? 'bg-cyan-500 text-slate-950'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span className="sm:hidden">{u.shortLabel}</span>
                    <span className="hidden sm:inline">{u.fullLabel}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Photo & QR Print Options (Visible on md+ desktop, or inside More Tools on phone) */}
            <div className="hidden md:flex flex-wrap items-center gap-2">
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

          {/* Mobile Quick Action Bar (Phone screens only < md) */}
          <div className="flex md:hidden items-center justify-between gap-2 pt-2.5 border-t border-slate-800">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleSaveToGalleyBox}
                title={
                  isCurrentRecipeSaved
                    ? 'Already saved in your Galley Box (tap to view or update)'
                    : "Save this recipe inside your browser's Galley Box"
                }
                className={`px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer ${
                  isCurrentRecipeSaved
                    ? 'bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-100'
                }`}
              >
                {isCurrentRecipeSaved ? '✓ Saved' : '🗃️ Save'}
              </button>
              <button
                type="button"
                onClick={() => void handleShareRecipe()}
                title="Share this recipe via iMessage, WhatsApp, AirDrop, Email, or copy link"
                className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-semibold cursor-pointer"
              >
                📤 Share
              </button>
              <button
                type="button"
                onClick={handlePrintCard}
                title="Print or Save as PDF"
                className="px-3 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs cursor-pointer"
              >
                🖨️ Print / PDF
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowMobileTools((v) => !v)}
              title="Show or hide photo controls, recipe editor, screen wake lock, and offline HTML export"
              className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                showMobileTools
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                  : 'bg-slate-950 border-slate-800 text-slate-300'
              }`}
            >
              {showMobileTools ? 'Less ▴' : '⚙️ More Tools ▾'}
            </button>
          </div>

          {/* Secondary Action Bar & Photo Strip (Always visible on md+ Desktop/Tablet, Collapsible on Phone) */}
          <div className={`${showMobileTools ? 'block' : 'hidden'} md:block space-y-3 pt-2.5 md:pt-3 border-t border-slate-800`}>
            {/* Mobile-only Photo Mode selector when expanded */}
            <div className="flex md:hidden flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/70">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-semibold">Photos:</span>
                <select
                  value={photoMode}
                  onChange={(e) => setPhotoMode(e.target.value as PrintPhotoMode)}
                  title="Select photo display mode"
                  className="rounded-xl bg-slate-950 border border-slate-800 px-2.5 py-1 text-xs text-slate-200"
                >
                  <option value="hero-only">Dish Cover Photo Only</option>
                  <option value="hero-and-steps">Dish + Step Photos</option>
                  <option value="no-photos">No Photos (Ink Saver)</option>
                </select>
              </div>
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={showQrCode}
                  onChange={(e) => setShowQrCode(e.target.checked)}
                  className="accent-cyan-400"
                />
                <span>Print QR Code</span>
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
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
                  {isEditing ? 'Done Editing' : '✏️ Edit Recipe & Attribution'}
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
                  {wakeLockActive ? '🔆 Screen Awake' : '🔆 Keep Screen Awake'}
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
                <div className="hidden md:inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleSaveToGalleyBox}
                    title={
                      isCurrentRecipeSaved
                        ? 'This recipe is saved in your Galley Box (any edits or notes auto-save). Click to view in Galley Box.'
                        : "Bookmark this recipe inside your browser's personal Galley Box (Saved Recipes) for instant offline access later"
                    }
                    className={`px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer ${
                      isCurrentRecipeSaved
                        ? 'bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-500/40 text-emerald-300'
                        : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                    }`}
                  >
                    {isCurrentRecipeSaved ? '✓ Saved in Galley Box' : '🗃️ Save to Galley Box'}
                  </button>
                  <InfoTooltip text="Saves a copy of this recipe (and your personal kitchen notes) inside your browser's Galley Box (Tab 4) so you can reopen it anytime without re-scraping the website." />
                </div>

                <div className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleCopyRecipeText}
                    title="Copy clean, readable recipe text to paste into an email, message, or notes app"
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                  >
                    📋 Copy Text
                  </button>
                  <InfoTooltip text="Copies the clean recipe text (including scaled ingredients, steps, notes, and original source link) so you can paste it into an email, text message, or notes app." />
                </div>

                <div className="hidden md:inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void handleShareRecipe()}
                    title="Share this recipe via your device's native Share sheet (iMessage, WhatsApp, AirDrop, Email) or copy shareable link"
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                  >
                    📤 Share
                  </button>
                  <InfoTooltip text="Opens your phone, tablet, or computer's native Share sheet to send the clean recipe text and link via WhatsApp, iMessage, AirDrop, or Email." />
                </div>

                <div className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleDownloadStandaloneHtml}
                    title="Download a self-contained, printable .html recipe card with embedded QR code and attribution"
                    className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-cyan-500/40 text-cyan-300 text-xs font-semibold cursor-pointer"
                  >
                    💾 Save Offline Card
                  </button>
                  <InfoTooltip text="Downloads a standalone .html file containing the styled recipe card, attribution link, and QR code that opens in any browser even without internet." />
                </div>

                <div className="hidden md:inline-flex items-center gap-1">
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

            {/* Candidate Dish Photo Picker Strip + Web Sample Search + Custom Upload */}
            {photoMode !== 'no-photos' && (
              <div className="pt-3 border-t border-slate-800/80 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 py-1">
                    <span className="text-[11px] font-semibold uppercase text-slate-400 flex items-center gap-1 shrink-0">
                      Dish Photos ({recipe.candidateImages.length}):
                      <InfoTooltip text="Click any candidate photo to set it as the cover image, search the web for attributed sample photos, or upload your own photo from your phone or PC." />
                    </span>
                    {recipe.candidateImages.map((img, i) => {
                      const selected = recipe.heroImage === img.url;
                      const attrTip = img.attribution
                        ? `Photo by ${img.attribution.authorName}${img.attribution.license ? ` (${img.attribution.license})` : ''} via ${img.attribution.provider}`
                        : `Select photo #${i + 1} (${img.source})`;
                      return (
                        <button
                          key={`${img.url}-${i}`}
                          type="button"
                          onClick={() =>
                            updateActiveRecipe((prev) => ({
                              ...prev,
                              heroImage: img.url,
                              heroImageAttribution: img.attribution,
                            }))
                          }
                          title={attrTip}
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
                    className="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-cyan-500/40 text-xs font-semibold text-cyan-300 cursor-pointer shrink-0"
                    title="Upload a dish photo from your phone gallery, camera, or PC (compressed locally in browser RAM)"
                  >
                    📷 Upload Phone / PC Photo
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => void handleCustomPhotoUpload(e)}
                      className="hidden"
                    />
                  </label>
                </div>

                {/* Editable Web Sample Photo Search Bar */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
                  <span className="text-[11px] font-semibold uppercase text-slate-400 flex items-center gap-1 shrink-0">
                    Web Samples:
                    <InfoTooltip text="Search Wikimedia Commons or Openverse for permissive-license dish photos with automatic photographer & license attribution." />
                  </span>
                  <input
                    type="text"
                    value={imageSearchQuery}
                    onChange={(e) => setImageSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleSearchWebImages();
                      }
                    }}
                    placeholder="Dish keywords (e.g., garlic butter salmon)"
                    title="Edit search keywords to find better sample dish photos"
                    className="flex-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-400"
                  />
                  <select
                    value={imageSearchSource}
                    onChange={(e) => setImageSearchSource(e.target.value as ImageSearchSource)}
                    title="Select public image source"
                    className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-400"
                  >
                    <option value="wikimedia">Wikimedia Commons</option>
                    <option value="openverse">Openverse (CC)</option>
                    <option value="all">Both Sources</option>
                  </select>
                  <button
                    type="button"
                    disabled={isSearchingImages}
                    onClick={() => void handleSearchWebImages()}
                    title="Fetch attributed sample dish photos from the selected web source"
                    className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-700 text-cyan-300 text-xs font-semibold cursor-pointer shrink-0"
                  >
                    {isSearchingImages ? 'Searching...' : '🔍 Find Sample Photos'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 3. Optional Inline Recipe & Attribution Editor Drawer */}
        {isEditing && (
          <section className="bg-slate-900 border border-cyan-500/40 rounded-2xl p-5 shadow-xl space-y-4 no-print">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h2 className="text-sm font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-2">
                Edit Recipe, Attribution &amp; Notes
                <InfoTooltip text="Customize any detail, fix a scraped ingredient line, or edit your personal kitchen notes before printing or saving." />
              </h2>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                title="Close editor panel"
                className="text-xs text-slate-400 hover:text-white cursor-pointer"
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
                  onChange={(e) => updateActiveRecipe((p) => ({ ...p, title: e.target.value }))}
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
                    updateActiveRecipe((p) => ({
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
                    updateActiveRecipe((p) => ({
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
                    updateActiveRecipe((p) => ({
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
                  onChange={(e) => updateActiveRecipe((p) => ({ ...p, prepTime: e.target.value }))}
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
                  onChange={(e) => updateActiveRecipe((p) => ({ ...p, cookTime: e.target.value }))}
                  title="Edit cook time"
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-white"
                />
              </div>
              {recipe.heroImage && (
                <div className="sm:col-span-2">
                  <label className="block text-[11px] uppercase text-slate-400 font-semibold mb-1">
                    Dish Photo Credit (Optional)
                  </label>
                  <input
                    type="text"
                    value={recipe.heroImageAttribution?.authorName || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateActiveRecipe((p) => ({
                        ...p,
                        heroImageAttribution: val
                          ? {
                              ...(p.heroImageAttribution || { provider: 'Custom Credit' }),
                              authorName: val,
                            }
                          : undefined,
                      }));
                    }}
                    placeholder="e.g., Wikimedia Commons / Personal Photo"
                    title="Edit or clear the photographer credit shown under the dish photo"
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-white"
                  />
                </div>
              )}
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
                    updateActiveRecipe((p) => ({
                      ...p,
                      ingredients: e.target.value.split('\n'),
                    }))
                  }
                  onBlur={() =>
                    updateActiveRecipe((p) => ({
                      ...p,
                      ingredients: p.ingredients.filter((l) => l.trim().length > 0),
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
                    updateActiveRecipe((p) => ({
                      ...p,
                      steps: e.target.value.split('\n').map((text, idx) => ({
                        id: `step-${idx + 1}`,
                        text,
                      })),
                    }))
                  }
                  onBlur={() =>
                    updateActiveRecipe((p) => ({
                      ...p,
                      steps: p.steps
                        .filter((s) => s.text.trim().length > 0)
                        .map((s, idx) => ({ ...s, id: `step-${idx + 1}` })),
                    }))
                  }
                  title="Edit instruction steps (one step per line)"
                  className="w-full rounded-xl bg-slate-950 border border-slate-700 p-3 text-xs text-white font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] uppercase text-slate-400 font-semibold mb-1">
                Kitchen &amp; Chef Notes (One note per line — or add/edit directly on the card below)
              </label>
              <textarea
                rows={3}
                value={recipe.notes.join('\n')}
                onChange={(e) =>
                  updateActiveRecipe((p) => ({
                    ...p,
                    notes: e.target.value.split('\n'),
                  }))
                }
                onBlur={() =>
                  updateActiveRecipe((p) => ({
                    ...p,
                    notes: p.notes.filter((n) => n.trim().length > 0),
                  }))
                }
                placeholder={`Bake 5 minutes less in a convection oven.\nAdd extra garlic or smoked paprika.`}
                title="Edit kitchen and chef notes (one note per line)"
                className="w-full rounded-xl bg-slate-950 border border-slate-700 p-3 text-xs text-white font-mono"
              />
            </div>
          </section>
        )}

        {/* 4. Printable / Saveable Galley Recipe Card */}
        <article className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-8 shadow-2xl print-card">
          {/* Card Header + Mandatory Creator Attribution Banner + QR Code */}
          <div className="flex flex-col sm:flex-row items-start justify-between gap-4 sm:gap-6 pb-5 sm:pb-6 mb-5 sm:mb-6 border-b border-slate-800 print:border-slate-300">
            <div className="space-y-2.5 sm:space-y-3 flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-mono uppercase tracking-wider px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 print:bg-slate-100 print:text-slate-800 print:border-slate-400">
                  {recipe.category || 'Galley Recipe'}
                </span>
                {recipe.cuisine && (
                  <span className="text-[11px] font-mono text-slate-400 print:text-slate-600">
                    &bull; {recipe.cuisine}
                  </span>
                )}
              </div>

              <h2 className="text-xl sm:text-3xl font-extrabold tracking-tight text-white print:text-slate-950 leading-snug">
                {recipe.title}
              </h2>

              {recipe.description && (
                <p className="text-xs sm:text-sm text-slate-300 print:text-slate-700 leading-relaxed max-w-3xl">
                  {recipe.description}
                </p>
              )}

              {/* Prominent Creator Attribution Banner (Never hidden in print or screen) */}
              <div className="mt-3 sm:mt-4 p-3.5 sm:px-5 sm:py-4 rounded-xl bg-slate-950/90 border-l-4 border-cyan-400 border border-slate-800 print:bg-slate-50 print:border-slate-300 print:border-l-4 print:border-l-cyan-600">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs leading-relaxed">
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
                <div className="mt-1 text-xs text-slate-400 print:text-slate-700 break-all leading-relaxed">
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

            {/* Scannable QR Code for Print & Tablet/Desktop Cross-Device Handoff (Hidden on small phone screen where user is already on mobile, always shown in print) */}
            {showQrCode && (
              <div className="hidden sm:block print:block shrink-0">
                <QrCodeBox
                  url={recipe.attribution.sourceUrl}
                  domain={recipe.attribution.domain}
                  size={88}
                />
              </div>
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

          {/* Hero Dish Photo + Attribution */}
          {photoMode !== 'no-photos' && recipe.heroImage && (
            <figure className="mb-7 space-y-1.5">
              <div className="rounded-xl overflow-hidden border border-slate-800 print:border-slate-300 bg-slate-950">
                <img
                  src={recipe.heroImage}
                  alt={recipe.title}
                  className="w-full max-h-80 object-cover"
                />
              </div>
              {recipe.heroImageAttribution && (
                <figcaption className="text-[11px] text-slate-400 print:text-slate-600 flex flex-wrap items-center gap-x-1.5 px-1">
                  <span>
                    Photo by{' '}
                    {recipe.heroImageAttribution.authorUrl ? (
                      <a
                        href={recipe.heroImageAttribution.authorUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 print:text-slate-900 underline"
                      >
                        {recipe.heroImageAttribution.authorName}
                      </a>
                    ) : (
                      <strong className="text-slate-300 print:text-slate-800">
                        {recipe.heroImageAttribution.authorName}
                      </strong>
                    )}
                  </span>
                  {recipe.heroImageAttribution.license && (
                    <span>&bull; {recipe.heroImageAttribution.license}</span>
                  )}
                  <span>
                    via{' '}
                    {recipe.heroImageAttribution.sourcePageUrl ? (
                      <a
                        href={recipe.heroImageAttribution.sourcePageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 print:text-slate-900 underline"
                      >
                        {recipe.heroImageAttribution.provider}
                      </a>
                    ) : (
                      recipe.heroImageAttribution.provider
                    )}
                  </span>
                </figcaption>
              )}
            </figure>
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
              <p className="pt-2 text-[11px] leading-relaxed text-slate-400 print:text-slate-600 italic">
                ⚠️ Please double-check all measurements — automated extraction, scaling, and unit conversions may occasionally make mistakes.
              </p>
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

              {/* Interactive Kitchen & Chef Notes (Always accessible on screen; hidden in print only when empty) */}
              <div
                className={`mt-6 p-4 sm:p-5 rounded-xl bg-slate-950/80 border border-slate-800 print:bg-slate-50 print:border-slate-300 space-y-3 ${
                  displayedNotes.length === 0 ? 'no-print' : ''
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-400 print:text-slate-900 flex items-center gap-1.5">
                    <span>📝 Kitchen &amp; Chef Notes</span>
                    <InfoTooltip text="Jot down your own cooking tweaks, substitutions, oven times, or family ratings. Click any note to edit it inline. If this recipe is saved in your Galley Box, changes auto-save automatically!" />
                  </h4>

                  <div className="flex items-center gap-2 no-print">
                    {isCurrentRecipeSaved ? (
                      <span
                        className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
                        title="This recipe is saved in your Galley Box — any notes you add or edit are saved automatically"
                      >
                        ✓ Auto-saved in Galley Box
                      </span>
                    ) : (
                      displayedNotes.length > 0 && (
                        <button
                          type="button"
                          onClick={handleSaveToGalleyBox}
                          title="Save this recipe and your notes into your browser's Galley Box"
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 transition-colors cursor-pointer"
                        >
                          🗃️ Save with Notes to Galley Box
                        </button>
                      )
                    )}
                  </div>
                </div>

                {/* Existing Notes List (Click to Edit Inline on Screen, Clean Bullets in Print) */}
                {displayedNotes.length > 0 ? (
                  <ul className="space-y-2 text-xs sm:text-sm leading-relaxed text-slate-200 print:text-slate-800 print:list-disc print:pl-5 print:space-y-1.5">
                    {displayedNotes.map((note, i) => {
                      const isEditingThisNote = editingNoteIndex === i;
                      return (
                        <li
                          key={i}
                          className="group rounded-lg bg-slate-900/80 border border-slate-800/90 hover:border-slate-700 p-2.5 sm:px-3 sm:py-2 transition-colors print:bg-transparent print:border-none print:p-0"
                        >
                          {isEditingThisNote ? (
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 no-print">
                              <input
                                type="text"
                                autoFocus
                                value={editingNoteText}
                                onChange={(e) => setEditingNoteText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveEditedNote(i);
                                  if (e.key === 'Escape') {
                                    setEditingNoteIndex(null);
                                    setEditingNoteText('');
                                  }
                                }}
                                title="Edit note text"
                                className="flex-1 rounded-lg bg-slate-950 border border-cyan-400 px-3 py-1.5 text-xs sm:text-sm text-white focus:outline-none"
                              />
                              <div className="flex items-center gap-1.5 justify-end">
                                <button
                                  type="button"
                                  onClick={() => handleSaveEditedNote(i)}
                                  title="Save note changes"
                                  className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs cursor-pointer"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingNoteIndex(null);
                                    setEditingNoteText('');
                                  }}
                                  title="Cancel editing"
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start justify-between gap-2.5">
                              <button
                                type="button"
                                onClick={() => handleStartEditNote(i, note)}
                                title="Click to edit this kitchen note"
                                className="text-left flex-1 flex items-start gap-2 cursor-pointer group-hover:text-white transition-colors"
                              >
                                <span className="text-cyan-400 font-bold select-none print:hidden">
                                  &bull;
                                </span>
                                <span>{note}</span>
                              </button>
                              <div className="flex items-center gap-1 shrink-0 no-print">
                                <button
                                  type="button"
                                  onClick={() => handleStartEditNote(i, note)}
                                  title="Edit this note"
                                  className="px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-cyan-300 text-[11px] font-medium transition-colors cursor-pointer"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteNote(i)}
                                  title="Remove this note"
                                  className="px-1.5 py-0.5 rounded bg-slate-800/80 hover:bg-red-500/20 text-slate-500 hover:text-red-300 text-xs transition-colors cursor-pointer"
                                >
                                  &times;
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-400 italic no-print">
                    No notes yet — add your own cooking adjustments, substitutions, or oven tips below so they stay with this recipe card (and appear on printouts).
                  </p>
                )}

                {/* Quick-Add Note Input Bar (Hidden in Print) */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1 no-print">
                  <input
                    type="text"
                    value={newNoteInput}
                    onChange={(e) => setNewNoteInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddNote();
                      }
                    }}
                    placeholder='Add a personal kitchen note (e.g., "Bake 5 mins less", "Great with extra lemon")...'
                    title="Type a personal kitchen note and press Enter or click + Add Note"
                    className="flex-1 rounded-xl bg-slate-900 border border-slate-700/90 px-3.5 py-2 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
                  />
                  <button
                    type="button"
                    disabled={!newNoteInput.trim()}
                    onClick={handleAddNote}
                    title="Add this note to the recipe card"
                    className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 disabled:hover:bg-cyan-500 text-slate-950 font-bold text-xs shrink-0 transition-colors cursor-pointer"
                  >
                    + Add Note
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Permanent Bottom Attribution & Accuracy Disclaimer Footer */}
          <footer className="mt-8 pt-5 border-t border-slate-800 print:border-slate-300 space-y-3 text-[11px] leading-relaxed text-slate-400 print:text-slate-600">
            <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-amber-200/90 print:bg-slate-50 print:border-slate-300 print:text-slate-700">
              <strong className="text-amber-300 print:text-slate-900">⚠️ Accuracy Disclaimer:</strong>{' '}
              While we try to be as accurate as possible, automated recipe extraction, portion scaling, and unit conversions may occasionally make mistakes. Please double-check all measurements, temperatures, and timings against the original source link below before cooking.
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
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
                  Formatted with Ten Forward v1.10.1 (ten-forward.the-lal.net) &bull; Extracted{' '}
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
            </div>
          </footer>
        </article>
      </main>
    </div>
  );
}
