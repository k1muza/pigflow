export type IngredientPriceSourceScope =
  | "harare"
  | "zimbabwe"
  | "regional"
  | "global-fallback";

export type IngredientDefaultPrice = {
  ingredientId: string;
  usdPerTonne: number;
  market: string;
  asOf: string;
  sourceScope: IngredientPriceSourceScope;
  sourceLabel: string;
  sourceUrl: string;
  note?: string;
};

/**
 * Planning defaults, not executable procurement quotes.
 *
 * Preference order:
 * 1. Harare market/supplier price
 * 2. Zimbabwe price
 * 3. Southern African regional price
 * 4. Global benchmark only when no usable local/regional public price is available
 */
export const INGREDIENT_DEFAULT_PRICES: readonly IngredientDefaultPrice[] = [
  {
    ingredientId: "corn-yellow-dent",
    usdPerTonne: 348.6,
    market: "Harare, Zimbabwe",
    asOf: "2026-09-29",
    sourceScope: "harare",
    sourceLabel: "Zimbabwe Mercantile Exchange — Harare maize market",
    sourceUrl: "https://system.zmx.co.zw/zmxwebpage/ATSCommo.aspx",
    note:
      "Harare maize matched trade / yellow-maize market reference. Use the supplier-delivered price when available.",
  },
  {
    ingredientId: "soybean-meal-dehulled-solvent-extracted",
    usdPerTonne: 550,
    market: "Harare, Zimbabwe",
    asOf: "2026-09-30",
    sourceScope: "harare",
    sourceLabel: "FeedSport International — Soya meal",
    sourceUrl: "https://www.feedsport.co.zw/products/5TjUodezA0zgEjAHmgo7",
    note:
      "Harare supplier listing for 48% crude-protein soya meal; MOQ 10 tonnes. This is the closest match to the dehulled/high-protein canonical ingredient.",
  },
  {
    ingredientId: "soybean-meal-solvent-extracted",
    usdPerTonne: 520,
    market: "Harare, Zimbabwe",
    asOf: "2026-09-30",
    sourceScope: "harare",
    sourceLabel: "Zimbabwe Mercantile Exchange — Harare soymeal",
    sourceUrl: "https://system.zmx.co.zw/zmxwebpage/ATSCommo.aspx",
    note:
      "Current Harare soymeal market reference. The exchange line does not distinguish every protein specification.",
  },
  {
    ingredientId: "sunflower-meal-solvent-extracted",
    usdPerTonne: 500,
    market: "Harare, Zimbabwe",
    asOf: "2026-09-30",
    sourceScope: "harare",
    sourceLabel: "FeedSport International — Sunflower meal",
    sourceUrl: "https://www.feedsport.co.zw/products/5QS6z9c8HTBK4h6QGPDU",
    note: "Harare supplier listing; MOQ 10 tonnes.",
  },
  {
    ingredientId: "wheat-bran",
    usdPerTonne: 200,
    market: "Harare, Zimbabwe",
    asOf: "2026-09-30",
    sourceScope: "harare",
    sourceLabel: "FeedSport International — Wheat bran",
    sourceUrl: "https://www.feedsport.co.zw/products/1V2M1I3RGpDaBCuwGyAT",
    note: "Harare supplier listing; MOQ 1 tonne.",
  },
  {
    ingredientId: "limestone-ground",
    usdPerTonne: 135,
    market: "Harare, Zimbabwe",
    asOf: "2026-09-30",
    sourceScope: "harare",
    sourceLabel: "Beechnut — Stock Feed Limestone Flour",
    sourceUrl: "https://beechnut.co.zw/product/stock-feed-limestone-flour/",
    note: "Listed Harare price for one tonne of stock-feed limestone flour.",
  },
  {
    ingredientId: "calcium-carbonate",
    usdPerTonne: 135,
    market: "Harare, Zimbabwe",
    asOf: "2026-09-30",
    sourceScope: "harare",
    sourceLabel: "Beechnut — Stock Feed Limestone Flour",
    sourceUrl: "https://beechnut.co.zw/product/stock-feed-limestone-flour/",
    note:
      "Planning proxy using feed-grade limestone flour, whose principal mineral is calcium carbonate. Replace with the exact supplier grade when quoted.",
  },
  {
    ingredientId: "wheat-hard-red-winter",
    usdPerTonne: 477.9,
    market: "Harare, Zimbabwe",
    asOf: "2026-09-25",
    sourceScope: "harare",
    sourceLabel: "Zimbabwe Mercantile Exchange — Harare wheat",
    sourceUrl: "https://system.zmx.co.zw/zmxwebpage/ATSCommo.aspx",
    note:
      "Harare wheat proxy; the ZMX grade is not specifically US hard-red-winter wheat.",
  },
  {
    ingredientId: "sorghum-grain",
    usdPerTonne: 318.7,
    market: "Harare, Zimbabwe",
    asOf: "2026-09-30",
    sourceScope: "harare",
    sourceLabel: "Zimbabwe Mercantile Exchange — Harare white sorghum",
    sourceUrl: "https://system.zmx.co.zw/zmxwebpage/ATSCommo.aspx",
    note: "Current Harare white-sorghum market reference used as the grain-sorghum proxy.",
  },
  {
    ingredientId: "dicalcium-phosphate",
    usdPerTonne: 536,
    market: "Durban, South Africa",
    asOf: "2026-09-30",
    sourceScope: "regional",
    sourceLabel: "Page Global Consultants — Feed-grade DCP FOB Durban",
    sourceUrl:
      "https://b2brazil.com/hotsite/pageglobal/feed-grade-dicalcium-phosphate-bulk-anim",
    note:
      "FOB Durban regional reference. Freight, border, duty and Harare delivery costs are not included.",
  },
  {
    ingredientId: "monocalcium-phosphate",
    usdPerTonne: 639,
    market: "Durban, South Africa",
    asOf: "2026-09-30",
    sourceScope: "regional",
    sourceLabel: "Page Global Consultants — Feed-grade MCP FOB Durban",
    sourceUrl:
      "https://b2brazil.com/hotsite/pageglobal/feed-grade-monocalcium-phosphate-feed-pr",
    note:
      "FOB Durban regional reference. Freight, border, duty and Harare delivery costs are not included.",
  },
  {
    ingredientId: "sodium-chloride",
    usdPerTonne: 134.98,
    market: "Gauteng, South Africa",
    asOf: "2026-09-29",
    sourceScope: "regional",
    sourceLabel: "MF Feeds — Feed-grade salt",
    sourceUrl: "https://www.mf-feeds.com/products/feed-grade-salt-50kg",
    note:
      "Derived from R110.63 per 50 kg at ZAR 16.3922/USD. Retail-equivalent regional proxy; excludes freight to Harare.",
  },
  {
    ingredientId: "dl-methionine",
    usdPerTonne: 2479,
    market: "South Africa",
    asOf: "2026-06-30",
    sourceScope: "regional",
    sourceLabel: "IMARC — DL-methionine South Africa Q2 2026",
    sourceUrl: "https://www.imarcgroup.com/dl-methionine-pricing-report",
    note: "South African Q2 2026 market benchmark; use the actual distributor quote for purchasing.",
  },
  {
    ingredientId: "l-lysine-hcl",
    usdPerTonne: 1909.51,
    market: "Southern Africa trade proxy",
    asOf: "2025-02-15",
    sourceScope: "regional",
    sourceLabel: "Volza — South Africa feed-premix lysine HCl export unit value",
    sourceUrl: "https://www.volza.com/p/lysine-hcl/hsn-code-2309/import-data/",
    note:
      "Older regional trade proxy derived from a 6,000 kg South Africa-origin shipment worth USD 11,457.08. Replace promptly with a current Harare/South African supplier quote.",
  },
  {
    ingredientId: "l-threonine",
    usdPerTonne: 1260,
    market: "Global import fallback — China",
    asOf: "2026-06-30",
    sourceScope: "global-fallback",
    sourceLabel: "Expert Market Research — Threonine Q2 2026",
    sourceUrl: "https://www.expertmarketresearch.com/price-forecast/threonine-price-trends",
    note:
      "No transparent current Southern-African bulk quote was found. China Q2 2026 benchmark is used only as a planning floor and excludes freight/import costs.",
  },
  {
    ingredientId: "l-tryptophan",
    usdPerTonne: 10500,
    market: "Global import fallback — China",
    asOf: "2026-06-30",
    sourceScope: "global-fallback",
    sourceLabel: "Expert Market Research — Tryptophan Q2 2026",
    sourceUrl: "https://www.expertmarketresearch.com/price-forecast/tryptophan-price-trends",
    note:
      "No transparent current Southern-African bulk quote was found. China Q2 2026 benchmark is used only as a planning floor and excludes freight/import costs.",
  },
  {
    ingredientId: "corn-oil",
    usdPerTonne: 1587,
    market: "Global import fallback — USA FOB",
    asOf: "2026-08-31",
    sourceScope: "global-fallback",
    sourceLabel: "Procurement Resource — Corn oil Q3 2026",
    sourceUrl: "https://www.procurementresource.com/resource-center/corn-oil-price-trends",
    note:
      "No robust current Harare/Southern-African bulk corn-oil quote was found. USA FOB benchmark excludes freight/import costs.",
  },
];

export function ingredientDefaultPrice(
  ingredientId: string,
): IngredientDefaultPrice | undefined {
  return INGREDIENT_DEFAULT_PRICES.find((price) => price.ingredientId === ingredientId);
}

export function ingredientDefaultPricePerKg(
  ingredientId: string,
): number | undefined {
  const price = ingredientDefaultPrice(ingredientId);
  return price ? price.usdPerTonne / 1000 : undefined;
}
