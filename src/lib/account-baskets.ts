// Per-account benchmark baskets, derived from the user's actual holdings.
// These map to query strings the `market-rates` edge function understands
// (single symbol or `basket:SYMBOL:weight,...`).
//
// Resolution priority (case-insensitive substring match):
//   1. account_name
//   2. platform
//   3. account_type fallback
//
// Static rates are for asset classes with no public price feed
// (e.g. Pokémon collectibles).

export type BasketResolution = {
  symbol: string;            // value passed to LiveRateCalculator / market-rates fn
  label: string;             // short, human-readable (shown in UI badge)
  source: 'live' | 'static'; // 'static' means no live API; use static_rate
  static_rate?: number;      // %/yr for collectibles etc.
};

const RULES: Array<{ match: RegExp; resolve: BasketResolution }> = [
  // --- Crypto: Gemini real holdings split (BTC 40 / XRP 36 / ETH 12 / SOL 12) ---
  {
    match: /gemini/i,
    resolve: {
      symbol: 'basket:BTC-USD:0.40,XRP-USD:0.36,ETH-USD:0.12,SOL-USD:0.12',
      label: 'Gemini mix',
      source: 'live',
    },
  },

  // --- Dub: weighted across 4 portfolios by $ position ---
  // Stargate 78% (semis-heavy → SMH proxy, with QQQ for the non-semi tech)
  // Pelosi 16% (big tech + utilities → QQQ + XLU)
  // Infinity 4% (space → ARKX)
  // Trump 1.5% (speculative tech → folded into QQQ weight)
  // Resulting blend (rounded): SMH 0.55, QQQ 0.32, XLU 0.08, ARKX 0.05
  {
    match: /dub/i,
    resolve: {
      symbol: 'basket:SMH:0.55,QQQ:0.32,XLU:0.08,ARKX:0.05',
      label: 'Dub mix',
      source: 'live',
    },
  },

  // --- Wealthfront / S&P 500 ---
  {
    match: /wealthfront|s&p|sp[ _-]?500/i,
    resolve: { symbol: '^GSPC', label: 'S&P 500', source: 'live' },
  },

  // --- Nasdaq-flavored brokerage ---
  {
    match: /nasdaq|qqq/i,
    resolve: { symbol: 'QQQ', label: 'Nasdaq 100', source: 'live' },
  },

  // --- Collectibles: no live feed, use static blended rate ---
  // Default 10%/yr — defensible for a mixed Pokémon collection.
  // Override per category once user provides modern/vintage/graded split.
  {
    match: /collectr|pokemon|pokémon|collectibles?/i,
    resolve: {
      symbol: '__none__',
      label: 'Pokémon (static)',
      source: 'static',
      static_rate: 10,
    },
  },
];

// Type-level fallbacks when no name/platform rule fires.
const TYPE_FALLBACKS: Record<string, BasketResolution> = {
  crypto:    { symbol: 'BTC-USD', label: 'BTC', source: 'live' },
  brokerage: { symbol: '^GSPC', label: 'S&P 500', source: 'live' },
  roth_ira:  { symbol: '^GSPC', label: 'S&P 500', source: 'live' },
  traditional_ira: { symbol: '^GSPC', label: 'S&P 500', source: 'live' },
  savings:   { symbol: '__none__', label: 'HYSA (static)', source: 'static', static_rate: 4 },
  collectibles: { symbol: '__none__', label: 'Collectibles (static)', source: 'static', static_rate: 7 },
};

export function resolveBasket(opts: {
  account_name: string;
  account_type: string;
  platform: string | null;
}): BasketResolution {
  const haystack = `${opts.account_name} ${opts.platform || ''}`.trim();
  for (const r of RULES) {
    if (r.match.test(haystack)) return r.resolve;
  }
  return TYPE_FALLBACKS[opts.account_type] ?? { symbol: '__none__', label: 'No benchmark', source: 'static', static_rate: 6 };
}
