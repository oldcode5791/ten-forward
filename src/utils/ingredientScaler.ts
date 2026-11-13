import type { UnitSystem } from './recipeTypes';

const UNICODE_FRACTIONS: Record<string, number> = {
  '¼': 0.25,
  '½': 0.5,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅕': 0.2,
  '⅖': 0.4,
  '⅗': 0.6,
  '⅘': 0.8,
  '⅙': 1 / 6,
  '⅚': 5 / 6,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

const FRACTION_TABLE: Array<[number, string]> = [
  [0.125, '1/8'],
  [1 / 6, '1/6'],
  [0.2, '1/5'],
  [0.25, '1/4'],
  [1 / 3, '1/3'],
  [0.375, '3/8'],
  [0.5, '1/2'],
  [0.625, '5/8'],
  [2 / 3, '2/3'],
  [0.75, '3/4'],
  [0.875, '7/8'],
];

/**
 * Formats a positive number into a clean culinary string (e.g., 1.5 -> "1 1/2", 0.333 -> "1/3").
 */
export function formatCulinaryNumber(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return '0';
  if (val >= 20) {
    return String(Math.round(val * 10) / 10);
  }

  const whole = Math.floor(val + 0.04);
  const rem = val - whole;

  if (Math.abs(rem) < 0.06) {
    return String(Math.max(1, whole));
  }

  let bestFrac = '';
  let bestDiff = 1;
  for (const [fracVal, label] of FRACTION_TABLE) {
    const diff = Math.abs(rem - fracVal);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestFrac = label;
    }
  }

  if (bestDiff <= 0.06) {
    return whole > 0 ? `${whole} ${bestFrac}` : bestFrac;
  }

  return String(Math.round(val * 10) / 10);
}

/**
 * Parses a single numeric token (whole, decimal, slash fraction, or unicode fraction).
 */
function parseSingleQuantity(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (UNICODE_FRACTIONS[s] !== undefined) return UNICODE_FRACTIONS[s];

  // Mixed unicode e.g. "1½"
  const mixedUni = /^(\d+)\s*([¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])$/.exec(s);
  if (mixedUni) {
    return Number(mixedUni[1]) + (UNICODE_FRACTIONS[mixedUni[2]] || 0);
  }

  // Mixed slash fraction e.g. "1 1/2"
  const mixedSlash = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (mixedSlash && Number(mixedSlash[3]) !== 0) {
    return Number(mixedSlash[1]) + Number(mixedSlash[2]) / Number(mixedSlash[3]);
  }

  // Simple slash fraction e.g. "3/4"
  const slash = /^(\d+)\/(\d+)$/.exec(s);
  if (slash && Number(slash[2]) !== 0) {
    return Number(slash[1]) / Number(slash[2]);
  }

  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

/**
 * Scales and optionally converts units for a single ingredient line.
 */
export function transformIngredientLine(
  line: string,
  scaleFactor: number,
  unitSystem: UnitSystem
): string {
  const trimmed = line.trim();
  if (!trimmed) return '';

  // Match leading quantity (including ranges like "1-2" or "1 1/2 to 2")
  const qtyPattern =
    /^((?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?\s*[¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]?|[¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]))(?:\s*(-|–|to)\s*((?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?\s*[¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]?|[¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])))?\s+(.*)$/i;

  const match = qtyPattern.exec(trimmed);
  if (!match) {
    return trimmed;
  }

  const q1 = parseSingleQuantity(match[1]);
  const sep = match[2];
  const q2 = match[3] ? parseSingleQuantity(match[3]) : null;
  const rest = match[4];

  if (q1 === null) return trimmed;

  const scaled1 = q1 * scaleFactor;
  const scaled2 = q2 !== null ? q2 * scaleFactor : null;

  if (unitSystem !== 'original' && scaled2 === null) {
    const converted = tryConvertUnit(scaled1, rest, unitSystem);
    if (converted) return converted;
  }

  const formattedQty =
    scaled2 !== null
      ? `${formatCulinaryNumber(scaled1)} ${sep === 'to' ? 'to' : '–'} ${formatCulinaryNumber(scaled2)}`
      : formatCulinaryNumber(scaled1);

  return `${formattedQty} ${rest}`;
}

/**
 * Converts common culinary weight and volume units between Metric and US Imperial.
 */
function tryConvertUnit(
  amount: number,
  rest: string,
  target: 'metric' | 'imperial'
): string | null {
  const unitMatch = /^([a-zA-Z.]+)\b(.*)$/.exec(rest.trim());
  if (!unitMatch) return null;

  const rawUnit = unitMatch[1].toLowerCase().replace(/\.$/, '');
  const tail = unitMatch[2];

  if (target === 'metric') {
    if (['oz', 'ounce', 'ounces'].includes(rawUnit)) {
      const grams = Math.round(amount * 28.3495);
      return `${grams} g${tail}`;
    }
    if (['lb', 'lbs', 'pound', 'pounds'].includes(rawUnit)) {
      const grams = Math.round(amount * 453.592);
      return grams >= 1000
        ? `${Math.round((grams / 1000) * 100) / 100} kg${tail}`
        : `${grams} g${tail}`;
    }
    if (['cup', 'cups', 'c'].includes(rawUnit)) {
      const ml = Math.round(amount * 240);
      return `${ml} ml (${formatCulinaryNumber(amount)} ${amount <= 1 ? 'cup' : 'cups'})${tail}`;
    }
    if (['fl', 'floz'].includes(rawUnit)) {
      const ml = Math.round(amount * 29.5735);
      return `${ml} ml${tail}`;
    }
  }

  if (target === 'imperial') {
    if (['g', 'gram', 'grams'].includes(rawUnit)) {
      const oz = amount / 28.3495;
      if (oz >= 16) {
        return `${Math.round((oz / 16) * 10) / 10} lb (${Math.round(amount)} g)${tail}`;
      }
      return `${Math.round(oz * 10) / 10} oz (${Math.round(amount)} g)${tail}`;
    }
    if (['kg', 'kilogram', 'kilograms'].includes(rawUnit)) {
      const lbs = amount * 2.20462;
      return `${Math.round(lbs * 10) / 10} lb${tail}`;
    }
    if (['ml', 'milliliter', 'milliliters'].includes(rawUnit)) {
      if (amount >= 60) {
        const cups = amount / 240;
        return `${formatCulinaryNumber(cups)} ${cups <= 1 ? 'cup' : 'cups'} (${Math.round(amount)} ml)${tail}`;
      }
      const tbsp = amount / 15;
      return `${formatCulinaryNumber(tbsp)} tbsp (${Math.round(amount)} ml)${tail}`;
    }
    if (['l', 'liter', 'liters', 'litre', 'litres'].includes(rawUnit)) {
      const cups = (amount * 1000) / 240;
      return `${formatCulinaryNumber(cups)} cups${tail}`;
    }
  }

  return null;
}

/**
 * Converts inline oven temperatures in step instructions (e.g. 350°F <-> 175°C).
 */
export function convertStepTemperatures(text: string, unitSystem: UnitSystem): string {
  if (unitSystem === 'original') return text;

  if (unitSystem === 'metric') {
    return text.replace(/\b(\d{3})\s*°?\s*F\b/g, (full, fStr) => {
      const f = Number(fStr);
      if (f < 150 || f > 600) return full;
      const c = Math.round((f - 32) * (5 / 9) / 5) * 5;
      return `${c}°C (${f}°F)`;
    });
  }

  if (unitSystem === 'imperial') {
    return text.replace(/\b(\d{2,3})\s*°?\s*C\b/g, (full, cStr) => {
      const c = Number(cStr);
      if (c < 65 || c > 315) return full;
      const f = Math.round(((c * 9) / 5 + 32) / 5) * 5;
      return `${f}°F (${c}°C)`;
    });
  }

  return text;
}
