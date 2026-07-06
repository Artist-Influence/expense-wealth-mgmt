/**
 * Built-in merchant "common sense" — a curated knowledge base of well-known
 * merchants → category, so the app can categorize a charge the FIRST time it
 * sees it, without the user having to teach every merchant by hand.
 *
 * This is a fallback layer: the user's own learned memory and rules always win
 * (they run first in categorizeTransactions). Knowledge only fires when nothing
 * personal matched, turning a blank "needs review" into a filled-in answer.
 *
 * Categories are resolved against the USER'S actual category list — each entry
 * lists a preferred category plus fallbacks, and we pick the first one the user
 * actually has. If none exist, the entry is skipped (no phantom categories).
 */

export interface KnowledgeHit {
  /** Ordered category preferences; first one present in the user's list wins. */
  categories: string[];
  /** 90 => auto-categorize (unambiguous recurring bills); ~80 => suggested. */
  confidence: number;
  label: string;
}

interface Entry {
  re: RegExp;
  hit: KnowledgeHit;
}

// Category preference bundles. Ordered most-specific → most-generic so we land
// in whatever the user actually calls it.
const SUBS = ['Subscriptions', 'Software', 'SaaS', 'Vendor Payment', 'Dues & Subscriptions', 'Business'];
const STREAMING = ['Subscriptions', 'Entertainment', 'Streaming'];
const MUSIC_TOOLS = ['Software', 'Subscriptions', 'Vendor Payment', 'Business', 'Production'];
const DISTRIBUTION = ['Distribution', 'Label Royalties', 'Vendor Payment', 'Subscriptions', 'Business'];
const RIDESHARE = ['Rideshare', 'Travel', 'Transportation'];
const TRAVEL = ['Travel', 'Business'];
const FOOD_DELIVERY = ['Dining', 'Food & Drink', 'Meals', 'Restaurants', 'Food'];
const DINING = ['Dining', 'Restaurants', 'Food & Drink', 'Coffee', 'Meals', 'Food'];
const GROCERY = ['Groceries', 'Food & Drink', 'Food', 'Shopping'];
const UTIL = ['Utilities', 'Bills', 'Phone', 'Internet'];
const PHONE = ['Phone', 'Utilities', 'Bills'];
const INTERNET = ['Internet', 'Utilities', 'Bills'];
const RETAIL = ['Shopping', 'Office Supplies', 'Supplies', 'Equipment'];
const FITNESS = ['Health', 'Fitness', 'Health/Medical', 'Subscriptions'];
const ADS = ['Marketing', 'Advertising', 'Business', 'Vendor Payment'];
const SHIPPING = ['Shipping', 'Business', 'Office Supplies'];

const auto = (categories: string[], label: string): KnowledgeHit => ({ categories, confidence: 90, label });
const suggest = (categories: string[], label: string): KnowledgeHit => ({ categories, confidence: 82, label });
const weak = (categories: string[], label: string): KnowledgeHit => ({ categories, confidence: 74, label });

const ENTRIES: Entry[] = [
  // ── AI / dev tools / SaaS (auto — recurring business software) ─────────────
  { re: /\bANTHROPIC\b|\bCLAUDE(\.AI)?\b/, hit: auto(SUBS, 'Anthropic (Claude)') },
  { re: /\bOPENAI\b|\bCHATGPT\b/, hit: auto(SUBS, 'OpenAI') },
  { re: /\bGITHUB\b/, hit: auto(SUBS, 'GitHub') },
  { re: /\bVERCEL\b/, hit: auto(SUBS, 'Vercel') },
  { re: /\bNETLIFY\b/, hit: auto(SUBS, 'Netlify') },
  { re: /\bCLOUDFLARE\b/, hit: auto(SUBS, 'Cloudflare') },
  { re: /\bSUPABASE\b/, hit: auto(SUBS, 'Supabase') },
  { re: /\bLOVABLE\b/, hit: auto(SUBS, 'Lovable') },
  { re: /\bFIGMA\b/, hit: auto(SUBS, 'Figma') },
  { re: /\bNOTION\b/, hit: auto(SUBS, 'Notion') },
  { re: /\bLINEAR\b/, hit: auto(SUBS, 'Linear') },
  { re: /\bSLACK\b/, hit: auto(SUBS, 'Slack') },
  { re: /\bZOOM(\.US)?\b/, hit: auto(SUBS, 'Zoom') },
  { re: /\bADOBE\b/, hit: auto(SUBS, 'Adobe') },
  { re: /\bCANVA\b/, hit: auto(SUBS, 'Canva') },
  { re: /\bAIRTABLE\b/, hit: auto(SUBS, 'Airtable') },
  { re: /\bDROPBOX\b/, hit: auto(SUBS, 'Dropbox') },
  { re: /\bATLASSIAN\b|\bJIRA\b|\bCONFLUENCE\b|\bTRELLO\b/, hit: auto(SUBS, 'Atlassian') },
  { re: /\bMICROSOFT\b|\bMSFT\b|\bOFFICE\s*365\b|\bMICROSOFT\s*365\b/, hit: auto(SUBS, 'Microsoft') },
  { re: /\bGOOGLE\s*(CLOUD|WORKSPACE|GSUITE|ONE|STORAGE)\b|\bGSUITE\b/, hit: auto(SUBS, 'Google Cloud/Workspace') },
  { re: /\bAWS\b|AMAZON\s*WEB\s*SERV|\bEC2\b/, hit: auto(SUBS, 'AWS') },
  { re: /\bDIGITALOCEAN\b|\bDIGITAL\s*OCEAN\b/, hit: auto(SUBS, 'DigitalOcean') },
  { re: /\bTWILIO\b/, hit: auto(SUBS, 'Twilio') },
  { re: /\bMAILCHIMP\b|\bINTUIT\s*MAILCHIMP\b/, hit: auto(SUBS, 'Mailchimp') },
  { re: /\bZAPIER\b/, hit: auto(SUBS, 'Zapier') },
  { re: /\bWEBFLOW\b/, hit: auto(SUBS, 'Webflow') },
  { re: /\bSQUARESPACE\b/, hit: auto(SUBS, 'Squarespace') },
  { re: /\bWIX\.COM\b|\bWIX\b/, hit: auto(SUBS, 'Wix') },
  { re: /\bGODADDY\b|\bNAMECHEAP\b|\bGOOGLE\s*DOMAINS\b/, hit: auto(SUBS, 'Domain registrar') },
  { re: /\b1PASSWORD\b|\bLASTPASS\b|\bDASHLANE\b/, hit: auto(SUBS, 'Password manager') },
  { re: /\bGRAMMARLY\b/, hit: auto(SUBS, 'Grammarly') },
  { re: /\bLINKEDIN\b/, hit: suggest(SUBS, 'LinkedIn') },
  { re: /\bCAPCUT\b/, hit: auto(SUBS, 'CapCut') },

  // ── Music / creative business tools ────────────────────────────────────────
  { re: /\bSPLICE\b/, hit: auto(MUSIC_TOOLS, 'Splice') },
  { re: /\bABLETON\b/, hit: auto(MUSIC_TOOLS, 'Ableton') },
  { re: /\bNATIVE\s*INSTRUMENTS\b|\bLANDR\b|\bIZOTOPE\b|\bSERUM\b|\bXFER\b|\bWAVES\b/, hit: auto(MUSIC_TOOLS, 'Music production tool') },
  { re: /\bSOUNDCLOUD\b/, hit: auto(MUSIC_TOOLS, 'SoundCloud') },
  { re: /\bDISTROKID\b|\bCD\s*BABY\b|\bTUNECORE\b|\bUNITEDMASTERS\b|\bDITTO\s*MUSIC\b|\bAMUSE\b|\bEMPIRE\b/, hit: auto(DISTRIBUTION, 'Music distribution') },
  { re: /\bBANDCAMP\b/, hit: suggest(MUSIC_TOOLS, 'Bandcamp') },
  { re: /\bSUBMITHUB\b|\bGROOVER\b/, hit: auto(ADS, 'Playlist/PR pitching') },

  // ── Streaming / consumer subscriptions (auto) ──────────────────────────────
  { re: /\bNETFLIX\b/, hit: auto(STREAMING, 'Netflix') },
  { re: /\bSPOTIFY\b/, hit: auto(STREAMING, 'Spotify') },
  { re: /\bHULU\b/, hit: auto(STREAMING, 'Hulu') },
  { re: /\bDISNEY\s*(PLUS|\+)?\b|\bDISNEYPLUS\b/, hit: auto(STREAMING, 'Disney+') },
  { re: /\bHBO\b|\bHBO\s*MAX\b|\bMAX\.COM\b/, hit: auto(STREAMING, 'HBO/Max') },
  { re: /\bYOUTUBE\s*(PREMIUM|TV|MUSIC)\b|\bGOOGLE\s*\*?YOUTUBE\b/, hit: auto(STREAMING, 'YouTube') },
  { re: /\bAPPLE\s*(MUSIC|TV|ARCADE)\b/, hit: auto(STREAMING, 'Apple Media') },
  { re: /\bAMAZON\s*PRIME\b|\bPRIME\s*VIDEO\b|\bAMZN\s*PRIME\b/, hit: auto(STREAMING, 'Amazon Prime') },
  { re: /\bPARAMOUNT\s*(PLUS|\+)?\b|\bPEACOCK\b|\bAPPLE\s*TV\b|\bCRUNCHYROLL\b|\bFUBOTV?\b|\bSLING\b/, hit: auto(STREAMING, 'Streaming service') },
  { re: /\bPATREON\b|\bSUBSTACK\b|\bONLYFANS\b/, hit: auto(STREAMING, 'Creator subscription') },
  { re: /\bNYTIMES\b|\bNY\s*TIMES\b|\bWALL\s*STREET\s*JOURNAL\b|\bWSJ\b|\bWASHINGTON\s*POST\b|\bMEDIUM\b/, hit: auto(STREAMING, 'News subscription') },
  { re: /\bAUDIBLE\b|\bKINDLE\s*UNLIMITED\b/, hit: auto(STREAMING, 'Audible/Kindle') },
  { re: /\bXBOX\b|\bPLAYSTATION\b|\bNINTENDO\b|\bSTEAM\s*(GAMES|PURCHASE)?\b|\bTWITCH\b/, hit: suggest(STREAMING, 'Gaming') },

  // ── Rideshare / transportation ─────────────────────────────────────────────
  { re: /\bUBER\b(?!\s*EATS)/, hit: suggest(RIDESHARE, 'Uber') },
  { re: /\bLYFT\b/, hit: suggest(RIDESHARE, 'Lyft') },
  { re: /\bMTA\b|\bMETROCARD\b|\bOMNY\b|\bSUBWAY\s*FARE\b|\bNJ\s*TRANSIT\b|\bPATH\b|\bLIRR\b|\bBART\b|\bCALTRAIN\b|\bAMTRAK\b/, hit: suggest(TRAVEL, 'Transit') },
  { re: /\bREVEL\b|\bCITIBIKE\b|\bCITI\s*BIKE\b|\bLIME\b|\bBIRD\b/, hit: suggest(RIDESHARE, 'Micromobility') },
  { re: /\bSHELL\b|\bEXXON\b|\bMOBIL\b|\bCHEVRON\b|\bBP\b|\bSUNOCO\b|\bGAS\s*STATION\b|\bWAWA\b/, hit: suggest(['Gas', 'Transportation', 'Travel', 'Auto'], 'Gas') },
  { re: /\bE-?ZPASS\b|\bEZ\s*PASS\b|\bTOLL\b|\bPARKING\b|\bSPOTHERO\b|\bPARKWHIZ\b/, hit: suggest(['Transportation', 'Travel', 'Auto', 'Parking'], 'Parking/Tolls') },

  // ── Food delivery / restaurants / coffee ───────────────────────────────────
  { re: /\bUBER\s*EATS\b|\bUBEREATS\b/, hit: suggest(FOOD_DELIVERY, 'Uber Eats') },
  { re: /\bDOORDASH\b|\bDOOR\s*DASH\b/, hit: suggest(FOOD_DELIVERY, 'DoorDash') },
  { re: /\bGRUBHUB\b|\bSEAMLESS\b|\bPOSTMATES\b|\bCAVIAR\b/, hit: suggest(FOOD_DELIVERY, 'Food delivery') },
  { re: /\bSTARBUCKS\b|\bDUNKIN\b|\bBLUE\s*BOTTLE\b|\bPHILZ\b|\bPEET'?S\b/, hit: suggest(['Coffee', 'Dining', 'Food & Drink'], 'Coffee shop') },
  { re: /\bCHIPOTLE\b|\bSWEETGREEN\b|\bCAVA\b|\bSHAKE\s*SHACK\b|\bMCDONALD'?S\b|\bCHICK-?FIL-?A\b|\bPANERA\b|\bSUBWAY\b|\bTACO\s*BELL\b|\bWENDY'?S\b|\bBURGER\s*KING\b|\bPOPEYES\b/, hit: suggest(DINING, 'Fast food') },
  { re: /\bDOMINO'?S\b|\bPIZZA\s*HUT\b|\bPAPA\s*JOHN'?S\b|\bTOAST\s*TAB\b|\bTOASTTAB\b|\bRESY\b|\bOPENTABLE\b/, hit: suggest(DINING, 'Restaurant') },

  // ── Groceries ──────────────────────────────────────────────────────────────
  { re: /\bWHOLE\s*FOODS\b|\bWHOLEFDS\b|\bTRADER\s*JOE'?S\b|\bSAFEWAY\b|\bKROGER\b|\bPUBLIX\b|\bALDI\b|\bWEGMANS\b|\bH-?E-?B\b|\bRALPHS\b|\bGIANT\b|\bSTOP\s*&?\s*SHOP\b/, hit: suggest(GROCERY, 'Grocery store') },
  { re: /\bINSTACART\b|\bFRESHDIRECT\b|\bFRESH\s*DIRECT\b|\bGOPUFF\b|\bIMPERFECT\s*FOODS\b/, hit: suggest(GROCERY, 'Grocery delivery') },

  // ── Travel: airlines / hotels / lodging ────────────────────────────────────
  { re: /\bDELTA\s*AIR\b|\bUNITED\s*AIR\b|\bAMERICAN\s*AIR\b|\bJETBLUE\b|\bSOUTHWEST\b|\bALASKA\s*AIR\b|\bSPIRIT\s*AIR\b|\bFRONTIER\b/, hit: suggest(TRAVEL, 'Airline') },
  { re: /\bAIRBNB\b|\bVRBO\b|\bMARRIOTT\b|\bHILTON\b|\bHYATT\b|\bIHG\b|\bBOOKING\.COM\b|\bEXPEDIA\b|\bHOTELS\.COM\b|\bPRICELINE\b/, hit: suggest(TRAVEL, 'Lodging/Travel') },

  // ── Telecom / utilities ────────────────────────────────────────────────────
  { re: /\bVERIZON\b|\bAT&?T\b|\bT-?MOBILE\b|\bSPRINT\b|\bMINT\s*MOBILE\b|\bGOOGLE\s*FI\b|\bVISIBLE\b/, hit: auto(PHONE, 'Mobile carrier') },
  { re: /\bCOMCAST\b|\bXFINITY\b|\bSPECTRUM\b|\bVERIZON\s*FIOS\b|\bFIOS\b|\bCENTURYLINK\b|\bCOX\s*COMM\b|\bOPTIMUM\b|\bSTARLINK\b/, hit: auto(INTERNET, 'Internet/Cable') },
  { re: /\bCON\s*ED\b|\bCONED\b|\bCON\s*EDISON\b|\bNATIONAL\s*GRID\b|\bPG&?E\b|\bDUKE\s*ENERGY\b|\bDOMINION\s*ENERGY\b/, hit: auto(['Utilities', 'Bills'], 'Electric/Gas utility') },

  // ── Ads / marketing ────────────────────────────────────────────────────────
  { re: /\bFACEBK\b|\bFACEBOOK\s*ADS?\b|\bMETA\s*(PLATFORMS|ADS)\b|\bINSTAGRAM\s*ADS?\b/, hit: auto(ADS, 'Meta Ads') },
  { re: /\bGOOGLE\s*ADS\b|\bGOOGLE\s*ADWORDS\b/, hit: auto(ADS, 'Google Ads') },
  { re: /\bTIKTOK\s*ADS?\b/, hit: auto(ADS, 'TikTok Ads') },

  // ── Shipping ───────────────────────────────────────────────────────────────
  { re: /\bUSPS\b|\bUPS\b(?!\s*STORE)|\bFEDEX\b|\bDHL\b|\bPITNEY\s*BOWES\b|\bSTAMPS\.COM\b|\bSHIPSTATION\b/, hit: suggest(SHIPPING, 'Shipping') },

  // ── Fitness / health / wellness ────────────────────────────────────────────
  { re: /\bEQUINOX\b|\bPLANET\s*FITNESS\b|\bLA\s*FITNESS\b|\bCLASSPASS\b|\bPELOTON\b|\bBLINK\s*FITNESS\b|\bCRUNCH\s*FITNESS\b|\bORANGETHEORY\b|\bSOULCYCLE\b/, hit: auto(FITNESS, 'Gym/Fitness') },
  { re: /\bCVS\b|\bWALGREENS\b|\bRITE\s*AID\b|\bDUANE\s*READE\b/, hit: weak(['Health', 'Health/Medical', 'Shopping', 'Groceries'], 'Pharmacy') },

  // ── Big-box / general retail (ambiguous → suggest low) ─────────────────────
  { re: /\bAMAZON\b|\bAMZN\b/, hit: weak(['Shopping', 'Office Supplies', 'Supplies', 'Business'], 'Amazon') },
  { re: /\bTARGET\b/, hit: weak(['Shopping', 'Groceries', 'Supplies'], 'Target') },
  { re: /\bWALMART\b|\bWAL-?MART\b/, hit: weak(['Shopping', 'Groceries', 'Supplies'], 'Walmart') },
  { re: /\bCOSTCO\b/, hit: weak(['Shopping', 'Groceries', 'Supplies'], 'Costco') },
  { re: /\bBEST\s*BUY\b|\bBESTBUY\b/, hit: weak(['Shopping', 'Equipment', 'Electronics'], 'Best Buy') },
  { re: /\bSTAPLES\b|\bOFFICE\s*DEPOT\b|\bOFFICEMAX\b/, hit: suggest(['Office Supplies', 'Supplies', 'Shopping'], 'Office supplies') },
  { re: /\bHOME\s*DEPOT\b|\bLOWE'?S\b|\bIKEA\b|\bUPS\s*STORE\b/, hit: weak(['Shopping', 'Supplies', 'Equipment'], 'Home/Hardware') },
  { re: /\bETSY\b|\bEBAY\b|\bSHEIN\b|\bASOS\b|\bNIKE\b|\bLULULEMON\b|\bUNIQLO\b|\bZARA\b|\bH&?M\b/, hit: weak(['Shopping', 'Clothing'], 'Retail/Apparel') },
  { re: /\bAPPLE\.COM\b|\bAPPLE\s*STORE\b|\bAPL\*ITUNES\b|\bITUNES\b/, hit: weak(['Software', 'Subscriptions', 'Shopping', 'Electronics'], 'Apple') },
];

/**
 * Resolve a knowledge hit against the user's actual categories.
 * Returns the matched category (in the user's exact casing) or null if the
 * user has none of the candidate categories.
 */
function resolveCategory(candidates: string[], allowedLower: Map<string, string>): string | null {
  for (const c of candidates) {
    const hit = allowedLower.get(c.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

export interface KnowledgeMatch {
  category: string;
  confidence: number;
  label: string;
}

/**
 * Match a transaction against the built-in knowledge base.
 * `allowedCategories` is the user's category list for the active mode; the
 * returned category is always one the user actually has (or null → no match).
 */
export function matchMerchantKnowledge(
  merchantKey: string,
  descriptionRaw: string,
  descriptionNormalized: string,
  allowedCategories: string[],
): KnowledgeMatch | null {
  if (allowedCategories.length === 0) return null;
  const haystack = `${merchantKey} ${descriptionNormalized} ${descriptionRaw}`.toUpperCase();
  const allowedLower = new Map(allowedCategories.map(c => [c.toLowerCase(), c]));

  for (const { re, hit } of ENTRIES) {
    if (!re.test(haystack)) continue;
    const category = resolveCategory(hit.categories, allowedLower);
    if (category) return { category, confidence: hit.confidence, label: hit.label };
    // A known merchant whose category the user doesn't have: keep scanning in
    // case a later (more generic) entry resolves, but usually this just falls
    // through to needs-review, which is correct — we won't invent a category.
  }
  return null;
}
