import type { DietAnalysis, DietFormula } from "./diet-formula";
import { firebaseConfigured, getFirebase } from "./firebase";
import type {
  FormulationNutrientComparison,
  LeastCostFormulationResult,
} from "./feed-optimizer";

export const SAVED_FEED_FORMULATIONS_COLLECTION = "feedFormulations";

const LOCAL_STORAGE_KEY = "pigflow-saved-feed-formulations-v1";

export type SavedFeedFormulaRecipe = {
  id: string;
  label: string;
  description: string;
  formula: DietFormula;
  analysis?: DietAnalysis;
  nutrientProfile: readonly FormulationNutrientComparison[];
  costPerKg: number;
  costIncreasePct: number;
};

export type SavedFeedFormulaSet = {
  id: string;
  name: string;
  savedAt: string;
  programmeId: string;
  programmeName: string;
  phaseId: string;
  phaseLabel: string;
  sourceTable?: string;
  energySystem: "ME" | "NE";
  targetBatchKg: number;
  ingredients: readonly {
    ingredientId: string;
    name: string;
    pricePerKg: number;
  }[];
  recipes: readonly SavedFeedFormulaRecipe[];
  setup?: {
    rows: readonly {
      ingredientId: string;
      price: string;
      min: string;
      max: string;
    }[];
    useFixedPremix: boolean;
    fixedPremixName: string;
    fixedPremixKgPerTonne: string;
    fixedPremixPricePerKg: string;
    selectedRecipeId: string;
  };
  result?: Extract<LeastCostFormulationResult, { status: "optimal" }>;
};

export type NewSavedFeedFormulaSet = Omit<SavedFeedFormulaSet, "id" | "savedAt">;

export type SavedFeedFormulaLocation = "shared" | "device";

export async function saveFeedFormulaSet(
  input: NewSavedFeedFormulaSet,
  existingId?: string,
): Promise<{ formulaSet: SavedFeedFormulaSet; location: SavedFeedFormulaLocation }> {
  const formulaSet: SavedFeedFormulaSet = {
    ...input,
    id: existingId ?? crypto.randomUUID(),
    savedAt: new Date().toISOString(),
  };

  saveLocalCopy(formulaSet);

  if (!firebaseConfigured) {
    return { formulaSet, location: "device" };
  }

  const firebase = await getFirebase();
  if (!firebase) {
    return { formulaSet, location: "device" };
  }

  const { doc, setDoc } = await import("firebase/firestore");
  void setDoc(doc(firebase.db, SAVED_FEED_FORMULATIONS_COLLECTION, formulaSet.id), {
    ...formulaSet,
    savedBy: firebase.auth.currentUser?.uid ?? "unknown",
  }).catch((error) => {
    console.error("PigFlow could not sync the saved feed formulation.", error);
  });

  return { formulaSet, location: "shared" };
}

export async function listSavedFeedFormulaSets(): Promise<SavedFeedFormulaSet[]> {
  const local = readLocalCopies();
  if (!firebaseConfigured) return local;

  const firebase = await getFirebase();
  if (!firebase) return local;

  try {
    const { collection, getDocs } = await import("firebase/firestore");
    const snapshot = await getDocs(collection(firebase.db, SAVED_FEED_FORMULATIONS_COLLECTION));
    const shared = snapshot.docs
      .map((document) => readStoredFormulaSet(document.id, document.data()))
      .filter((item): item is SavedFeedFormulaSet => item !== null);
    const merged = new Map(local.map((item) => [item.id, item]));
    shared.forEach((item) => {
      const localItem = merged.get(item.id);
      if (!localItem || item.savedAt >= localItem.savedAt) merged.set(item.id, item);
    });
    return [...merged.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch (error) {
    console.error("PigFlow could not load the shared feed formulations.", error);
    return local;
  }
}

export async function getSavedFeedFormulaSet(
  id: string,
): Promise<SavedFeedFormulaSet | null> {
  const local = readLocalCopies().find((item) => item.id === id) ?? null;
  if (!firebaseConfigured) return local;

  const firebase = await getFirebase();
  if (!firebase) return local;

  try {
    const { doc, getDoc } = await import("firebase/firestore");
    const snapshot = await getDoc(doc(firebase.db, SAVED_FEED_FORMULATIONS_COLLECTION, id));
    if (!snapshot.exists()) return local;
    const shared = readStoredFormulaSet(snapshot.id, snapshot.data());
    if (!shared) return local;
    return local && local.savedAt >= shared.savedAt ? local : shared;
  } catch (error) {
    console.error("PigFlow could not load the shared feed formulation.", error);
    return local;
  }
}

export function savedFeedFormulaResult(
  formulaSet: SavedFeedFormulaSet,
): Extract<LeastCostFormulationResult, { status: "optimal" }> | null {
  if (formulaSet.result) return formulaSet.result;

  const leastCost =
    formulaSet.recipes.find((recipe) => recipe.id === "least-cost") ?? formulaSet.recipes[0];
  if (!leastCost) return null;

  const restored = {
    status: "optimal",
    solution: savedRecipeSolution(leastCost),
    nutrientProfile: [...leastCost.nutrientProfile],
    alternatives: formulaSet.recipes
      .filter((recipe) => recipe !== leastCost)
      .map((recipe) => ({
        id: recipe.id,
        label: recipe.label,
        description: recipe.description,
        solution: savedRecipeSolution(recipe),
        nutrientProfile: [...recipe.nutrientProfile],
        costIncreasePct: recipe.costIncreasePct,
      })),
    ingredientOpportunities: [],
    alternativeCostTolerancePct: Math.max(
      3,
      ...formulaSet.recipes.map((recipe) => recipe.costIncreasePct),
    ),
    ingredientOpportunityCostTolerancesPct: [],
    unsupportedRequirements: [],
  };

  return restored as Extract<LeastCostFormulationResult, { status: "optimal" }>;
}

function savedRecipeSolution(recipe: SavedFeedFormulaRecipe) {
  return {
    formula: recipe.formula,
    costPerKg: recipe.costPerKg,
    // Older saved records predate the full optimizer snapshot. The workbench
    // renders their stored formula and nutrient profile directly, so analysis
    // is intentionally absent until the user regenerates the formulation.
    analysis: recipe.analysis as DietAnalysis,
  };
}

function saveLocalCopy(formulaSet: SavedFeedFormulaSet): void {
  const existing = readLocalCopies().filter((item) => item.id !== formulaSet.id);
  window.localStorage.setItem(
    LOCAL_STORAGE_KEY,
    JSON.stringify([formulaSet, ...existing]),
  );
}

function readLocalCopies(): SavedFeedFormulaSet[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedFeedFormulaSet);
  } catch {
    return [];
  }
}

function readStoredFormulaSet(id: string, value: unknown): SavedFeedFormulaSet | null {
  if (!value || typeof value !== "object") return null;
  const stored = value as Record<string, unknown>;
  const savedAtValue = stored.savedAt as { toDate?: () => Date } | string | undefined;
  const savedAt =
    typeof savedAtValue === "string"
      ? savedAtValue
      : savedAtValue?.toDate instanceof Function
        ? savedAtValue.toDate().toISOString()
        : new Date(0).toISOString();
  const candidate = { ...stored, id, savedAt };
  return isSavedFeedFormulaSet(candidate) ? candidate : null;
}

function isSavedFeedFormulaSet(value: unknown): value is SavedFeedFormulaSet {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SavedFeedFormulaSet>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.savedAt === "string" &&
    typeof candidate.programmeId === "string" &&
    typeof candidate.phaseId === "string" &&
    Array.isArray(candidate.ingredients) &&
    Array.isArray(candidate.recipes)
  );
}
