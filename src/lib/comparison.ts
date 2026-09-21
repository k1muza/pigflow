import { calculateProjection, type PlannerConfig } from "./model";
import { inventoryTotal } from "./sim/accounting";

/** Matched biological runs used on both sides of every comparison. */
export const COMPARISON_SEEDS = [1, 2, 3, 4, 5] as const;

export type Band = {
  p10: number;
  median: number;
  p90: number;
};

export type EnsembleMetric =
  | "breakEvenPerDeadweightKg"
  | "marginPerDeadweightKg"
  | "profitOrLossPerYear"
  | "pigsSoldPerYear"
  | "pigsWeanedPerSowYear"
  | "peakHeadCount"
  | "peakFundingNeed"
  // The experimental inventory-adjusted measures. They answer the question the
  // cash measures cannot: whether a plan that burns money is losing it or
  // building a herd with it.
  | "inventoryAdjustedProfitPerYear"
  | "livestockInventoryChangePerYear"
  | "farmWorthAtEnd";

export type PlanEnsemble = {
  settled: boolean;
  seeds: number[];
  values: Record<EnsembleMetric, number[]>;
  bands: Record<EnsembleMetric, Band>;
};

export type PlanComparison = {
  mode: "chance" | "settled" | "mixed";
  a: PlanEnsemble;
  b: PlanEnsemble;
  /** Matched-seed percentage change in break-even price: negative favours B. */
  breakEvenDeltaPct: Band;
  seedsFavoringB: number;
  verdict: "b-lower" | "b-higher" | "too-close";
};

export type EnsembleComparison = {
  mode: "chance" | "settled" | "mixed";
  deltaPct: Band;
  seedsFavoringCandidate: number;
  runs: number;
  verdict: "candidate-lower" | "candidate-higher" | "too-close";
};

export type ConfigDifference = {
  path: string;
  section: string;
  label: string;
  a: string;
  b: string;
};

export type MultiConfigDifference = Omit<ConfigDifference, "a" | "b"> & {
  values: string[];
};

export type FutureYearBand = {
  year: number;
  profitOrLoss: Band;
  closingCash: Band;
  pigsSold: Band;
  deadweightKg: Band;
};

export type FutureEnsemble = {
  settled: boolean;
  seeds: number[];
  startingCash: Band;
  profitOrLossPerYear: Band;
  pigsSoldPerYear: Band;
  deadweightKgPerYear: Band;
  closingCashAtEnd: Band;
  years: FutureYearBand[];
};

export type FutureComparison = {
  mode: "chance" | "settled" | "mixed";
  projectionYears: number;
  a: FutureEnsemble;
  b: FutureEnsemble;
};

export function quantile(values: readonly number[], probability: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.max(0, Math.min(1, probability)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function band(values: readonly number[]): Band {
  return {
    p10: quantile(values, 0.1),
    median: quantile(values, 0.5),
    p90: quantile(values, 0.9),
  };
}

export function buildPlanEnsemble(
  input: PlannerConfig,
  seeds: readonly number[] = COMPARISON_SEEDS,
): PlanEnsemble {
  const values: PlanEnsemble["values"] = {
    breakEvenPerDeadweightKg: [],
    marginPerDeadweightKg: [],
    profitOrLossPerYear: [],
    pigsSoldPerYear: [],
    pigsWeanedPerSowYear: [],
    peakHeadCount: [],
    peakFundingNeed: [],
    inventoryAdjustedProfitPerYear: [],
    livestockInventoryChangePerYear: [],
    farmWorthAtEnd: [],
  };
  const years = input.project.months / 12;

  for (const seed of seeds) {
    const config = structuredClone(input);
    config.project.seed = seed;
    const projection = calculateProjection(config);
    values.breakEvenPerDeadweightKg.push(
      projection.costOfProduction.fullCostPerDeadweightKg,
    );
    values.marginPerDeadweightKg.push(
      projection.costOfProduction.averageDeadweightKg > 0
        ? projection.costOfProduction.marginPerPig /
            projection.costOfProduction.averageDeadweightKg
        : 0,
    );
    values.profitOrLossPerYear.push(
      years > 0 ? operatingProfitOrLoss(config, projection.months) / years : 0,
    );
    values.pigsSoldPerYear.push(
      years > 0 ? projection.summary.totalPigsSold / years : 0,
    );
    values.pigsWeanedPerSowYear.push(projection.summary.pigsWeanedPerSowYear);
    values.peakHeadCount.push(projection.summary.peakHeadCount);
    values.peakFundingNeed.push(projection.summary.peakFundingNeed);
    // Financing is stripped from both profit measures the same way, so the gap
    // between them is the herd the plan built and nothing else.
    const builtUp =
      inventoryTotal(projection.accounting.closing) -
      inventoryTotal(projection.accounting.opening);
    values.inventoryAdjustedProfitPerYear.push(
      years > 0 ? (operatingProfitOrLoss(config, projection.months) + builtUp) / years : 0,
    );
    values.livestockInventoryChangePerYear.push(years > 0 ? builtUp / years : 0);
    values.farmWorthAtEnd.push(projection.summary.farmWorthAtEnd);
  }

  return {
    settled: input.project.variation === "settled",
    seeds: [...seeds],
    values,
    bands: {
      breakEvenPerDeadweightKg: band(values.breakEvenPerDeadweightKg),
      marginPerDeadweightKg: band(values.marginPerDeadweightKg),
      profitOrLossPerYear: band(values.profitOrLossPerYear),
      pigsSoldPerYear: band(values.pigsSoldPerYear),
      pigsWeanedPerSowYear: band(values.pigsWeanedPerSowYear),
      peakHeadCount: band(values.peakHeadCount),
      peakFundingNeed: band(values.peakFundingNeed),
      inventoryAdjustedProfitPerYear: band(values.inventoryAdjustedProfitPerYear),
      livestockInventoryChangePerYear: band(values.livestockInventoryChangePerYear),
      farmWorthAtEnd: band(values.farmWorthAtEnd),
    },
  };
}

export function comparePlanConfigs(
  aConfig: PlannerConfig,
  bConfig: PlannerConfig,
  seeds: readonly number[] = COMPARISON_SEEDS,
): PlanComparison {
  const mode =
    aConfig.project.variation === bConfig.project.variation
      ? aConfig.project.variation
      : "mixed";
  // A settled comparison has no distribution to sample. One run is the whole
  // answer; chance or mixed comparisons still need matched seeds.
  const comparisonSeeds = mode === "settled" ? [1] : [...seeds];
  const a = buildPlanEnsemble(aConfig, comparisonSeeds);
  const b = buildPlanEnsemble(bConfig, comparisonSeeds);
  const deltas = comparisonSeeds.map((_, index) => {
    const baseline = a.values.breakEvenPerDeadweightKg[index];
    const candidate = b.values.breakEvenPerDeadweightKg[index];
    return baseline === 0 ? 0 : ((candidate - baseline) / baseline) * 100;
  });
  const breakEvenDeltaPct = band(deltas);
  const seedsFavoringB = deltas.filter((value) => value < 0).length;
  const verdict =
    breakEvenDeltaPct.p10 <= 0 && breakEvenDeltaPct.p90 >= 0
      ? "too-close"
      : breakEvenDeltaPct.p90 < 0
        ? "b-lower"
        : "b-higher";

  return { mode, a, b, breakEvenDeltaPct, seedsFavoringB, verdict };
}

/** Compares any candidate with the first selected plan without rerunning either. */
export function compareEnsembles(
  baseline: PlanEnsemble,
  candidate: PlanEnsemble,
): EnsembleComparison {
  const mode =
    baseline.settled && candidate.settled
      ? "settled"
      : baseline.settled || candidate.settled
        ? "mixed"
        : "chance";
  const runs = Math.max(
    baseline.values.breakEvenPerDeadweightKg.length,
    candidate.values.breakEvenPerDeadweightKg.length,
  );
  const deltas = Array.from({ length: runs }, (_, index) => {
    const baselineValues = baseline.values.breakEvenPerDeadweightKg;
    const candidateValues = candidate.values.breakEvenPerDeadweightKg;
    const base = baselineValues[baselineValues.length === 1 ? 0 : index];
    const next = candidateValues[candidateValues.length === 1 ? 0 : index];
    return base === 0 ? 0 : ((next - base) / base) * 100;
  });
  const deltaPct = band(deltas);
  const verdict =
    deltaPct.p10 <= 0 && deltaPct.p90 >= 0
      ? "too-close"
      : deltaPct.p90 < 0
        ? "candidate-lower"
        : "candidate-higher";
  return {
    mode,
    deltaPct,
    seedsFavoringCandidate: deltas.filter((value) => value < 0).length,
    runs,
    verdict,
  };
}

function sumMonths(
  months: ReturnType<typeof calculateProjection>["months"],
  pick: (month: ReturnType<typeof calculateProjection>["months"][number]) => number,
): number {
  return months.reduce((total, month) => total + pick(month), 0);
}

/**
 * Farm income less farm costs. Generated cash injections and withdrawals move
 * the bank balance but are financing, so neither is allowed to masquerade as
 * profit or loss.
 */
function operatingProfitOrLoss(
  config: PlannerConfig,
  months: ReturnType<typeof calculateProjection>["months"],
): number {
  const included = new Set(months.map((month) => month.index));
  let financingIn = 0;
  let financingOut = 0;
  for (const movement of config.finance.cashMovements) {
    if (!movement.auto || !included.has(movement.monthIndex)) continue;
    if (movement.kind === "in") financingIn += movement.amount;
    else financingOut += movement.amount;
  }
  return (
    sumMonths(months, (month) => month.revenue - month.totalCost) -
    financingIn +
    financingOut
  );
}

export function buildFutureEnsemble(
  input: PlannerConfig,
  projectionYears: number,
  seeds: readonly number[],
): FutureEnsemble {
  const years = Math.max(1, Math.floor(projectionYears));
  const startMonth = input.project.months;
  const runYears: {
    profitOrLoss: number;
    closingCash: number;
    pigsSold: number;
    deadweightKg: number;
  }[][] = [];
  const startingCash: number[] = [];

  for (const seed of seeds) {
    const config = structuredClone(input);
    config.project.seed = seed;
    config.project.months = startMonth + years * 12;
    const projection = calculateProjection(config);
    startingCash.push(
      startMonth > 0
        ? projection.months[startMonth - 1]?.closingCash ?? config.project.openingCash
        : config.project.openingCash,
    );
    runYears.push(
      Array.from({ length: years }, (_, index) => {
        const months = projection.months.slice(
          startMonth + index * 12,
          startMonth + (index + 1) * 12,
        );
        return {
          profitOrLoss: operatingProfitOrLoss(config, months),
          closingCash: months.at(-1)?.closingCash ?? startingCash.at(-1) ?? 0,
          pigsSold: sumMonths(months, (month) => month.pigsSold),
          deadweightKg: sumMonths(months, (month) => month.saleDeadweightKg),
        };
      }),
    );
  }

  const values = <K extends keyof (typeof runYears)[number][number]>(key: K) =>
    runYears.flatMap((run) => run.map((year) => year[key]));
  const finalValues = runYears.map((run) => run.at(-1)?.closingCash ?? 0);

  return {
    settled: input.project.variation === "settled",
    seeds: [...seeds],
    startingCash: band(startingCash),
    profitOrLossPerYear: band(values("profitOrLoss")),
    pigsSoldPerYear: band(values("pigsSold")),
    deadweightKgPerYear: band(values("deadweightKg")),
    closingCashAtEnd: band(finalValues),
    years: Array.from({ length: years }, (_, index) => ({
      year: index + 1,
      profitOrLoss: band(runYears.map((run) => run[index].profitOrLoss)),
      closingCash: band(runYears.map((run) => run[index].closingCash)),
      pigsSold: band(runYears.map((run) => run[index].pigsSold)),
      deadweightKg: band(runYears.map((run) => run[index].deadweightKg)),
    })),
  };
}

export function compareFutureConfigs(
  aConfig: PlannerConfig,
  bConfig: PlannerConfig,
  projectionYears: number,
  seeds: readonly number[] = COMPARISON_SEEDS,
): FutureComparison {
  const mode =
    aConfig.project.variation === bConfig.project.variation
      ? aConfig.project.variation
      : "mixed";
  const comparisonSeeds = mode === "settled" ? [1] : [...seeds];
  return {
    mode,
    projectionYears,
    a: buildFutureEnsemble(aConfig, projectionYears, comparisonSeeds),
    b: buildFutureEnsemble(bConfig, projectionYears, comparisonSeeds),
  };
}

const OMITTED_DIFFS = new Set(["project.name", "project.seed"]);

function displayLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (character) => character.toUpperCase())
    .replace(/ Pct$/, " %")
    .replace(/ Kg$/, " kg")
    .replace(/ Days$/, " days");
}

function displayValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    const names = value.map((item) => {
      if (!item || typeof item !== "object") return String(item);
      const row = item as Record<string, unknown>;
      return String(row.name ?? row.note ?? row.id ?? "item");
    });
    return `${value.length} item${value.length === 1 ? "" : "s"}: ${names.join(", ")}`;
  }
  return String(value ?? "—");
}

function flatten(value: unknown, prefix = "", output = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(value) || value === null || typeof value !== "object") {
    output.set(prefix, value);
    return output;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    flatten(child, path, output);
  }
  return output;
}

/** Input-only differences. The seed is omitted because comparison replaces it with matched seeds. */
export function diffPlanConfigs(a: PlannerConfig, b: PlannerConfig): ConfigDifference[] {
  const left = flatten(a);
  const right = flatten(b);
  const paths = new Set([...left.keys(), ...right.keys()]);
  const differences: ConfigDifference[] = [];

  for (const path of [...paths].sort()) {
    if (OMITTED_DIFFS.has(path)) continue;
    const aValue = left.get(path);
    const bValue = right.get(path);
    if (JSON.stringify(aValue) === JSON.stringify(bValue)) continue;
    const [section, ...rest] = path.split(".");
    differences.push({
      path,
      section: displayLabel(section),
      label: displayLabel(rest.at(-1) ?? section),
      a: displayValue(aValue),
      b: displayValue(bValue),
    });
  }
  return differences;
}

/** Input differences across every selected plan, in the same order as the columns. */
export function diffManyPlanConfigs(configs: readonly PlannerConfig[]): MultiConfigDifference[] {
  if (configs.length < 2) return [];
  const flattened = configs.map((config) => flatten(config));
  const paths = new Set(flattened.flatMap((config) => [...config.keys()]));
  const differences: MultiConfigDifference[] = [];

  for (const path of [...paths].sort()) {
    if (OMITTED_DIFFS.has(path)) continue;
    const raw = flattened.map((config) => config.get(path));
    if (raw.every((value) => JSON.stringify(value) === JSON.stringify(raw[0]))) continue;
    const [section, ...rest] = path.split(".");
    differences.push({
      path,
      section: displayLabel(section),
      label: displayLabel(rest.at(-1) ?? section),
      values: raw.map(displayValue),
    });
  }
  return differences;
}
