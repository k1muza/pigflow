import { describe, expect, it } from "vitest";

import {
  PIC_SID_LYSINE_RESPONSE_2021,
  canPredictPicEconomicResponse,
} from "./nutrition-response";

describe("PIC SID lysine response evidence", () => {
  it("records the population and NRC energy basis behind the PIC target", () => {
    expect(PIC_SID_LYSINE_RESPONSE_2021.population.trials).toBe(29);
    expect(PIC_SID_LYSINE_RESPONSE_2021.population.pigs).toBe(48_338);
    expect(PIC_SID_LYSINE_RESPONSE_2021.energy.ingredientDatabase).toBe("NRC 2012");
  });

  it("records what the biological target represents", () => {
    expect(
      PIC_SID_LYSINE_RESPONSE_2021.biologicalTarget.approximateMaximumAdgPct,
    ).toBe(100);
    expect(
      PIC_SID_LYSINE_RESPONSE_2021.biologicalTarget.approximateMaximumGainFeedPct,
    ).toBe(99.4);
  });

  it("does not claim an economic response curve that the public source does not expose", () => {
    expect(canPredictPicEconomicResponse()).toBe(false);
  });
});
