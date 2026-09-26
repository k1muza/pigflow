import { describe, expect, it } from "vitest";

import { FEED_FORMULATIONS, feedFormulationById } from "./feed-formulations";

describe("feed formulation library", () => {
  it("does not ship source-company demonstration rations as PigFlow formulations", () => {
    expect(FEED_FORMULATIONS).toEqual([]);
  });

  it("does not resolve removed static formulation ids", () => {
    expect(feedFormulationById("pic-corn-soybean-meal")).toBeUndefined();
    expect(feedFormulationById("pic-high-fiber")).toBeUndefined();
  });
});
