import { convertStepTemperatures, transformIngredientLine } from './ingredientScaler';
import { renderQrSvgString } from './qrSvg';
import type { PrintPhotoMode, RecipeData, UnitSystem } from './recipeTypes';

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Compiles a Markdown (.md) recipe file with YAML frontmatter and a permanent Creator Attribution header.
 */
export function compileRecipeMarkdown(
  recipe: RecipeData,
  targetServings: number,
  unitSystem: UnitSystem
): string {
  const scaleFactor = targetServings / Math.max(1, recipe.baseServings);
  const scaledIngredients = recipe.ingredients.map((line) =>
    transformIngredientLine(line, scaleFactor, unitSystem)
  );
  const scaledSteps = recipe.steps.map((s) => ({
    ...s,
    text: convertStepTemperatures(s.text, unitSystem),
  }));

  const lines: string[] = [
    '---',
    `title: "${recipe.title.replace(/"/g, '\\"')}"`,
    `author: "${recipe.attribution.authorName.replace(/"/g, '\\"')}"`,
    `site_name: "${recipe.attribution.siteName.replace(/"/g, '\\"')}"`,
    `source_url: "${recipe.attribution.sourceUrl}"`,
    `published_date: "${recipe.attribution.publishedDate || ''}"`,
    `saved_date: "${recipe.attribution.extractedAt}"`,
    `servings: ${targetServings}`,
    `prep_time: "${recipe.prepTime}"`,
    `cook_time: "${recipe.cookTime}"`,
    `total_time: "${recipe.totalTime}"`,
    `category: "${recipe.category}"`,
    `cuisine: "${recipe.cuisine}"`,
    '---',
    '',
    `# ${recipe.title}`,
    '',
    `> **Original Recipe Attribution:** By **${recipe.attribution.authorName}** on **${recipe.attribution.siteName}**`,
    `> **Original Source URL:** ${recipe.attribution.sourceUrl}`,
    `> *Saved via Ten Forward (ten-forward.the-lal.net) on ${recipe.attribution.extractedAt}*`,
    '',
  ];

  if (recipe.description) {
    lines.push(recipe.description, '');
  }

  const metaParts: string[] = [`**Servings:** ${targetServings}`];
  if (recipe.prepTime) metaParts.push(`**Prep:** ${recipe.prepTime}`);
  if (recipe.cookTime) metaParts.push(`**Cook:** ${recipe.cookTime}`);
  if (recipe.totalTime) metaParts.push(`**Total:** ${recipe.totalTime}`);
  lines.push(metaParts.join(' • '), '');

  lines.push('## Ingredients', '');
  for (const ing of scaledIngredients) {
    lines.push(`- [ ] ${ing}`);
  }
  lines.push('');

  lines.push('## Instructions', '');
  scaledSteps.forEach((step, idx) => {
    const prefix = step.section ? `*(${step.section})* ` : '';
    lines.push(`${idx + 1}. ${prefix}${step.text}`);
  });
  lines.push('');

  if (recipe.notes.length > 0) {
    lines.push("## Chef's & Galley Notes", '');
    for (const note of recipe.notes) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }

  lines.push(
    '---',
    `*Source credit: [${recipe.attribution.authorName} — ${recipe.attribution.siteName}](${recipe.attribution.sourceUrl})*`
  );

  return lines.join('\n');
}

/**
 * Compiles a self-contained, offline-ready printable HTML Galley Card with Creator Attribution & SVG QR Code.
 */
export function compileStandaloneRecipeHtml(
  recipe: RecipeData,
  targetServings: number,
  unitSystem: UnitSystem,
  photoMode: PrintPhotoMode,
  showQrCode: boolean
): string {
  const scaleFactor = targetServings / Math.max(1, recipe.baseServings);
  const scaledIngredients = recipe.ingredients.map((line) =>
    transformIngredientLine(line, scaleFactor, unitSystem)
  );
  const scaledSteps = recipe.steps.map((s) => ({
    ...s,
    text: convertStepTemperatures(s.text, unitSystem),
  }));
  const qrSvg = showQrCode ? renderQrSvgString(recipe.attribution.sourceUrl, 84) : '';

  const showHero = photoMode !== 'no-photos' && Boolean(recipe.heroImage);
  const showStepPhotos = photoMode === 'hero-and-steps';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(recipe.title)} — Recipe by ${escapeHtml(recipe.attribution.authorName)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Georgia, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      margin: 0;
      padding: 24px;
      line-height: 1.5;
    }
    .card {
      max-width: 860px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 14px;
      padding: 28px 32px;
      box-shadow: 0 10px 25px rgba(15, 23, 42, 0.06);
    }
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 16px;
      margin-bottom: 18px;
    }
    .kicker {
      font-size: 11px;
      font-family: monospace;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #0891b2;
      font-weight: 700;
      margin-bottom: 4px;
    }
    h1 {
      font-size: 26px;
      margin: 0 0 8px 0;
      line-height: 1.2;
    }
    .attribution-box {
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-left: 4px solid #06b6d4;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 13px;
      margin-top: 10px;
      line-height: 1.6;
    }
    .attribution-box a {
      color: #0e7490;
      text-decoration: underline;
      word-break: break-all;
    }
    .qr-box {
      text-align: center;
      flex-shrink: 0;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 10px;
      background: #ffffff;
    }
    .qr-caption {
      font-size: 9px;
      color: #475569;
      margin-top: 5px;
      max-width: 96px;
      line-height: 1.3;
    }
    .meta-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 18px;
      font-size: 13px;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 14px 18px;
      margin-bottom: 22px;
    }
    .hero-img {
      width: 100%;
      max-height: 300px;
      object-fit: cover;
      border-radius: 10px;
      margin-bottom: 20px;
      border: 1px solid #e2e8f0;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1.8fr;
      gap: 28px;
    }
    @media (max-width: 680px) {
      .grid { grid-template-columns: 1fr; }
    }
    h2 {
      font-size: 15px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 6px;
      margin-top: 0;
    }
    ul.ingredients {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    ul.ingredients li {
      padding: 5px 0;
      border-bottom: 1px dashed #e2e8f0;
      font-size: 14px;
    }
    ol.steps {
      padding-left: 20px;
      margin: 0;
    }
    ol.steps li {
      margin-bottom: 12px;
      font-size: 14.5px;
    }
    .step-img {
      display: block;
      max-width: 240px;
      max-height: 160px;
      border-radius: 8px;
      margin-top: 6px;
      border: 1px solid #cbd5e1;
    }
    .footer {
      margin-top: 24px;
      padding-top: 12px;
      border-top: 1px solid #cbd5e1;
      font-size: 11px;
      color: #475569;
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
    }
    @media print {
      @page { margin: 14mm; }
      body { background: #fff; padding: 0; }
      .card { border: 1px solid #cbd5e1; box-shadow: none; padding: 28px 32px; }
    }
  </style>
</head>
<body>
  <article class="card">
    <div class="header-row">
      <div>
        <div class="kicker">Ten Forward Galley Card • ${escapeHtml(recipe.category || 'Recipe')}</div>
        <h1>${escapeHtml(recipe.title)}</h1>
        ${recipe.description ? `<p style="margin: 4px 0 8px 0; color: #334155; font-size: 14px;">${escapeHtml(recipe.description)}</p>` : ''}
        <div class="attribution-box">
          <strong>Recipe by ${escapeHtml(recipe.attribution.authorName)}</strong> • Published on <strong>${escapeHtml(recipe.attribution.siteName)}</strong>
          ${recipe.attribution.publishedDate ? ` (${escapeHtml(recipe.attribution.publishedDate)})` : ''}<br/>
          Original URL: <a href="${escapeHtml(recipe.attribution.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(recipe.attribution.sourceUrl)}</a>
        </div>
      </div>
      ${
        showQrCode
          ? `<div class="qr-box">
              ${qrSvg}
              <div class="qr-caption">Scan for original on ${escapeHtml(recipe.attribution.domain)}</div>
            </div>`
          : ''
      }
    </div>

    <div class="meta-strip">
      <div><strong>Servings:</strong> ${targetServings} ${targetServings !== recipe.baseServings ? `(scaled from ${recipe.baseServings})` : ''}</div>
      ${recipe.prepTime ? `<div><strong>Prep:</strong> ${escapeHtml(recipe.prepTime)}</div>` : ''}
      ${recipe.cookTime ? `<div><strong>Cook:</strong> ${escapeHtml(recipe.cookTime)}</div>` : ''}
      ${recipe.totalTime ? `<div><strong>Total:</strong> ${escapeHtml(recipe.totalTime)}</div>` : ''}
      ${recipe.cuisine ? `<div><strong>Cuisine:</strong> ${escapeHtml(recipe.cuisine)}</div>` : ''}
      ${recipe.nutrition?.calories ? `<div><strong>Calories:</strong> ${escapeHtml(recipe.nutrition.calories)}</div>` : ''}
    </div>

    ${showHero ? `<img class="hero-img" src="${escapeHtml(recipe.heroImage)}" alt="${escapeHtml(recipe.title)}" />` : ''}

    <div class="grid">
      <section>
        <h2>Ingredients</h2>
        <ul class="ingredients">
          ${scaledIngredients.map((ing) => `<li>☐ ${escapeHtml(ing)}</li>`).join('\n          ')}
        </ul>
      </section>
      <section>
        <h2>Preparation Steps</h2>
        <ol class="steps">
          ${scaledSteps
            .map(
              (s) =>
                `<li>${s.section ? `<strong>[${escapeHtml(s.section)}]</strong> ` : ''}${escapeHtml(s.text)}${
                  showStepPhotos && s.imageUrl
                    ? `<img class="step-img" src="${escapeHtml(s.imageUrl)}" alt="Step photo" />`
                    : ''
                }</li>`
            )
            .join('\n          ')}
        </ol>
        ${
          recipe.notes.length > 0
            ? `<div style="margin-top: 18px; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
                <h2 style="border: none; margin-bottom: 4px; padding: 0;">Chef &amp; Galley Notes</h2>
                <ul style="margin: 0; padding-left: 18px; font-size: 13px;">
                  ${recipe.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}
                </ul>
              </div>`
            : ''
        }
      </section>
    </div>

    <footer class="footer">
      <div>Attributed to <strong>${escapeHtml(recipe.attribution.authorName)}</strong> (${escapeHtml(recipe.attribution.siteName)}) — <a href="${escapeHtml(recipe.attribution.sourceUrl)}">${escapeHtml(recipe.attribution.sourceUrl)}</a></div>
      <div>Formatted with Ten Forward v1.4 (ten-forward.the-lal.net) • Saved ${escapeHtml(recipe.attribution.extractedAt)}</div>
    </footer>
  </article>
</body>
</html>`;
}
