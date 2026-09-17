import { z } from "zod";

const nonNegative = z.number().finite().min(0);
const percentage = z.number().finite().min(0).max(100);

export const vaccinationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ageDays: z.number().finite().min(0).max(400),
  costPerPig: nonNegative,
  /**
   * What sort of job this is. Both are booked the same way and cost the same
   * way; they are told apart so that the log reads as a stockperson's day —
   * iron and castration are processing, a needle against a disease is not.
   */
  kind: z.enum(["vaccination", "processing"]).default("vaccination"),
  /**
   * Which piglets it is done to. Castration is the reason this exists: a job
   * done to half the litter costs half as much as one done to all of it, and a
   * plan that plays it across every pig overstates the bill.
   */
  appliesTo: z.enum(["all", "males", "females"]).default("all"),
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
    /**
     * Whether the plan rolls for its outcomes or takes its rates exactly.
     *
     * "chance" draws litter size, conception, gestation, weaning-to-service,
     * sex and thriftiness from the seed, so one run is a plausible farm rather
     * than the average of many — and the seed is what you change to see a
     * different year's luck.
     *
     * "settled" draws nothing. Every rate is taken as stated and a rate that
     * does not come to a whole animal carries its remainder to the next one
     * until it does, so a herd at 12.4 born alive farrows 12, 12, 13, 12, 13.
     * The plan then has one answer rather than a spread of them, the seed does
     * nothing, and two plans can be read off side by side.
     */
    variation: z.enum(["chance", "settled"]).default("chance"),
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
    /**
     * Puberty: the age and weight at which a gilt starts cycling. She is not
     * served at her first standing heat — she is recorded at it, and bred a
     * cycle or two later, by which time she is carrying the condition to hold a
     * litter and rear it.
     */
    giltPubertyAgeDays: z.number().min(140).max(280),
    giltPubertyWeightKg: z.number().min(60).max(140),
    /**
     * Which standing heat she is bred on. 1 is her first, which is the practice
     * that costs a herd its second litter; 2 or 3 is the usual target, and is
     * what puts service a cycle or two past puberty rather than on a date.
     */
    giltServeAtHeat: z.number().int().min(1).max(5),
    /**
     * Floors, not targets. A gilt is bred on the first standing heat at or past
     * the one above on which she also clears both of these, so raising either
     * pushes her to the next heat rather than to the next day.
     */
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
    /**
     * Of the services that do not hold, the share that come back late rather
     * than on the next cycle. A regular return is a service that simply did not
     * take and shows at the next heat; an irregular one is an embryo lost after
     * it had started, and she comes back a week or two later than that. The
     * difference matters to a plan because a late return is a heat's worth of
     * feed with nothing at the end of it.
     */
    irregularReturnSharePct: percentage,
    /**
     * Days after service that a sow is scanned. Commonly 26-30: earlier than
     * that reads too many false empties, later wastes the days a sow found
     * empty could have spent getting back in pig.
     */
    pregnancyScanDays: z.number().int().min(21).max(45),
    /** What one scan costs, charged whatever it finds. 0 turns scanning off. */
    pregnancyScanCost: nonNegative,
    bornAlivePerLitter: z.number().min(1).max(25),
    preWeanMortalityPct: percentage,
  }),
  /**
   * How the herd is served. Natural service is the boar team; artificial
   * insemination is semen bought in from a stud, which costs money per service
   * but stands no boar, eats nothing and is related to nothing on the farm.
   */
  service: z.object({
    /**
     * Whether semen can be bought at all. Off, the farm is exactly the natural
     * service herd it has always been. On, AI also acts as the release valve
     * for the two things that otherwise defer a service: a boar team that is
     * fully worked for the week, and a female whose only mate standing is one
     * of her own ancestors.
     */
    useAi: z.boolean(),
    /**
     * Share of services put to AI as policy, over and above those two rescues.
     * At 0 with AI on, semen is only bought when the boar team cannot cover the
     * service; at 100 the boars still standing are there to find heats rather
     * than to work.
     */
    aiSharePct: percentage,
    /**
     * What one served sow costs in semen and technician time. It is charged per
     * service, so a service that does not hold is charged again when she comes
     * back three weeks later — which is the real price of a poor hold rate.
     */
    aiCostPerService: nonNegative,
    /**
     * Doses put in over one standing heat. Two, a day apart, is the usual
     * practice. It does not change what a service costs — that is the figure
     * above, for the heat — but it is what the log records, because a service
     * that was one dose rather than two is worth being able to see.
     */
    aiInseminationsPerService: z.number().int().min(1).max(3),
    /**
     * Points added to the conception rate when the service is AI rather than
     * natural. Negative on a unit whose heat detection is weak, positive where
     * stud semen outperforms a tired boar. 0 treats both channels alike.
     */
    aiConceptionDeltaPct: z.number().min(-30).max(30),
    /**
     * How many stud lines the semen comes from. The panel is rotated the way the
     * boar team is, and a stud is barred from a female for exactly the same
     * generations a boar is, so AI cannot quietly re-introduce the mating the
     * boar rota exists to prevent.
     */
    aiStudPanelSize: z.number().int().min(1).max(20),
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
    /**
     * How a stage's mortality percentage is spread across that stage. The
     * percentage itself stays the input; this only says when inside the stage
     * those losses land. "profiled" follows the shape a herd really loses stock
     * in — heavily in the first days of life and over the weaning check — while
     * "even" spreads them flat across the stage.
     */
    mortalityTiming: z.enum(["profiled", "even"]).default("profiled"),
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
/**
 * When a sow comes back after a service that did not hold. A regular return is
 * the next cycle — three weeks, give or take a few days for how tightly heats
 * are read. An irregular one is an embryo lost after implantation had started,
 * which puts her back a week or two beyond that, and is the return a herd
 * notices because it is the one that costs it a farrowing slot.
 */
export const REGULAR_RETURN_DAYS = { min: 18, max: 24 } as const;
export const IRREGULAR_RETURN_DAYS = { min: 25, max: 38 } as const;
/** Liveweight of a piglet at birth, used to grow suckling pigs to weaning weight. */
export const BIRTH_WEIGHT_KG = 1.4;
/** Natural services one working boar can cover in a week. */
export const SERVICES_PER_BOAR_PER_WEEK = 5;
/**
 * How many generations of a female's paternal line bar a sire from serving her.
 * 1 is her own sire; 2 adds the maternal grandsire, which a boar standing a full
 * working life can reach — his granddaughters come to service at around day 708
 * on the default cycle, and he is not rotated off until day 730.
 *
 * Because boars are only ever bought in and never bred on the farm, a boar
 * shares no ancestry with anything here except the females he has sired himself.
 * Barring a female's paternal line is therefore the whole of relatedness in this
 * model rather than an approximation of it.
 */
export const ANCESTRY_EXCLUSION_DEPTH = 2;
/**
 * The age a gilt is actually served at under this plan: puberty, plus the
 * cycles she is held back for. The weight and age floors can push her past it,
 * never before it, so this is the earliest the plan can breed her — and it is
 * what a herd means by "gilts served at 230 days", rather than the floors.
 */
export function expectedGiltServiceAgeDays(config: PlannerConfig): number {
  const { giltPubertyAgeDays, giltServeAtHeat } = config.herd;
  return Math.max(
    config.herd.giltServiceAgeDays,
    giltPubertyAgeDays + (giltServeAtHeat - 1) * ESTRUS_CYCLE_DAYS,
  );
}
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

/**
 * The jobs a piglet is put through, and the needles it is given, in the order
 * its age brings them round. Processing a litter is ordinary indoor practice
 * and ordinary indoor cost; a plan that leaves it out is short by it.
 *
 * Teeth and tails are here because many units do them and a plan has to be able
 * to cost them. A unit that does not is a row deleted, not a setting.
 */
export const DEFAULT_VACCINATIONS: Vaccination[] = [
  { id: "navel", name: "Navel dressing", ageDays: 0, costPerPig: 0.05, kind: "processing", appliesTo: "all" },
  { id: "teeth", name: "Teeth reduction", ageDays: 1, costPerPig: 0.05, kind: "processing", appliesTo: "all" },
  { id: "ident", name: "Identification", ageDays: 1, costPerPig: 0.12, kind: "processing", appliesTo: "all" },
  { id: "iron", name: "Iron injection", ageDays: 3, costPerPig: 0.35, kind: "processing", appliesTo: "all" },
  { id: "tail", name: "Tail docking", ageDays: 3, costPerPig: 0.06, kind: "processing", appliesTo: "all" },
  { id: "castration", name: "Castration", ageDays: 5, costPerPig: 0.3, kind: "processing", appliesTo: "males" },
  { id: "mycoplasma", name: "Mycoplasma", ageDays: 21, costPerPig: 1.1, kind: "vaccination", appliesTo: "all" },
  { id: "circovirus", name: "PCV2 / circovirus", ageDays: 42, costPerPig: 1.4, kind: "vaccination", appliesTo: "all" },
  { id: "deworm", name: "Deworming", ageDays: 70, costPerPig: 0.45, kind: "vaccination", appliesTo: "all" },
];

export const DEFAULT_CONFIG: PlannerConfig = {
  project: {
    name: "My piggery plan",
    startDate: "2027-01-01",
    months: 36,
    currency: "USD",
    openingCash: 0,
    seed: 1,
    variation: "chance",
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
    giltPubertyAgeDays: 195,
    giltPubertyWeightKg: 95,
    giltServeAtHeat: 2,
    giltServiceWeightKg: 135,
    giltServiceAgeDays: 200,
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
    irregularReturnSharePct: 25,
    pregnancyScanDays: 28,
    pregnancyScanCost: 1.5,
    bornAlivePerLitter: 12.4,
    preWeanMortalityPct: 12.5,
  },
  service: {
    useAi: false,
    aiSharePct: 0,
    aiCostPerService: 50,
    aiInseminationsPerService: 2,
    aiConceptionDeltaPct: 0,
    aiStudPanelSize: 4,
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
    mortalityTiming: "profiled",
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
