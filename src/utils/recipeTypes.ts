export interface AttributionRecord {
  sourceUrl: string;
  domain: string;
  siteName: string;
  authorName: string;
  authorUrl?: string;
  publishedDate?: string;
  extractedAt: string;
  creditNote: string;
}

export interface CandidateImage {
  url: string;
  caption?: string;
  source: 'json-ld-hero' | 'json-ld-step' | 'opengraph' | 'dom-verified' | 'custom';
  score: number;
}

export interface RecipeStep {
  id: string;
  section?: string;
  text: string;
  imageUrl?: string;
}

export interface NutritionInfo {
  calories?: string;
  proteinContent?: string;
  carbohydrateContent?: string;
  fatContent?: string;
}

export interface RecipeData {
  id: string;
  title: string;
  description: string;
  prepTime: string;
  cookTime: string;
  totalTime: string;
  baseServings: number;
  yieldText: string;
  category: string;
  cuisine: string;
  ingredients: string[];
  steps: RecipeStep[];
  notes: string[];
  heroImage: string;
  candidateImages: CandidateImage[];
  nutrition?: NutritionInfo;
  attribution: AttributionRecord;
  extractionMethod: 'json-ld' | 'dom-heuristic' | 'raw-text' | 'preset';
}

export type UnitSystem = 'original' | 'metric' | 'imperial';

export type PrintPhotoMode = 'hero-only' | 'hero-and-steps' | 'no-photos';

export interface SavedRecipeEntry {
  id: string;
  savedAt: string;
  recipe: RecipeData;
}
