import { BIRTH_WEIGHT_KG, type PlannerConfig } from "./config";
import type { HousingHerdView } from "./housing";
import type { PigStage } from "./sim";

export type ProductionGrowthStage = Exclude<PigStage, "gilt">;

export type GrowthCheckpoint = {
  ageDays: number;
  sampleSize: number;
  meanWeightKg: number;
  p10WeightKg: number;
  medianWeightKg: number;
  p90WeightKg: number;
  cvPct: number;
};

export type GrowthStagePerformance = {
  stage: ProductionGrowthStage;
  completed: number;
  meanEntryWeightKg: number;
  meanExitWeightKg: number;
  meanDays: number;
  observedAdgKg: number;
  configuredAdgKg: number;
};

export type GrowthMarketPerformance = {
  sold: number;
  meanAgeDays: number;
  p10AgeDays: number;
  medianAgeDays: number;
  p90AgeDays: number;
  meanWeightKg: number;
  p10WeightKg: number;
  medianWeightKg: number;
  p90WeightKg: number;
  meanLifetimeAdgKg: number;
};

export type GrowthSimulationSummary = {
  checkpoints: GrowthCheckpoint[];
  stages: GrowthStagePerformance[];
  market: GrowthMarketPerformance;
};

export const GROWTH_CHECKPOINT_AGES = [
  0, 14, 28, 42, 56, 70, 84, 98, 112, 126, 140, 154, 168,
] as const;

type StageEntry = {
  stage: ProductionGrowthStage;
  day: number;
  weightKg: number;
  complete: boolean;
};

type StageAccumulator = {
  completed: number;
  entryKg: number;
  exitKg: number;
  days: number;
  gainKg: number;
};

const PRODUCTION_STAGES: ProductionGrowthStage[] = [
  "piglet",
  "weaner",
  "grower",
  "finisher",
];

function productionStage(stage: PigStage): ProductionGrowthStage | null {
  return stage === "gilt" ? null : stage;
}

function quantile(values: readonly number[], share: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * share;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const fraction = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * fraction;
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function cvPct(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  if (average === 0) return 0;
  const variance =
    values.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) /
    values.length;
  return (Math.sqrt(variance) / average) * 100;
}

/**
 * A compact observer for growth reporting.
 *
 * It watches the same run the application already executed. It deliberately
 * does not retain one row per pig per day: only fixed age checkpoints, completed
 * stage aggregates, and market exits survive the run.
 */
export class GrowthObserver {
  private readonly checkpointWeights = new Map<number, number[]>(
    GROWTH_CHECKPOINT_AGES.map((age) => [age, []] as [number, number[]]),
  );
  private readonly stageEntries = new Map<string, StageEntry>();
  private readonly birthWeights = new Map<string, number>();
  private readonly completed = new Map<ProductionGrowthStage, StageAccumulator>(
    PRODUCTION_STAGES.map(
      (stage) =>
        [
          stage,
          { completed: 0, entryKg: 0, exitKg: 0, days: 0, gainKg: 0 },
        ] as [ProductionGrowthStage, StageAccumulator],
    ),
  );
  private readonly saleAges: number[] = [];
  private readonly saleWeights: number[] = [];
  private readonly lifetimeAdg: number[] = [];

  observe(day: number, herd: HousingHerdView): void {
    for (const pig of herd.pigs) {
      const stage = productionStage(pig.stage);
      const age = pig.ageDays(day);

      if (stage !== null && this.checkpointWeights.has(age)) {
        this.checkpointWeights.get(age)!.push(pig.weightKg);
      }
      if (age === 0) this.birthWeights.set(pig.id, BIRTH_WEIGHT_KG);
      if (stage === null) continue;

      const before = this.stageEntries.get(pig.id);
      if (!before) {
        this.stageEntries.set(pig.id, {
          stage,
          day,
          weightKg:
            stage === "piglet" && age === 0 ? BIRTH_WEIGHT_KG : pig.weightKg,
          complete: stage === "piglet" && age === 0,
        });
      } else if (before.stage !== stage) {
        if (before.complete) this.finishStage(before, day, pig.weightKg);
        this.stageEntries.set(pig.id, {
          stage,
          day,
          weightKg: pig.weightKg,
          complete: true,
        });
      }
    }

    for (const departure of herd.departures ?? []) {
      const entry = this.stageEntries.get(departure.id);
      if (
        departure.reason === "sold" &&
        departure.stage === "finisher" &&
        departure.ageDays !== undefined &&
        departure.weightKg !== undefined
      ) {
        if (entry?.stage === "finisher" && entry.complete) {
          this.finishStage(entry, departure.day, departure.weightKg);
        }
        this.saleAges.push(departure.ageDays);
        this.saleWeights.push(departure.weightKg);
        const birthWeight = this.birthWeights.get(departure.id);
        if (birthWeight !== undefined && departure.ageDays > 0) {
          this.lifetimeAdg.push(
            (departure.weightKg - birthWeight) / departure.ageDays,
          );
        }
      }
      this.stageEntries.delete(departure.id);
      this.birthWeights.delete(departure.id);
    }
  }

  private finishStage(
    entry: StageEntry,
    exitDay: number,
    exitWeightKg: number,
  ): void {
    const days = exitDay - entry.day;
    if (days <= 0) return;
    const row = this.completed.get(entry.stage)!;
    row.completed += 1;
    row.entryKg += entry.weightKg;
    row.exitKg += exitWeightKg;
    row.days += days;
    row.gainKg += Math.max(0, exitWeightKg - entry.weightKg);
  }

  result(config: PlannerConfig): GrowthSimulationSummary {
    const configured: Record<ProductionGrowthStage, number> = {
      piglet: config.growth.pigletDailyGainKg,
      weaner: config.growth.weanerDailyGainKg,
      grower: config.growth.growerDailyGainKg,
      finisher: config.growth.finisherDailyGainKg,
    };

    return {
      checkpoints: GROWTH_CHECKPOINT_AGES.map((ageDays) => {
        const weights = this.checkpointWeights.get(ageDays) ?? [];
        return {
          ageDays,
          sampleSize: weights.length,
          meanWeightKg: mean(weights),
          p10WeightKg: quantile(weights, 0.1),
          medianWeightKg: quantile(weights, 0.5),
          p90WeightKg: quantile(weights, 0.9),
          cvPct: cvPct(weights),
        };
      }),
      stages: PRODUCTION_STAGES.map((stage) => {
        const row = this.completed.get(stage)!;
        return {
          stage,
          completed: row.completed,
          meanEntryWeightKg:
            row.completed > 0 ? row.entryKg / row.completed : 0,
          meanExitWeightKg:
            row.completed > 0 ? row.exitKg / row.completed : 0,
          meanDays: row.completed > 0 ? row.days / row.completed : 0,
          observedAdgKg: row.days > 0 ? row.gainKg / row.days : 0,
          configuredAdgKg: configured[stage],
        };
      }),
      market: {
        sold: this.saleAges.length,
        meanAgeDays: mean(this.saleAges),
        p10AgeDays: quantile(this.saleAges, 0.1),
        medianAgeDays: quantile(this.saleAges, 0.5),
        p90AgeDays: quantile(this.saleAges, 0.9),
        meanWeightKg: mean(this.saleWeights),
        p10WeightKg: quantile(this.saleWeights, 0.1),
        medianWeightKg: quantile(this.saleWeights, 0.5),
        p90WeightKg: quantile(this.saleWeights, 0.9),
        meanLifetimeAdgKg: mean(this.lifetimeAdg),
      },
    };
  }
}
