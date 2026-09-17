import { z } from "zod";

const nonNegative = z.number().finite().min(0);
const percentage = z.number().finite().min(0).max(100);

export const vaccinationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ageDays: z.number().finite().min(0).max(400),
  costPerPig: nonNegative,
});

export type Vaccination = z.infer<typeof vaccinationSchema>;

/**
 * An income or cost the owner adds to one month by hand, for the things a herd
 * model cannot know about — a grant, a repair, a licence. Money in joins other
 * income and money out joins fixed overheads, so it is planned and reported the
 * same way as everything else the farm receives and pays. The kind is held apart
 * from the amount so a row can sit at zero while it is being typed.
 */
const cashMovementSchema = z.object({
  id: z.string().min(1).max(40),
  monthIndex: z.number().int().min(0).max(359),
  kind: z.enum(["in", "out"]),
  amount: nonNegative,
  note: z.string().max(80),
  /**
   * True for the rows the funding buttons write. A row you type is a farm item —
   * a grant, a repair — and is costed like one. A generated row is financing:
   * it moves cash without the farm having earned or spent anything, so it is
   * kept out of the contingency and out of what a pig costs to produce.
   */
  auto: z.boolean().default(false),
});

export type CashMovement = z.infer<typeof cashMovementSchema>;

export const plannerSchema = z.object({
  project: z.object({
    name: z.string().min(1),
    startDate: z.string().min(10),
    months: z.number().int().min(12).max(120),
    currency: z.enum(["USD", "ZAR", "GBP", "EUR"]),
    openingCash: z.number().finite(),
    seed: z.number().int().min(1).max(1_000_000),
  }),
  stock: z.object({
    sows: nonNegative,
    gilts: nonNegative,
    boars: nonNegative,
    weaners: nonNegative,
    growers: nonNegative,
    finishers: nonNegative,
  }),
  herd: z.object({
    startMode: z.enum(["staggered", "synchronised"]),
    maxSows: z.number().int().min(1).max(5000),
    cullAfterParity: z.number().int().min(1).max(12),
    retainHomeBredGilts: z.boolean(),
    buyGiltsWhenShort: z.boolean(),
    sowAnnualMortalityPct: percentage,
    giltSelectionWeightKg: z.number().min(15).max(90),
    giltServiceWeightKg: z.number().min(90).max(180),
    giltServiceAgeDays: z.number().min(180).max(400),
    giltPurchaseCost: nonNegative,
    boarPurchaseCost: nonNegative,
    boarWorkingLifeMonths: z.number().int().min(6).max(72),
    surplusGiltSaleValue: nonNegative,
    cullSowSaleValue: nonNegative,
  }),
  housing: z.object({
    farrowingPlaces: z.number().int().min(1).max(100_000),
    weanerPlaces: z.number().int().min(1).max(100_000),
    growerPlaces: z.number().int().min(1).max(100_000),
    finisherPlaces: z.number().int().min(1).max(100_000),
  }),
  reproduction: z.object({
    gestationDays: z.number().min(110).max(122),
    weaningAgeDays: z.number().min(18).max(56),
    weanToServiceDays: z.number().min(3).max(35),
    farrowingSuccessPct: percentage,
    bornAlivePerLitter: z.number().min(1).max(25),
    preWeanMortalityPct: percentage,
  }),
  growth: z.object({
    weaningWeightKg: z.number().min(2).max(20),
    growerStartWeightKg: z.number().min(15).max(60),
    finisherStartWeightKg: z.number().min(35).max(100),
    saleWeightKg: z.number().min(50).max(180),
    weanerDailyGainKg: z.number().min(0.1).max(1.2),
    growerDailyGainKg: z.number().min(0.2).max(1.5),
    finisherDailyGainKg: z.number().min(0.2).max(1.5),
    /**
     * Feed a pig eats before it grows at all, quoted for a 100 kg pig and read
     * off metabolic weight for every other size. A pig carries more body to
     * keep the heavier it gets, which is half of why conversion worsens as it
     * fills out.
     */
    upkeepFeedKgAt100Kg: z.number().min(0.3).max(3),
    /**
     * What a kilogram of gain costs in feed, upkeep aside, at 20 kg and at
     * 100 kg. Early gain is lean and largely water and comes cheap; late gain
     * carries fat, which costs several times as much to lay down. Between the
     * two the price of a kilogram is read off the straight line, which is the
     * other half of why conversion worsens with weight.
     */
    gainFeedKgAt20Kg: z.number().min(0.6).max(3),
    gainFeedKgAt100Kg: z.number().min(1).max(5),
    weanerMortalityPct: percentage,
    growerMortalityPct: percentage,
    finisherMortalityPct: percentage,
  }),
  feed: z.object({
    gestationKgDay: z.number().min(0.5).max(8),
    lactationKgDay: z.number().min(1).max(15),
    boarKgDay: z.number().min(0.5).max(8),
    creepStartAgeDays: z.number().min(0).max(56),
    creepKgPerPigDay: z.number().min(0).max(1),
    sowFeedCostKg: nonNegative,
    creepFeedCostKg: nonNegative,
    weanerFeedCostKg: nonNegative,
    growerFeedCostKg: nonNegative,
    finisherFeedCostKg: nonNegative,
    truckCapacityKg: z.number().min(100).max(30_000),
    deliveryCostPerTrip: nonNegative,
    feedBufferDays: z.number().int().min(1).max(120),
  }),
  health: z.object({
    vaccinations: z.array(vaccinationSchema).max(16),
    vetCostPerSowMonth: nonNegative,
    heatingCostPerPigDay: nonNegative,
    heatedUntilAgeDays: z.number().min(0).max(120),
  }),
  finance: z.object({
    salePriceKg: nonNegative,
    dressingPct: z.number().min(45).max(90),
    /**
     * The lorry that takes sold pigs to the abattoir on the day they go. How
     * often it runs is the head sold over what it holds — the farm's haulage
     * ends at the abattoir, and the legs beyond it belong to other businesses.
     */
    marketTruckCapacityPigs: z.number().int().min(1).max(500),
    marketTripCost: nonNegative,
    labourCostPerWorkerMonth: nonNegative,
    pigsPerWorker: z.number().min(20).max(5000),
    minimumWorkers: z.number().int().min(0).max(100),
    utilitiesMonthly: nonNegative,
    beddingMonthly: nonNegative,
    biosecurityMonthly: nonNegative,
    otherFixedMonthly: nonNegative,
    otherIncomeMonthly: nonNegative,
    initialCapitalCosts: nonNegative,
    contingencyPct: percentage,
    /** Cash the business is meant to keep in hand once surplus is taken out. */
    workingCapitalTarget: nonNegative,
    cashMovements: z.array(cashMovementSchema).max(240),
  }),
});

export type PlannerConfig = z.infer<typeof plannerSchema>;
export type PlannerSection = keyof PlannerConfig;

/** Mean length of a calendar month, for turning months of policy into days. */
export const DAYS_PER_MONTH = 30.4375;
/** Days between returns to estrus when a service does not hold. */
export const ESTRUS_CYCLE_DAYS = 21;
/** Liveweight of a piglet at birth, used to grow suckling pigs to weaning weight. */
export const BIRTH_WEIGHT_KG = 1.4;
/** Natural services one working boar can cover in a week. */
export const SERVICES_PER_BOAR_PER_WEEK = 5;
/** Days a bought-in gilt acclimatises before her first service. */
export const GILT_ACCLIMATISATION_DAYS = 14;
/** Age at which a purchased replacement gilt joins the breeding herd. */
export const GILT_ENTRY_AGE_DAYS = 240;
/** Entire males eat and grow this much more than the herd average; gilts, less. */
export const MALE_GROWTH_FACTOR = 1.04;
export const FEMALE_GROWTH_FACTOR = 0.96;
/**
 * Share of a selected gilt's restricted ration that goes to upkeep, and so moves
 * with her weight. Market pigs are not fed this way: what they eat is built up
 * from the feed curve in growth-curve.ts, upkeep and gain separately.
 */
export const MAINTENANCE_SHARE = 0.4;
/** Daily gain of a selected gilt once she is on a restricted developer ration. */
export const GILT_DAILY_GAIN_KG = 0.6;
/** Reference weight a sow's daily ration is quoted at. */
export const MATURE_SOW_WEIGHT_KG = 210;
export const SOW_WEIGHT_GAIN_PER_PARITY_KG = 12;
export const MAX_SOW_WEIGHT_KG = 260;
export const BOAR_WEIGHT_KG = 250;

export const DEFAULT_VACCINATIONS: Vaccination[] = [
  { id: "iron", name: "Iron injection", ageDays: 3, costPerPig: 0.35 },
  { id: "mycoplasma", name: "Mycoplasma", ageDays: 21, costPerPig: 1.1 },
  { id: "circovirus", name: "PCV2 / circovirus", ageDays: 42, costPerPig: 1.4 },
  { id: "deworm", name: "Deworming", ageDays: 70, costPerPig: 0.45 },
];

export const DEFAULT_CONFIG: PlannerConfig = {
  project: {
    name: "My piggery plan",
    startDate: "2027-01-01",
    months: 36,
    currency: "USD",
    openingCash: 0,
    seed: 1,
  },
  stock: {
    sows: 2,
    gilts: 0,
    boars: 1,
    weaners: 0,
    growers: 0,
    finishers: 0,
  },
  herd: {
    startMode: "synchronised",
    maxSows: 20,
    cullAfterParity: 6,
    retainHomeBredGilts: true,
    buyGiltsWhenShort: false,
    sowAnnualMortalityPct: 8,
    giltSelectionWeightKg: 30,
    giltServiceWeightKg: 140,
    giltServiceAgeDays: 240,
    giltPurchaseCost: 350,
    boarPurchaseCost: 600,
    boarWorkingLifeMonths: 24,
    surplusGiltSaleValue: 320,
    cullSowSaleValue: 200,
  },
  housing: {
    farrowingPlaces: 6,
    weanerPlaces: 56,
    growerPlaces: 44,
    finisherPlaces: 111,
  },
  reproduction: {
    gestationDays: 115,
    weaningAgeDays: 28,
    weanToServiceDays: 7,
    farrowingSuccessPct: 85,
    bornAlivePerLitter: 12.4,
    preWeanMortalityPct: 12.5,
  },
  growth: {
    weaningWeightKg: 7.5,
    growerStartWeightKg: 30,
    finisherStartWeightKg: 60,
    saleWeightKg: 100,
    weanerDailyGainKg: 0.45,
    growerDailyGainKg: 0.7,
    finisherDailyGainKg: 0.85,
    upkeepFeedKgAt100Kg: 1.05,
    gainFeedKgAt20Kg: 1.1,
    gainFeedKgAt100Kg: 2.35,
    weanerMortalityPct: 2,
    growerMortalityPct: 1.5,
    finisherMortalityPct: 1.5,
  },
  feed: {
    gestationKgDay: 2.4,
    lactationKgDay: 6,
    boarKgDay: 2.5,
    creepStartAgeDays: 14,
    creepKgPerPigDay: 0.05,
    sowFeedCostKg: 0.56,
    creepFeedCostKg: 1.2,
    weanerFeedCostKg: 0.68,
    growerFeedCostKg: 0.56,
    finisherFeedCostKg: 0.52,
    truckCapacityKg: 2_500,
    deliveryCostPerTrip: 60,
    feedBufferDays: 7,
  },
  health: {
    vaccinations: DEFAULT_VACCINATIONS,
    vetCostPerSowMonth: 2.5,
    heatingCostPerPigDay: 0.04,
    heatedUntilAgeDays: 56,
  },
  finance: {
    salePriceKg: 3.5,
    dressingPct: 70,
    marketTruckCapacityPigs: 22,
    marketTripCost: 140,
    labourCostPerWorkerMonth: 300,
    pigsPerWorker: 250,
    minimumWorkers: 1,
    utilitiesMonthly: 80,
    beddingMonthly: 50,
    biosecurityMonthly: 50,
    otherFixedMonthly: 100,
    otherIncomeMonthly: 0,
    initialCapitalCosts: 8_000,
    contingencyPct: 5,
    workingCapitalTarget: 0,
    cashMovements: [],
  },
};

/**
 * Carcass weight, which is what an abattoir pays for. Sale price is quoted per
 * kilogram deadweight, so a pig's liveweight is dressed out before it is priced.
 */
export function deadweightKg(liveweightKg: number, config: PlannerConfig): number {
  return liveweightKg * (config.finance.dressingPct / 100);
}

/** Stockpeople needed to run a herd of this many head, never fewer than the floor. */
export function workersNeeded(totalHead: number, config: PlannerConfig): number {
  const perWorker = Math.max(config.finance.pigsPerWorker, 1);
  return Math.max(config.finance.minimumWorkers, Math.ceil(totalHead / perWorker));
}

export function cloneDefaultConfig(): PlannerConfig {
  return structuredClone(DEFAULT_CONFIG);
}

/**
 * Merges a stored plan over the defaults so that plans saved before a field was
 * added still load instead of being discarded.
 */
export function withConfigDefaults(value: unknown): PlannerConfig | null {
  if (!value || typeof value !== "object") return null;
  const stored = value as Record<string, unknown>;
  const merged = cloneDefaultConfig() as unknown as Record<string, Record<string, unknown>>;
  for (const section of Object.keys(merged)) {
    const storedSection = stored[section];
    if (storedSection && typeof storedSection === "object") {
      merged[section] = { ...merged[section], ...(storedSection as Record<string, unknown>) };
    }
  }
  // Older plans predate explicit housing inputs. Preserve the capacity they
  // previously saw on the dashboard by scaling the old planning ratios once,
  // then store those values as ordinary user-editable places from here on.
  if (!("housing" in stored)) {
    const storedHerd = stored.herd as Record<string, unknown> | undefined;
    const maxSows = typeof storedHerd?.maxSows === "number"
      ? storedHerd.maxSows
      : DEFAULT_CONFIG.herd.maxSows;
    merged.housing = {
      farrowingPlaces: Math.max(1, Math.ceil(maxSows * 0.3)),
      weanerPlaces: Math.max(1, Math.ceil(maxSows * 2.8)),
      growerPlaces: Math.max(1, Math.ceil(maxSows * 2.16)),
      finisherPlaces: Math.max(1, Math.ceil(maxSows * 5.52)),
    };
  }
  const parsed = plannerSchema.safeParse(merged);
  return parsed.success ? parsed.data : null;
}
