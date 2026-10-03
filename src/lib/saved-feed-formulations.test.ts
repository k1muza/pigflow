import { describe, expect, it } from "vitest";

import {
  savedFeedFormulaResult,
  type SavedFeedFormulaSet,
} from "./saved-feed-formulations";

describe("saved feed formulations", () => {
  it("restores recipe-only records saved before optimizer snapshots were added", () => {
    const formulaSet: SavedFeedFormulaSet = {
      id: "saved-1",
      name: "Nursery formulas",
      savedAt: "2026-10-03T10:00:00.000Z",
      programmeId: "nursery",
      programmeName: "Nursery Pig",
      phaseId: "pre-starter",
      phaseLabel: "Pre-starter",
      energySystem: "ME",
      targetBatchKg: 1000,
      ingredients: [
        { ingredientId: "corn", name: "Corn", pricePerKg: 0.3 },
        { ingredientId: "soy", name: "Soybean meal", pricePerKg: 0.6 },
      ],
      recipes: [
        {
          id: "least-cost",
          label: "Least cost",
          description: "Baseline",
          formula: {
            ingredients: [
              { ingredientId: "corn", inclusionPct: 70 },
              { ingredientId: "soy", inclusionPct: 30 },
            ],
          },
          nutrientProfile: [],
          costPerKg: 0.39,
          costIncreasePct: 0,
        },
        {
          id: "low-soy",
          label: "Low soy",
          description: "Alternative",
          formula: {
            ingredients: [
              { ingredientId: "corn", inclusionPct: 75 },
              { ingredientId: "soy", inclusionPct: 25 },
            ],
          },
          nutrientProfile: [],
          costPerKg: 0.4,
          costIncreasePct: 2.56,
        },
      ],
    };

    const restored = savedFeedFormulaResult(formulaSet);

    expect(restored?.status).toBe("optimal");
    expect(restored?.solution.formula).toEqual(formulaSet.recipes[0].formula);
    expect(restored?.alternatives).toHaveLength(1);
    expect(restored?.alternatives[0]).toMatchObject({
      id: "low-soy",
      label: "Low soy",
      costIncreasePct: 2.56,
    });
  });
});
