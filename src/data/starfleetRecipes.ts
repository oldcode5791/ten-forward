import type { RecipeData } from '../utils/recipeTypes';

// Inline SVG Data URIs for crisp, zero-external-network dish illustrations in Starfleet sample presets
const GUINAN_DESSERT_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450">
  <defs>
    <linearGradient id="bg1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
  </defs>
  <rect width="800" height="450" fill="url(#bg1)"/>
  <circle cx="650" cy="90" r="180" fill="#06b6d4" opacity="0.08"/>
  <ellipse cx="400" cy="340" rx="220" ry="42" fill="#334155" stroke="#22d3ee" stroke-width="3"/>
  <path d="M270 330 C270 210, 530 210, 530 330 Z" fill="#fef3c7" stroke="#f59e0b" stroke-width="3"/>
  <path d="M310 270 Q400 220 490 270" fill="none" stroke="#d97706" stroke-width="4" stroke-linecap="round"/>
  <circle cx="400" cy="215" r="22" fill="#ef4444"/>
  <text x="40" y="55" fill="#22d3ee" font-family="monospace" font-size="18" font-weight="bold">DECK 10 FORWARD • GALLEY ARCHIVE #1701-D</text>
  <text x="40" y="85" fill="#94a3b8" font-family="sans-serif" font-size="15">Guinan's Chilled Cardassian Spiced Custard &amp; Dark Ganache</text>
</svg>`);

const PICARD_SHORTBREAD_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450">
  <rect width="800" height="450" fill="#0f172a"/>
  <circle cx="160" cy="110" r="140" fill="#22d3ee" opacity="0.08"/>
  <ellipse cx="400" cy="340" rx="240" ry="45" fill="#1e293b" stroke="#06b6d4" stroke-width="3"/>
  <rect x="270" y="250" width="110" height="75" rx="12" fill="#fde68a" stroke="#d97706" stroke-width="3"/>
  <rect x="395" y="235" width="115" height="80" rx="12" fill="#fcd34d" stroke="#b45309" stroke-width="3"/>
  <circle cx="305" cy="285" r="4" fill="#92400e"/>
  <circle cx="345" cy="285" r="4" fill="#92400e"/>
  <circle cx="430" cy="275" r="4" fill="#92400e"/>
  <circle cx="475" cy="275" r="4" fill="#92400e"/>
  <text x="40" y="55" fill="#22d3ee" font-family="monospace" font-size="18" font-weight="bold">CAPTAIN'S READY ROOM • TEA SERVICE</text>
  <text x="40" y="85" fill="#94a3b8" font-family="sans-serif" font-size="15">Earl Grey Bergamot Shortbread Wedges (Hot, Crisp, Unsweetened Pair)</text>
</svg>`);

const RIKER_OMELET_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450">
  <rect width="800" height="450" fill="#0f172a"/>
  <ellipse cx="400" cy="320" rx="230" ry="65" fill="#1e293b" stroke="#38bdf8" stroke-width="3"/>
  <path d="M240 315 C260 220, 540 220, 560 315 C460 355, 340 355, 240 315 Z" fill="#facc15" stroke="#eab308" stroke-width="3"/>
  <circle cx="350" cy="285" r="8" fill="#22c55e"/>
  <circle cx="410" cy="275" r="9" fill="#22c55e"/>
  <circle cx="455" cy="295" r="7" fill="#ef4444"/>
  <text x="40" y="55" fill="#22d3ee" font-family="monospace" font-size="18" font-weight="bold">OFFICERS' MESS • QUARTERS COOKERY</text>
  <text x="40" y="85" fill="#94a3b8" font-family="sans-serif" font-size="15">Commander Riker's Alaskan Herb &amp; Smoked Gruyère Omelet</text>
</svg>`);

export const STARFLEET_SAMPLE_RECIPES: RecipeData[] = [
  {
    id: 'preset-guinan-creme',
    title: "Guinan's Ten Forward Spiced Vanilla & Dark Chocolate Crème",
    description:
      'A silky, make-ahead stove-top pastry cream infused with orange zest, cinnamon, and espresso, topped with a thin bittersweet chocolate ganache.',
    prepTime: '15 mins',
    cookTime: '12 mins',
    totalTime: '2 hrs 27 mins',
    baseServings: 4,
    yieldText: '4 coupe glasses',
    category: 'Dessert',
    cuisine: 'Ten Forward Galley / French-Inspired',
    ingredients: [
      '2 cups whole milk',
      '1/2 cup heavy whipping cream',
      '4 large egg yolks',
      '1/3 cup granulated sugar',
      '3 tbsp cornstarch',
      '1/4 tsp fine sea salt',
      '1 tsp pure vanilla bean paste',
      '1/2 tsp ground Ceylon cinnamon',
      '4 oz bittersweet chocolate (70% cacao), finely chopped',
      '1 tbsp unsalted butter, cubed and softened',
    ],
    steps: [
      {
        id: 'step-1',
        section: 'Spiced Custard Base',
        text: 'Warm the 2 cups whole milk and 1/4 cup of the heavy cream in a medium heavy-bottomed saucepan over medium heat until steaming (about 175°F), just before a simmer.',
      },
      {
        id: 'step-2',
        section: 'Spiced Custard Base',
        text: 'In a heatproof bowl, whisk together the egg yolks, sugar, cornstarch, salt, and ground cinnamon for 60 seconds until pale and ribbon-smooth.',
      },
      {
        id: 'step-3',
        section: 'Spiced Custard Base',
        text: 'Slowly drizzle half of the hot milk into the yolk mixture while whisking constantly to temper the eggs, then pour everything back into the saucepan.',
      },
      {
        id: 'step-4',
        section: 'Spiced Custard Base',
        text: 'Cook over medium-low heat, whisking continuously into the corners of the pan for 2 to 3 minutes until thickened to a glossy pudding consistency. Remove from heat and stir in the vanilla bean paste and butter.',
      },
      {
        id: 'step-5',
        section: 'Ganache Crown & Chill',
        text: 'Divide the warm custard among 4 chilled Ten Forward coupe glasses. Melt the chopped bittersweet chocolate with the remaining 1/4 cup warm cream, spoon over each glass, and chill for 2 hours before serving.',
      },
    ],
    notes: [
      'Guinan recommends serving with a small pinch of flaky sea salt on top of the dark chocolate layer.',
      'Can be prepared up to 48 hours ahead and kept covered in the refrigerator.',
    ],
    heroImage: GUINAN_DESSERT_SVG,
    candidateImages: [
      {
        url: GUINAN_DESSERT_SVG,
        caption: "Guinan's Spiced Vanilla & Dark Chocolate Crème",
        source: 'json-ld-hero',
        score: 100,
      },
    ],
    nutrition: {
      calories: '385 kcal',
      proteinContent: '7 g',
      carbohydrateContent: '31 g',
      fatContent: '26 g',
    },
    attribution: {
      sourceUrl: 'https://ten-forward.the-lal.net/archive/guinans-spiced-creme',
      domain: 'ten-forward.the-lal.net',
      siteName: 'USS Enterprise-D Galley Archive (Deck 10 Forward)',
      authorName: 'Guinan (Hostess, Ten Forward)',
      publishedDate: '2026-11-13',
      extractedAt: '2026-11-13',
      creditNote: 'Original Starfleet Culinary Archive recipe by Guinan on USS Enterprise-D Galley Archive.',
    },
    extractionMethod: 'preset',
  },
  {
    id: 'preset-picard-shortbread',
    title: "Captain Picard's Earl Grey Bergamot Shortbread",
    description:
      'Crisp, buttery Scottish-style shortbread wedges speckled with finely ground loose-leaf Earl Grey tea and fresh lemon zest. Engineered to accompany tea, Earl Grey, hot.',
    prepTime: '20 mins',
    cookTime: '24 mins',
    totalTime: '44 mins',
    baseServings: 8,
    yieldText: '8 wedges',
    category: 'Baking & Tea Service',
    cuisine: 'British / La Barre Heritage',
    ingredients: [
      '1 cup unsalted butter, softened at room temperature',
      '1/2 cup powdered confectioners sugar',
      '2 tbsp finely ground loose-leaf Earl Grey tea leaves',
      '1 tsp grated fresh lemon or bergamot zest',
      '1 tsp pure vanilla extract',
      '2 cups all-purpose flour',
      '1/2 tsp kosher salt',
    ],
    steps: [
      {
        id: 'step-1',
        text: 'Preheat oven to 325°F and line an 8-inch round cake pan or baking sheet with parchment paper.',
      },
      {
        id: 'step-2',
        text: 'Pulse the loose-leaf Earl Grey tea in a spice grinder or mortar and pestle until finely speckled (do not pulverize into dust).',
      },
      {
        id: 'step-3',
        text: 'Beat the softened butter, powdered sugar, Earl Grey tea, lemon zest, and vanilla extract in a mixer for 2 minutes until smooth and fragrant.',
      },
      {
        id: 'step-4',
        text: 'Add the flour and kosher salt, mixing on low just until a cohesive, crumbly dough forms. Press evenly into the prepared pan and prick all over with a fork.',
      },
      {
        id: 'step-5',
        text: 'Bake at 325°F for 22 to 25 minutes until the edges are lightly golden. Slice into 8 wedges while warm, then cool completely on a wire rack.',
      },
    ],
    notes: [
      'Use real loose-leaf tea with natural bergamot oil rather//dust tea bags for noticeably brighter aroma.',
    ],
    heroImage: PICARD_SHORTBREAD_SVG,
    candidateImages: [
      {
        url: PICARD_SHORTBREAD_SVG,
        caption: "Captain Picard's Earl Grey Shortbread",
        source: 'json-ld-hero',
        score: 100,
      },
    ],
    nutrition: {
      calories: '290 kcal',
      proteinContent: '3 g',
      carbohydrateContent: '28 g',
      fatContent: '18 g',
    },
    attribution: {
      sourceUrl: 'https://ten-forward.the-lal.net/archive/picard-earl-grey-shortbread',
      domain: 'ten-forward.the-lal.net',
      siteName: 'Château Picard & Starfleet Culinary Log',
      authorName: 'Capt. Jean-Luc Picard',
      publishedDate: '2026-11-13',
      extractedAt: '2026-11-13',
      creditNote: 'Original recipe by Capt. Jean-Luc Picard on Château Picard & Starfleet Culinary Log.',
    },
    extractionMethod: 'preset',
  },
  {
    id: 'preset-riker-omelet',
    title: "Commander Riker's Alaskan Herb & Smoked Gruyère Omelet",
    description:
      'A classic French-rolled skillet omelet loaded with chives, tarragon, sautéed wild mushrooms, and melted Gruyère—significantly more appetizing than Owon eggs.',
    prepTime: '10 mins',
    cookTime: '6 mins',
    totalTime: '16 mins',
    baseServings: 2,
    yieldText: '2 servings',
    category: 'Breakfast & Galley Skillet',
    cuisine: 'Alaskan / French Technique',
    ingredients: [
      '4 large pasture-raised eggs',
      '1 tbsp cold water',
      '1/4 tsp kosher salt',
      '1/8 tsp freshly cracked black pepper',
      '1 1/2 tbsp unsalted butter',
      '1/2 cup sliced cremini or chanterelle mushrooms',
      '1/3 cup shredded aged Gruyère cheese',
      '2 tbsp finely snipped fresh chives and tarragon',
    ],
    steps: [
      {
        id: 'step-1',
        text: 'In a nonstick 8-inch skillet over medium heat, melt 1/2 tbsp butter and sauté the sliced mushrooms with a pinch of salt for 3 minutes until golden. Transfer to a warm plate.',
      },
      {
        id: 'step-2',
        text: 'Whisk the eggs, cold water, salt, pepper, and half of the fresh herbs vigorously for 30 seconds until no streaks of egg white remain.',
      },
      {
        id: 'step-3',
        text: 'Melt the remaining 1 tbsp butter in the skillet over medium-low heat. Pour in the eggs and stir briskly with a silicone spatula while shaking the pan to form tiny, tender curds.',
      },
      {
        id: 'step-4',
        text: 'While the top surface is still slightly glossy (about 60 seconds), scatter the warm mushrooms and shredded Gruyère down the center, roll onto a warm plate, and garnish with remaining chives.',
      },
    ],
    notes: [
      'Do not let the bottom brown—low-and-slow heat keeps the exterior pale yellow and custardy inside.',
    ],
    heroImage: RIKER_OMELET_SVG,
    candidateImages: [
      {
        url: RIKER_OMELET_SVG,
        caption: "Commander Riker's Alaskan Herb Omelet",
        source: 'json-ld-hero',
        score: 100,
      },
    ],
    nutrition: {
      calories: '310 kcal',
      proteinContent: '18 g',
      carbohydrateContent: '3 g',
      fatContent: '24 g',
    },
    attribution: {
      sourceUrl: 'https://ten-forward.the-lal.net/archive/riker-alaskan-omelet',
      domain: 'ten-forward.the-lal.net',
      siteName: 'USS Enterprise-D Officers Mess Log',
      authorName: 'Cmdr. William T. Riker',
      publishedDate: '2026-11-13',
      extractedAt: '2026-11-13',
      creditNote: 'Original recipe by Cmdr. William T. Riker on USS Enterprise-D Officers Mess Log.',
    },
    extractionMethod: 'preset',
  },
];
