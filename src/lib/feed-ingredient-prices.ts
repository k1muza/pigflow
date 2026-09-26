export type IngredientDefaultPrice = {
  ingredientId: string;
  usdPerTonne: number;
  market: string;
  asOf: string;
  sourceLabel: string;
  sourceUrl: string;
  note?: string;
};

export const INGREDIENT_DEFAULT_PRICES: readonly IngredientDefaultPrice[] = [
  {
    ingredientId: "corn-yellow-dent",
    usdPerTonne: 200,
    market: "Zimbabwe / regional commodity reference",
    asOf: "2025-10-27",
    sourceLabel: "Agriculture.co.zw — stockfeeds industry pricing",
    sourceUrl:
      "https://agriculture.co.zw/2025/10/27/the-evolution-of-zimbabwes-stockfeeds-industry/",
    note: "Published reference for yellow maize futures; use a current supplier quote for procurement.",
  },
  {
    ingredientId: "soybean-meal-dehulled-solvent-extracted",
    usdPerTonne: 321,
    market: "Harare, Zimbabwe",
    asOf: "2025-10-27",
    sourceLabel: "Agriculture.co.zw — stockfeeds industry pricing",
    sourceUrl:
      "https://agriculture.co.zw/2025/10/27/the-evolution-of-zimbabwes-stockfeeds-industry/",
    note: "Published as soybean meal landed in Harare; the article does not distinguish 44% vs 48% meal.",
  },
  {
    ingredientId: "soybean-meal-solvent-extracted",
    usdPerTonne: 321,
    market: "Harare, Zimbabwe",
    asOf: "2025-10-27",
    sourceLabel: "Agriculture.co.zw — stockfeeds industry pricing",
    sourceUrl:
      "https://agriculture.co.zw/2025/10/27/the-evolution-of-zimbabwes-stockfeeds-industry/",
    note: "Published as soybean meal landed in Harare; the article does not distinguish 44% vs 48% meal.",
  },
  {
    ingredientId: "wheat-bran",
    usdPerTonne: 200,
    market: "Zimbabwe",
    asOf: "2026-09-25",
    sourceLabel: "FeedSport International",
    sourceUrl: "https://www.feedsport.co.zw/products/1V2M1I3RGpDaBCuwGyAT",
    note: "Current listed bulk price; supplier stock and delivery terms can change.",
  },
];

export function ingredientDefaultPrice(
  ingredientId: string,
): IngredientDefaultPrice | undefined {
  return INGREDIENT_DEFAULT_PRICES.find((price) => price.ingredientId === ingredientId);
}
