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
  /**
   * Doses to a pack, for the jobs that come in one. A vial is opened for the
   * litter in front of you and what is left in it is thrown away, so a unit
   * buying fifty-dose vials for litters of twelve pays for fifty. 1 means the
   * job is bought by the dose and nothing is wasted.
   */
  dosesPerPack: z.number().int().min(1).max(500).default(1),
  /**
   * Days an opened pack keeps. What limits a vaccine is not how much of it will
   * fit anywhere — it is the clock that starts when the vial is broached. Doses
   * still in it when that runs out are thrown away and the next litter opens a
   * fresh one. 0 means it does not expire, which is what a job bought by the
   * dose needs.
   */
  openPackKeepsDays: z.number().int().min(0).max(365).default(0),
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
    months: z.number().int().min(12).max(240),
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
    /**
     * Which simulation engine runs the plan.
     *
     * "1.x" is the farm this product has always run on: one daily procedure,
     * every input a rate, housing and inventory reported rather than simulated.
     * It is the baseline, it is not going anywhere, and it is what a 2.0 result
     * is read against.
     *
     * "2.0" is the engine being built alongside it — explicit world state,
     * independent systems, domain events, and resources that can actually run
     * out. Its new subsystems are switched on one at a time, so that what each
     * one changes can be seen on its own rather than all at once.
     */
    engine: z.enum(["1.x", "2.0"]).default("1.x"),
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
    /**
     * Reserved switch for the experimental constrained-housing subsystem.
     * Production plans currently force this off: places are reported against
     * occupancy but do not block movement between stages.
     */
    enforceCapacity: z.boolean().default(false),
    /**
     * Daily gain lost when a room holds twice the stock it has places for.
     * Crowded pigs eat less, lie worse and fight more. The loss is read off the
     * stocking ratio in proportion, so a room a fifth over its places loses a
     * fifth of this. Gilts and the breeding herd are housed apart and are not
     * affected.
     */
    crowdingGainPenaltyPct: percentage.default(35),
    /**
     * Extra mortality at twice the places, as a percentage of the stage's own
     * rate. 100 means a room at double stocking loses twice as many pigs as the
     * plan's figure; 0 turns the health consequence off and leaves the gain one.
     */
    crowdingMortalityPenaltyPct: z.number().finite().min(0).max(500).default(100),
    /**
     * Bedding used per head per day. It was a flat monthly figure, which meant a
     * twenty sow herd and a two hundred sow herd bedded down for the same money.
     * It is per head because that is what it is: straw or shavings under the
     * animals actually housed.
     */
    beddingKgPerHeadDay: z.number().min(0).max(10),
    beddingCostPerKg: nonNegative,
    /** What one load of bedding brings, and what the trip costs. */
    beddingLoadKg: z.number().min(10).max(50_000),
    beddingDeliveryCost: nonNegative,
    /** What the bedding store holds, which is what caps a delivery into it. */
    beddingStoreKg: z.number().min(10).max(500_000).default(2_000),
  }),
  reproduction: z.object({
    gestationDays: z.number().min(110).max(122),
    weaningAgeDays: z.number().min(18).max(56),
    weanToServiceDays: z.number().min(3).max(35),
    farrowingSuccessPct: percentage,
    /**
     * Days a standing heat can be served in. A sow is not due for service for
     * ever after her date: she stands for two or three days and then she is
     * gone for three weeks. Anything the farm cannot manage inside the window —
     * spotting her, finding her a mate, getting a technician to her — costs a
     * whole cycle rather than a day.
     */
    serviceWindowDays: z.number().int().min(1).max(5).default(2),
    /**
     * Whether that window is a wall. Off — and off is what the 1.x engine
     * does — a sow due for service stays due for service on every day after her
     * date, so a held-up service costs a day. On, the window closes and the next
     * one is a cycle away, which is what a missed heat really costs.
     *
     * 2.0 only. The 1.x engine does not read it.
     */
    enforceEstrusWindows: z.boolean().default(true),
    /**
     * Share of standing heats the unit actually spots. Detection is not
     * conception: a heat that is missed is a cycle lost with no service to show
     * for it, which is why a herd with poor heat detection carries a long
     * farrowing interval and a perfectly ordinary conception rate.
     */
    heatDetectionPct: percentage.default(92),
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
    /** Confirmed pregnancies subsequently lost before term. */
    pregnancyLossPct: percentage.default(3),
    bornAlivePerLitter: z.number().min(1).max(25),
    /** Percentages of total-born piglets recorded as non-viable at farrowing. */
    stillbornPct: percentage.default(6),
    mummifiedPct: percentage.default(1.5),
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
    /**
     * The weight this genotype stops growing at. A pig is not a line on a
     * graph: it slows as it fills out and settles at its mature size, and a
     * market pig is sold less than a third of the way there, which is why the
     * tabled daily gains say nothing about what happens past sale weight.
     *
     * It matters when a pig does not leave on time. Without it a pig held back
     * for want of a finishing place gained 0.85 kg a day for as long as it stood
     * there and passed 500 kg, which is not an animal — and it ate, was insured,
     * was valued and was costed as one. 0 turns it off, which is the 1.x rule.
     */
    matureWeightKg: z.number().min(0).max(600).default(320),
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
    /**
     * What a bag of feed holds. Feed is bought by the bag and not by the
     * kilogram, so an order is a whole number of them and a bin with room for
     * three quarters of a bag has room for none. 0 is feed delivered loose and
     * blown into the bin, which is how a unit big enough to take bulk buys it.
     */
    feedBagKg: z.number().min(0).max(1_000).default(50),
    /**
     * What the lorry will carry. There is no weight held back on it for the
     * sundries any more: gas queues for space against the feed on the same
     * terms, by how soon the farm runs out of it, so it cannot be crowded off a
     * deck by an order that was merely larger. Nor is there any held back for
     * the vet's box — vaccines and medicines weigh nothing worth hauling and
     * are costed by the dose rather than carried as a store.
     */
    truckCapacityKg: z.number().min(100).max(30_000),
    deliveryCostPerTrip: nonNegative,
    /**
     * Days of cover at which a store is due, which is what sends a lorry. Every
     * other store close to running out is loaded onto the same one.
     */
    feedBufferDays: z.number().int().min(1).max(120),
    /**
     * How the farm buys its feed.
     *
     * "operational" is the farm: orders are placed from what is in the bin
     * today and what has been eaten lately, they take the supplier's lead time
     * to arrive, the bin holds only so much, and a store that runs dry
     * restricts what the herd eats until an emergency load lands.
     *
     * "foresight" is the benchmark: the plan is run once to see what the herd
     * will eat, and the lorries are then cut to fit it exactly. Nothing ever
     * runs out and nothing is delivered that is not used — the best case
     * logistics can reach, rather than a simulation of them.
     */
    procurementMode: z.enum(["foresight", "operational"]).default("operational"),
    /**
     * Which operating policy places the orders, once the farm is buying
     * operationally at all.
     *
     * "balanced-load" is the capacity-balanced operating rule and the default: a
     * due store justifies the trip, then the available vehicle payload is shared
     * so the compatible stores approach their next safety-stock dates together.
     * The resulting cover period is an output, not a setting. Benchmarked
     * against V1 perfect foresight over three, five, ten and twenty years it
     * matches or beats it on journeys, cost and stock held.
     *
     * "rolling-cover" is the earlier fixed-cover experiment. It forecasts the
     * herd and buys every compatible store up to one configured common date,
     * which costs it about a fifth more journeys than it needs.
     *
     * "reorder-point" — the old rule that read appetite off the last week of
     * consumption and could not see a farrowing coming — has been withdrawn.
     * Plans that stored it are migrated to "balanced-load" by
     * {@link withConfigDefaults}.
     */
    operationalPolicy: z
      .enum(["rolling-cover", "balanced-load"])
      .default("balanced-load"),
    /**
     * Legacy fixed-cover target used only by the "rolling-cover" policy. The
     * capacity-balanced policy deliberately ignores this value.
     */
    rollingTargetCoverDays: z.number().int().min(14).max(180).default(90),
    /**
     * Demand buffer kept ahead of physical zero. Forecast policies use this to
     * decide when a store becomes operationally at risk; it is not itself a
     * replenishment target.
     */
    safetyCoverDays: z.number().int().min(0).max(30).default(3),
    /**
     * Loads the farm can take in on one day — the supplier's throughput and the
     * yard's, which is not the same thing as what one lorry carries.
     *
     * Fixed-cover planning may spill a single order across several days to reach
     * its target. Balanced-load sends one lorry and stops, unless that lorry
     * left full and a store still cannot be held through the delivery lead time
     * — which is what happens once a herd eats more in a day than a deck
     * carries. Then it sends another, and another, up to this many.
     *
     * On a small farm the ceiling is never reached and the value does not
     * matter. On a large one it is what decides whether the herd is fed, so it
     * is asked about rather than assumed.
     */
    maxSupplyTripsPerDay: z.number().int().min(1).max(100).default(3),
    /**
     * Days of cover an order is sized to bring a store back up to.
     *
     * Two things read it. Perfect-foresight planning sizes its orders on it, so
     * it still sets the shape of the benchmark run. Operational planning uses it
     * only to stock the bins before day one — neither remaining policy buys to a
     * fixed cover afterwards, so past the opening order it does nothing on an
     * operational plan.
     */
    targetCoverDays: z.number().int().min(2).max(240).default(21),
    /** Days between placing an order and the lorry coming through the gate. */
    deliveryLeadDays: z.number().int().min(0).max(60).default(3),
    /** Below this a supplier will not send a lorry, so a small order rounds up. */
    minimumOrderKg: z.number().min(0).max(30_000).default(500),
    /** What one ration's bin holds, which is what caps a delivery into it. */
    binCapacityKg: z.number().min(50).max(500_000).default(6_000),
    /** Days after delivery that the supplier's invoice is paid. */
    supplierPaymentDays: z.number().int().min(0).max(180).default(30),
    /** Lead time on an emergency load, ordered the day a store runs dry. */
    emergencyLeadDays: z.number().int().min(0).max(14).default(1),
    /** What an emergency load costs over the list price, on goods and journey. */
    emergencyPremiumPct: z.number().finite().min(0).max(300).default(35),
  }),
  health: z.object({
    vaccinations: z.array(vaccinationSchema).max(16),
    vetCostPerSowMonth: nonNegative,
    /**
     * Gas a heated piglet burns in a day, and what the gas costs. This used to
     * be one figure in money, which could not be delivered, stored or run out
     * of. Splitting it lets the tanker be a real trip and the tank a real store,
     * and lets a plan correct a usage rate and a gas price separately.
     */
    gasKgPerHeaterDay: z.number().min(0).max(50),
    pigletsPerHeater: z.number().int().min(1).max(100),
    gasCostPerKg: nonNegative,
    /**
     * One canister, and how many the farm can hold. Gas is not a tank that can
     * be topped up: it is bottles, and a second one has nowhere to go until the
     * first is empty enough to make room. A delivery therefore waits for space
     * rather than arriving the buffer early like feed does.
     */
    gasCanisterKg: z.number().min(1).max(500),
    gasCanisters: z.number().int().min(1).max(20),
    heatedUntilAgeDays: z.number().min(0).max(120),
    /**
     * How a stage's mortality percentage is spread across that stage. The
     * percentage itself stays the input; this only says when inside the stage
     * those losses land. "profiled" follows the shape a herd really loses stock
     * in — heavily in the first days of life and over the weaning check — while
     * "even" spreads them flat across the stage.
     */
    mortalityTiming: z.enum(["profiled", "even"]).default("profiled"),
    /** Growing pigs treated in a typical year, independent of fatal losses. */
    treatmentAnnualPct: percentage.default(12),
    treatmentCostPerPig: nonNegative.default(8.5),
    treatmentGrowthPenaltyDays: z.number().int().min(0).max(60).default(7),
    treatmentGrowthPenaltyPct: percentage.default(35),
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
    biosecurityMonthly: nonNegative,
    otherFixedMonthly: nonNegative,
    otherIncomeMonthly: nonNegative,
    initialCapitalCosts: nonNegative,
    contingencyPct: percentage,
    /** Cash the business is meant to keep in hand once surplus is taken out. */
    workingCapitalTarget: nonNegative,
    /**
     * Whether buying, holding, consuming and paying are four events or one.
     *
     * Off — the 1.x behaviour — feed hits the bank on the day it is eaten, which
     * is neither when it was bought nor when it was paid for. On, a delivery
     * becomes stock and a payable, the supplier is paid on his terms, and the
     * feed is charged to the animals as they eat it, so the cashflow and the
     * profit and loss stop having to be the same statement.
     *
     * 2.0 only. The 1.x engine does not read it.
     */
    accrualAccounting: z.boolean().default(true),
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
  {
    id: "navel",
    name: "Navel dressing",
    ageDays: 0,
    costPerPig: 0.05,
    kind: "processing",
    appliesTo: "all",
    dosesPerPack: 1,
    openPackKeepsDays: 0,
  },
  {
    id: "teeth",
    name: "Teeth reduction",
    ageDays: 1,
    costPerPig: 0.05,
    kind: "processing",
    appliesTo: "all",
    dosesPerPack: 1,
    openPackKeepsDays: 0,
  },
  {
    id: "ident",
    name: "Identification",
    ageDays: 1,
    costPerPig: 0.12,
    kind: "processing",
    appliesTo: "all",
    dosesPerPack: 1,
    openPackKeepsDays: 0,
  },
  {
    id: "iron",
    name: "Iron injection",
    ageDays: 3,
    costPerPig: 0.35,
    kind: "processing",
    appliesTo: "all",
    dosesPerPack: 1,
    openPackKeepsDays: 0,
  },
  {
    id: "tail",
    name: "Tail docking",
    ageDays: 3,
    costPerPig: 0.06,
    kind: "processing",
    appliesTo: "all",
    dosesPerPack: 1,
    openPackKeepsDays: 0,
  },
  {
    id: "castration",
    name: "Castration",
    ageDays: 5,
    costPerPig: 0.3,
    kind: "processing",
    appliesTo: "males",
    dosesPerPack: 1,
    openPackKeepsDays: 0,
  },
  {
    id: "mycoplasma",
    name: "Mycoplasma",
    ageDays: 21,
    costPerPig: 1.1,
    kind: "vaccination",
    appliesTo: "all",
    dosesPerPack: 50,
    openPackKeepsDays: 28,
  },
  {
    id: "circovirus",
    name: "PCV2 / circovirus",
    ageDays: 42,
    costPerPig: 1.4,
    kind: "vaccination",
    appliesTo: "all",
    dosesPerPack: 50,
    openPackKeepsDays: 28,
  },
  {
    id: "deworm",
    name: "Deworming",
    ageDays: 70,
    costPerPig: 0.45,
    kind: "vaccination",
    appliesTo: "all",
    dosesPerPack: 1,
    openPackKeepsDays: 0,
  },
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
    engine: "1.x",
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
    // 0.07 kg a head a day at 0.10 a kilogram comes to about the 50 a month this
    // replaced, at the herd size the default plan carries — but it now moves
    // with the herd instead of standing still.
    beddingKgPerHeadDay: 0.07,
    beddingCostPerKg: 0.1,
    beddingLoadKg: 1_000,
    beddingDeliveryCost: 40,
    beddingStoreKg: 2_000,
    enforceCapacity: false,
    crowdingGainPenaltyPct: 35,
    crowdingMortalityPenaltyPct: 100,
  },
  reproduction: {
    gestationDays: 115,
    weaningAgeDays: 28,
    weanToServiceDays: 7,
    farrowingSuccessPct: 85,
    serviceWindowDays: 2,
    enforceEstrusWindows: true,
    heatDetectionPct: 92,
    irregularReturnSharePct: 25,
    pregnancyScanDays: 28,
    pregnancyScanCost: 1.5,
    pregnancyLossPct: 3,
    bornAlivePerLitter: 12.4,
    stillbornPct: 6,
    mummifiedPct: 1.5,
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
    matureWeightKg: 320,
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
    feedBagKg: 50,
    // The lorry carries 2.8 tonnes, and all of it is loadable: 56 bags of feed,
    // or 55 and a gas bottle. Nothing is held back for sundries because there
    // are none worth the weight — the vet's box does not need a corner of a deck.
    truckCapacityKg: 2_800,
    deliveryCostPerTrip: 60,
    feedBufferDays: 7,
    procurementMode: "operational",
    operationalPolicy: "balanced-load",
    rollingTargetCoverDays: 90,
    safetyCoverDays: 3,
    maxSupplyTripsPerDay: 3,
    targetCoverDays: 21,
    deliveryLeadDays: 3,
    minimumOrderKg: 500,
    binCapacityKg: 6_000,
    supplierPaymentDays: 30,
    emergencyLeadDays: 1,
    emergencyPremiumPct: 35,
  },
  health: {
    vaccinations: DEFAULT_VACCINATIONS,
    vetCostPerSowMonth: 2.5,
    // A heater is either alight or it is not, so gas is burnt by the lamp
    // rather than by the piglet. Two kilograms is a night's run — the twelve
    // dark hours it is actually wanted — and one lamp covers a pen of fourteen.
    gasKgPerHeaterDay: 2,
    pigletsPerHeater: 14,
    gasCostPerKg: 1.8,
    gasCanisterKg: 48,
    gasCanisters: 8,
    heatedUntilAgeDays: 56,
    mortalityTiming: "profiled",
    treatmentAnnualPct: 12,
    treatmentCostPerPig: 8.5,
    treatmentGrowthPenaltyDays: 7,
    treatmentGrowthPenaltyPct: 35,
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
    biosecurityMonthly: 50,
    otherFixedMonthly: 100,
    otherIncomeMonthly: 0,
    initialCapitalCosts: 8_000,
    contingencyPct: 5,
    workingCapitalTarget: 0,
    accrualAccounting: true,
    cashMovements: [],
  },
};

/**
 * Carcass weight, which is what an abattoir pays for. Sale price is quoted per
 * kilogram deadweight, so a pig's liveweight is dressed out before it is priced.
 */
export function deadweightKg(
  liveweightKg: number,
  config: PlannerConfig,
): number {
  return liveweightKg * (config.finance.dressingPct / 100);
}

/** Stockpeople needed to run a herd of this many head, never fewer than the floor. */
export function workersNeeded(
  totalHead: number,
  config: PlannerConfig,
): number {
  const perWorker = Math.max(config.finance.pigsPerWorker, 1);
  return Math.max(
    config.finance.minimumWorkers,
    Math.ceil(totalHead / perWorker),
  );
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
  const merged = cloneDefaultConfig() as unknown as Record<
    string,
    Record<string, unknown>
  >;
  for (const section of Object.keys(merged)) {
    const storedSection = stored[section];
    if (storedSection && typeof storedSection === "object") {
      merged[section] = {
        ...merged[section],
        ...(storedSection as Record<string, unknown>),
      };
    }
  }
  // The reorder-point rule has been withdrawn. A plan saved while it was the
  // default still has the string in it, and the schema no longer accepts it, so
  // without this every such plan fails to load rather than opening on the rule
  // that replaced it. Moving them is safe in the direction it moves them:
  // balanced-load was measured against V1 perfect foresight at three, five, ten
  // and twenty years and is at least as good on journeys, cost and stock held.
  if (merged.feed?.operationalPolicy === "reorder-point") {
    merged.feed.operationalPolicy = "balanced-load";
  }

  // Older plans predate explicit housing inputs. Preserve the capacity they
  // previously saw on the dashboard by scaling the old planning ratios once,
  // then store those values as ordinary user-editable places from here on.
  if (!("housing" in stored)) {
    const storedHerd = stored.herd as Record<string, unknown> | undefined;
    const maxSows =
      typeof storedHerd?.maxSows === "number"
        ? storedHerd.maxSows
        : DEFAULT_CONFIG.herd.maxSows;
    merged.housing = {
      ...DEFAULT_CONFIG.housing,
      farrowingPlaces: Math.max(1, Math.ceil(maxSows * 0.3)),
      weanerPlaces: Math.max(1, Math.ceil(maxSows * 2.8)),
      growerPlaces: Math.max(1, Math.ceil(maxSows * 2.16)),
      finisherPlaces: Math.max(1, Math.ceil(maxSows * 5.52)),
    };
  }
  // Housing remains a planning read-out for now. Stored V2 plans may contain
  // the former experimental switch set to true; do not silently reactivate the
  // upstream queue when those plans are opened under the observation-only model.
  merged.housing.enforceCapacity = false;
  const parsed = plannerSchema.safeParse(merged);
  return parsed.success ? parsed.data : null;
}
