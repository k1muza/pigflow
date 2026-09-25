import { beforeAll, describe, expect, it } from "vitest";

import { cloneDefaultConfig } from "../../config";
import { runEngine } from "../engine";
import { LEGACY_POLICIES } from "../world";
import {
  OPTIMIZER_BENCHMARK_YEARS,
  benchmarkOptimizer,
  type OptimizerBenchmarkRow,
} from "./optimizer-benchmark";

/**
 * What the capacity-balanced optimiser is held to, against V1 perfect foresight.
 *
 * The oracle is V1 given the whole horizon's consumption in advance and allowed
 * to cut its lorries against it. Nothing operating on today's information is
 * owed a win against that, so these bounds are not aspirations — they are where
 * the policy actually sits, measured by `npm run bench:optimizer`, with enough
 * room that ordinary drift does not fail the build and a regression does.
 *
 * The bands are deliberately one-sided. Beating foresight by more is never a
 * failure; the gate exists to catch the policy sliding back towards the
 * fixed-cover behaviour it replaced, which bought a fifth more journeys than
 * it needed to.
 */
const BOUNDS = {
  /** Never more than a tenth of a percent worse than knowing the future. */
  maxNetRegretPct: 0.1,
  /**
   * Journeys, as a share of the ones foresight needed. Measured: three to five
   * fewer at every horizon, so this is a two-percent allowance on a policy
   * currently in credit. It is not zero because an operational policy has no
   * right to beat foresight on journeys — it happens to, because it fills the
   * deck rather than buying to a cover target — and a gate that depended on it
   * continuing to would fail on noise. Two percent is still a twentieth of what
   * the fixed-cover policy this replaced was spending.
   */
  maxExtraLorriesPct: 2,
  /** A supplies lorry leaves full. Measured: 100% at every horizon. */
  minSuppliesLoadPct: 95,
  /** Foresight's stock is the ceiling. Measured: £6.7k–£9.2k below it. */
  maxClosingStockRegret: 0,
} as const;

describe("the capacity-balanced optimiser against V1 perfect foresight", () => {
  // Measured once in `beforeAll` rather than assigned by whichever test happens
  // to run first. A test that reads state another test wrote cannot be run on
  // its own, and `it.only` on the second one used to fail with a null read
  // rather than with anything to do with the optimiser.
  let rows: OptimizerBenchmarkRow[];

  beforeAll(async () => {
    const config = cloneDefaultConfig();
    config.stock.sows = 20;
    config.herd.maxSows = 20;
    config.herd.startMode = "staggered";

    rows = await benchmarkOptimizer(config, { policy: "balanced-load" });
  }, 900_000);

  it(
    `matches or beats foresight over ${OPTIMIZER_BENCHMARK_YEARS.join("/")} years`,
    () => {
      console.table(
        rows.map((row) => ({
          years: row.years,
          netRegret: Math.round(row.regret.netProcurementCost),
          "regret%": row.regret.netProcurementPct.toFixed(3),
          extraLorries: row.regret.lorries,
          supplyLoad: Math.round(row.optimizer.suppliesLoadPct),
          stockRegret: Math.round(row.regret.closingInventoryValue),
          emerg: row.optimizer.emergencyOrders,
          short: Math.round(row.optimizer.shortfallKg),
          sold: row.optimizer.pigsSold,
        })),
      );

      expect(rows.map((row) => row.years)).toEqual([...OPTIMIZER_BENCHMARK_YEARS]);

      for (const row of rows) {
        const at = `${row.years}y`;

        // ---- the herd was fed. Nothing below counts if this is not true. -----
        expect(row.optimizer.shortfallKg, `${at} shortfall`).toBeCloseTo(0, 6);
        expect(row.optimizer.emergencyOrders, `${at} emergency orders`).toBe(0);

        // ---- and it produced what the oracle's farm produced ----------------
        // The operational run draws the market before feeding, while the V1
        // oracle keeps its historical after-growth timing, so these are bands
        // rather than equalities. They are here to prove the cost comparison is
        // between two farms doing the same thing, not to assert biology.
        expect(row.optimizer.pigsSold, `${at} pigs sold`).toBeGreaterThan(row.oracle.pigsSold * 0.95);
        expect(row.optimizer.pigsSold, `${at} pigs sold`).toBeLessThan(row.oracle.pigsSold * 1.05);
        expect(row.optimizer.feedConsumedKg, `${at} feed eaten`).toBeGreaterThan(
          row.oracle.feedConsumedKg * 0.95,
        );
        expect(row.optimizer.feedConsumedKg, `${at} feed eaten`).toBeLessThan(
          row.oracle.feedConsumedKg * 1.05,
        );

        // ---- having fed it, it did so no worse than foresight ---------------
        expect(row.regret.netProcurementPct, `${at} net regret %`).toBeLessThanOrEqual(
          BOUNDS.maxNetRegretPct,
        );
        expect(
          (row.regret.lorries / row.oracle.lorries) * 100,
          `${at} extra lorries %`,
        ).toBeLessThanOrEqual(BOUNDS.maxExtraLorriesPct);
        expect(row.optimizer.suppliesLoadPct, `${at} supplies load`).toBeGreaterThanOrEqual(
          BOUNDS.minSuppliesLoadPct,
        );
        expect(row.regret.closingInventoryValue, `${at} closing stock`).toBeLessThanOrEqual(
          BOUNDS.maxClosingStockRegret,
        );
      }
    },
    600_000,
  );

  it("does not drift as the horizon lengthens", () => {
    // A policy that is only good early is a policy that is accumulating an error
    // too slowly to see at three years. Regret is measured as a share of spend
    // precisely so the twenty-year number is comparable with the three-year one;
    // if it is walking in one direction, this is where it shows up.
    const drift = Math.max(...rows.map((row) => row.regret.netProcurementPct));
    const best = Math.min(...rows.map((row) => row.regret.netProcurementPct));
    expect(drift - best, "spread of regret % across horizons").toBeLessThan(0.25);
  });
});

/**
 * The assumption that lets one operational run serve every checkpoint.
 *
 * The oracle needs one run per horizon because V1 cuts its lorries against the
 * whole configured project, so what it knows about year eleven changes what it
 * sends in year two. The operational policies are supposed to be the opposite:
 * they buy out of the bin in front of them and never read the project end, so a
 * twenty-year run's first year is the same year a one-year run produces.
 *
 * `runOptimizer` runs once and is read back at every checkpoint on exactly that
 * basis. If it ever stopped being true the benchmark would go quietly wrong in
 * the same way the shared oracle did, so it is asserted rather than assumed.
 */
describe("an operational run does not depend on when the project ends", () => {
  function farm(months: number) {
    const config = cloneDefaultConfig();
    config.stock.sows = 20;
    config.herd.maxSows = 20;
    config.herd.startMode = "staggered";
    config.project.variation = "settled";
    config.project.months = months;
    config.housing.enforceCapacity = false;
    return config;
  }

  function firstYear(months: number) {
    const engine = runEngine(farm(months), 365, {
      policies: { ...LEGACY_POLICIES, operationalProcurement: true },
    });
    return engine.history.map((day) => ({
      day: day.day,
      lorries: day.deliveries.length,
      payloadKg: Math.round(day.deliveries.reduce((kg, trip) => kg + trip.payloadKg, 0)),
    }));
  }

  it("sends the same lorries in year one whether the plan runs one year or twenty", () => {
    expect(firstYear(12 * 20)).toEqual(firstYear(12));
  }, 300_000);
});
