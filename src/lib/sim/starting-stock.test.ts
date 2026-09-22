import { describe, expect, it } from "vitest";

import { inventoryAdjustedProfit, currentProfitOrLoss } from "../accounts";
import {
  cloneDefaultConfig,
  hasDetailedStartingStock,
  openingCounts,
  withConfigDefaults,
  type PlannerConfig,
  type StartingBoarEntry,
  type StartingSowEntry,
  type StartingStockEntry,
  type StartingStockType,
} from "../config";
import { simulatePlan } from "../simulation";
import {
  boarDepreciationAtDay,
  carryingValue,
  inventoryTotal,
  netWorthAtCost,
  sowDepreciationAtParity,
} from "./accounting";
import { Farm } from "./farm";
import { openingStockValue, orphanStartingPiglets } from "./starting-stock";

/**
 * Opening stock the farmer describes, rather than opening stock the model
 * guesses at.
 *
 * Two things are being tested and they pull in opposite directions. The first is
 * that what was entered is what the farm has and what it is carried at: every
 * animal, its value, and the age that says what it weighs and where it stands.
 * The second is that none of it is a transaction — no month is charged for it,
 * no cash moves and no profit appears — because an opening balance that turns up
 * in a profit statement is worse than no opening balance at all.
 */

function plan(overrides: (config: PlannerConfig) => void = () => {}): PlannerConfig {
  const config = cloneDefaultConfig();
  config.project.months = 12;
  config.project.variation = "settled";
  overrides(config);
  return config;
}

/** A plan that starts with nothing at all, to be given starting animals. */
function empty(
  starting: StartingStockEntry[],
  overrides: (config: PlannerConfig) => void = () => {},
): PlannerConfig {
  return plan((draft) => {
    draft.stock = {
      sows: 0,
      gilts: 0,
      boars: 0,
      weaners: 0,
      growers: 0,
      finishers: 0,
      starting,
    };
    overrides(draft);
  });
}

/**
 * Several animals of one kind, entered the way the form enters them: singly.
 *
 * A sow's parity and state and a boar's service are what the kinds differ by,
 * so they are passed through here rather than defaulted out of sight — a test
 * that does not say gets a maiden sow or an unworked boar, and says so.
 */
function each(
  type: StartingStockType,
  count: number,
  openingValue: number,
  ageDays: number,
  history: Partial<Omit<StartingSowEntry, "type"> & Omit<StartingBoarEntry, "type">> = {},
): StartingStockEntry[] {
  return Array.from({ length: count }, (_, index) => {
    const animal = { id: `${type}-${openingValue}-${index}`, ageDays, openingValue };
    if (type === "sow") {
      return {
        ...animal,
        type,
        parity: 0,
        reproductiveState: "open" as const,
        ...history,
      } satisfies StartingSowEntry;
    }
    if (type === "boar") {
      return { ...animal, type, monthsInService: 0, ...history } satisfies StartingBoarEntry;
    }
    return { ...animal, type } as StartingStockEntry;
  });
}

describe("describing the opening stock", () => {
  it("counts every animal, each at the value it was entered at", () => {
    // The case the whole form exists for: two sows worth $350 and three worth
    // $230, which is five animals rather than one averaged herd.
    const config = empty([...each("sow", 2, 350, 700), ...each("sow", 3, 230, 1100)]);

    expect(openingCounts(config).sow).toBe(5);
    expect(openingStockValue(config)).toBeCloseTo(2 * 350 + 3 * 230, 6);

    const farm = new Farm(config);
    expect(farm.sows).toHaveLength(5);
    const values = farm.sows.map((sow) => sow.breedingValue).sort((a, b) => a - b);
    expect(values).toEqual([230, 230, 230, 350, 350]);
  });

  it("ages each animal by what it was entered at", () => {
    const config = empty([...each("sow", 1, 300, 900), ...each("boar", 1, 500, 640)]);
    const farm = new Farm(config);

    expect(farm.sows[0].birthDay).toBe(-900);
    expect(farm.boars[0].birthDay).toBe(-640);
  });

  it("takes the animals as the source of truth over the plain head counts", () => {
    const config = plan((draft) => {
      draft.stock.sows = 20;
      draft.stock.growers = 60;
      draft.stock.starting = each("sow", 3, 300, 800);
    });

    // The counts above are ignored rather than added to, so there is never a
    // head count to keep in step with a separate valuation.
    expect(openingCounts(config)).toMatchObject({ sow: 3, grower: 0 });
    const farm = new Farm(config);
    expect(farm.sows).toHaveLength(3);
    expect(farm.pigs.filter((pig) => pig.stage === "grower")).toHaveLength(0);
  });

  it("is what the plan warnings are written against", () => {
    // Eleven sows entered and no boar. The warning has to come off the animals:
    // read off the plain counts it would see the default one boar and say
    // nothing, and the plan would quietly produce no litters.
    const config = plan((draft) => {
      draft.stock.boars = 1;
      draft.stock.starting = each("sow", 11, 350, 750);
    });
    const warnings = simulatePlan(config, { snapshots: false }).projection.warnings;
    expect(warnings.some((warning) => warning.title === "No boar on the farm")).toBe(true);
  });

  it("leaves a plan with no animals on it exactly as it was", () => {
    // Backward compatibility, asserted rather than assumed: a plan saved before
    // opening stock could be described at all is built from its head counts.
    const before = plan((draft) => {
      draft.stock.starting = [];
      draft.stock.sows = 4;
      draft.stock.growers = 12;
    });
    const after = structuredClone(before);

    const one = simulatePlan(before, { snapshots: false });
    const two = simulatePlan(after, { snapshots: false });
    expect(two.projection.summary).toEqual(one.projection.summary);
    expect(two.projection.accounting).toEqual(one.projection.accounting);
  });
});

describe("starting piglets", () => {
  it("suckle the starting sows that are rearing a litter", () => {
    const config = empty([
      ...each("sow", 2, 300, 900, { parity: 3, reproductiveState: "lactating" }),
      ...each("piglet", 20, 12, 10),
    ]);
    expect(orphanStartingPiglets(config)).toBe(0);

    const farm = new Farm(config);
    const piglets = farm.pigs.filter((pig) => pig.stage === "piglet");
    expect(piglets).toHaveLength(20);
    // Milk is paid for through the sow's ration rather than by the head, so a
    // piglet on a sow is fed exactly as one farrowed here would be — and one on
    // no sow would be fed by nobody.
    const suckled = farm.sows.reduce((total, sow) => total + sow.litter.length, 0);
    expect(suckled).toBe(20);
    for (const piglet of piglets) {
      expect(piglet.damTag).not.toBeNull();
      expect(piglet.costs.total).toBeCloseTo(12, 6);
    }
    // Her litter's age is what says when she weans it, where she did not say
    // herself how long ago she farrowed.
    for (const sow of farm.sows) {
      expect(sow.weanDay).toBe(config.reproduction.weaningAgeDays - 10);
    }
  });

  it("take a sow at her word about when she farrowed", () => {
    // She said it, so the piglet does not overrule her: she weans this litter
    // the number of days from now that her own card says.
    const config = empty([
      ...each("sow", 1, 300, 900, {
        parity: 4,
        reproductiveState: "lactating",
        daysSinceFarrowing: 18,
      }),
      ...each("piglet", 10, 12, 4),
    ]);
    const farm = new Farm(config);
    expect(farm.sows[0].weanDay).toBe(config.reproduction.weaningAgeDays - 18);
    expect(farm.sows[0].litter).toHaveLength(10);
  });

  it("are taken as just weaned when no starting sow is suckling", () => {
    const config = empty(each("piglet", 8, 12, 10));
    // Said rather than quietly put right: the plan warns, and the animals stand
    // in the weaner house at the weight their age gives them instead of
    // vanishing or growing on milk nobody paid for.
    expect(orphanStartingPiglets(config)).toBe(8);

    const farm = new Farm(config);
    const placed = farm.pigs.filter((pig) => pig.alive);
    expect(placed).toHaveLength(8);
    for (const pig of placed) {
      expect(pig.stage).toBe("weaner");
      expect(pig.weightKg).toBeGreaterThan(0);
      expect(pig.weightKg).toBeLessThan(config.growth.referenceWeaningWeightKg);
      expect(pig.costs.total).toBeCloseTo(12, 6);
    }

    const warnings = simulatePlan(config, { snapshots: false }).projection.warnings;
    expect(warnings.some((warning) => warning.title.includes("no sow to suckle"))).toBe(true);
  });
});

describe("what a starting animal is carried at", () => {
  it("carries a started sow at what she was entered at, whatever her parity", () => {
    // A parity-3 sow entered at $275 is worth $275 today. Writing her down
    // again for parities one to three would charge this plan for wear that
    // happened before it opened, and leave her under what her owner says
    // she is worth.
    const config = empty(each("sow", 1, 275, 800, { parity: 3 }));
    const farm = new Farm(config);
    const sow = farm.sows[0];

    expect(sow.breedingValue).toBe(275);
    expect(sow.valuedAfter).toBe(3);
    expect(sow.accumulatedDepreciation).toBe(0);
    expect(carryingValue(sow)).toBeCloseTo(275, 6);
  });

  it("keeps a sow's parity and her state, which her age cannot say", () => {
    // The whole reason these are asked for. A parity-5 sow in pig, entered as
    // a maiden, would be given six more litters before the cull she is nearly
    // due, would farrow on the wrong day, and would eat the wrong ration.
    const config = empty(
      each("sow", 1, 250, 1100, { parity: 5, reproductiveState: "gestating", daysPregnant: 60 }),
    );
    const farm = new Farm(config);
    const sow = farm.sows[0];

    expect(sow.parity).toBe(5);
    expect(sow.state).toBe("gestating");
    // Sixty days gone of her gestation, so she farrows on the day that leaves.
    expect(sow.dueDay).toBe(Math.round(config.reproduction.gestationDays - 60));
    // And she is culled after the litters this plan has left in her, not after
    // a whole working life starting today.
    expect(sow.valuedAfter).toBe(5);
    expect(config.herd.cullAfterParity - sow.parity).toBeLessThan(config.herd.cullAfterParity);
  });

  it("spreads sows of one state across it when they do not say where they are", () => {
    // Six gestating sows with no day given are six farrowings across the
    // weeks, not one crowd on one date the farrowing house cannot hold.
    const config = empty(each("sow", 6, 300, 900, { parity: 2, reproductiveState: "gestating" }));
    const farm = new Farm(config);
    const due = farm.sows.map((sow) => sow.dueDay).sort((a, b) => (a ?? 0) - (b ?? 0));

    expect(new Set(due).size).toBe(6);
    for (const sow of farm.sows) expect(sow.parity).toBe(2);
  });

  it("spreads what is left of her value over the litters she has left", () => {
    const config = plan((draft) => {
      draft.herd.cullAfterParity = 6;
      draft.herd.cullSowSaleValue = 150;
    });
    // Entered at parity 3 at $275, with three parities left: $125 to write off
    // over three litters rather than $125 over six.
    const perParity = (275 - 150) / 3;
    expect(sowDepreciationAtParity(275, 3, config, 3)).toBeCloseTo(0, 6);
    expect(sowDepreciationAtParity(275, 4, config, 3)).toBeCloseTo(perParity, 6);
    expect(sowDepreciationAtParity(275, 6, config, 3)).toBeCloseTo(125, 6);
    // And never past her cull price, whatever parity she reaches.
    expect(275 - sowDepreciationAtParity(275, 9, config, 3)).toBeCloseTo(150, 6);
  });

  it("ages a boar by his age and rotates him by the service behind him", () => {
    const config = empty(each("boar", 1, 350, 1100, { monthsInService: 6 }), (draft) => {
      draft.herd.boarWorkingLifeMonths = 24;
      draft.herd.boarResidualValue = 110;
    });

    const farm = new Farm(config);
    const boar = farm.boars[0];
    // Two different facts. He is three years old, and he has been working for
    // six months of it: the first is biology, the second is what his rotation
    // and his write-off are counted from.
    expect(boar.birthDay).toBe(-1100);
    expect(boar.joinedDay).toBe(-Math.round(6 * 30.4375));
    expect(boar.valuedAfter).toBe(Math.round(6 * 30.4375));
    expect(boar.breedingValue).toBe(350);
    expect(carryingValue(boar)).toBeCloseTo(350, 6);

    // $240 to write off over the eighteen months he has left, not the
    // twenty-four he was bought for.
    const served = boar.valuedAfter;
    const lifeDays = 24 * 30.4375;
    const perDay = (350 - 110) / (lifeDays - served);
    expect(boarDepreciationAtDay(350, served, config, served)).toBeCloseTo(0, 6);
    expect(boarDepreciationAtDay(350, served + 30, config, served)).toBeCloseTo(perDay * 30, 6);
    expect(350 - boarDepreciationAtDay(350, lifeDays, config, served)).toBeCloseTo(110, 6);
  });

  it("opens a market pig at its entered value and adds the plan's costs to it", () => {
    const config = empty(each("grower", 4, 70, 90));
    const farm = new Farm(config);
    const growers = farm.pigs.filter((pig) => pig.alive);

    expect(growers).toHaveLength(4);
    for (const pig of growers) {
      // Age says what it weighs, inside the house it was entered as standing in.
      expect(pig.stage).toBe("grower");
      expect(pig.weightKg).toBeGreaterThanOrEqual(config.growth.growerStartWeightKg);
      expect(pig.weightKg).toBeLessThanOrEqual(config.growth.finisherStartWeightKg);
      expect(pig.costs.total).toBeCloseTo(70, 6);
      expect(pig.costs.byType.purchase).toBeCloseTo(70, 6);
      expect(pig.costs.byStage.grower).toBeCloseTo(70, 6);
    }
  });

  it("grows a pig up its stage as its age rises", () => {
    const young = new Farm(empty(each("grower", 1, 70, 70))).pigs[0];
    const older = new Farm(empty(each("grower", 1, 70, 110))).pigs[0];
    expect(older.weightKg).toBeGreaterThan(young.weightKg);
  });
});

describe("what happens to a starting animal afterwards", () => {
  it("makes a starting pig's opening value part of what its sale cost", () => {
    // The worked example, in the shape the model can be held to: a $70 pig that
    // eats and is doctored on its way to the abattoir costs its opening value
    // plus that rearing to sell, not the rearing alone.
    const config = empty(
      each("finisher", 6, 70, 140),
      // With retention on, the females among them would be picked out to breed
      // and would leave market stock by another door. This is about the door
      // marked "sold".
      (draft) => {
        draft.herd.retainHomeBredGilts = false;
      },
    );
    const run = simulatePlan(config, { snapshots: false });
    const flows = run.projection.accounting.flows;

    expect(run.projection.summary.totalPigsSold).toBe(6);
    expect(flows.costOfMarketPigsSold).toBeGreaterThan(6 * 70);
    // Every penny of it: the opening value, and the rearing since day zero and
    // nothing before it.
    expect(flows.costOfMarketPigsSold - 6 * 70).toBeCloseTo(flows.capitalisedMarket, 6);
    expect(flows.mortalityLossLivestock).toBe(0);
    expect(run.projection.accounting.closing.marketWip).toBeCloseTo(0, 6);
  });

  it("carries a starting gilt's value into the sow she becomes", () => {
    const config = plan((draft) => {
      draft.project.months = 24;
      draft.herd.maxSows = 20;
      draft.stock = {
        sows: 0,
        gilts: 0,
        boars: 0,
        weaners: 0,
        growers: 0,
        finishers: 0,
        starting: [...each("gilt", 4, 320, 200), ...each("boar", 1, 500, 640)],
      };
    });
    const farm = new Farm(config);
    const opening = inventoryTotal(farm.books.opening);
    expect(opening).toBeCloseTo(4 * 320 + 500, 6);

    // She keeps her tag when she changes role, which is how she is found again.
    const started = new Set(farm.pigs.map((pig) => pig.tag));
    const horizon = 400;
    for (let day = 0; day <= horizon; day += 1) farm.advanceTo(day);

    const promoted = farm.sows.filter((sow) => started.has(sow.tag));
    expect(promoted.length).toBeGreaterThan(0);
    for (const sow of promoted) {
      // She changes role rather than leaving: what she was entered at, plus her
      // keep since, is what she is worth walking into the herd.
      expect(sow.breedingValue).toBeGreaterThan(320);
      // And promoted from a gilt, so the whole of her working life is ahead of
      // her however many litters she has had since.
      expect(sow.valuedAfter).toBe(0);
      expect(carryingValue(sow)).toBeLessThanOrEqual(sow.breedingValue);
    }
    // The daughters she has reared since are valued at what they cost here,
    // which is a different figure and no business of the opening balance.
    const homeBred = farm.sows.filter((sow) => !started.has(sow.tag));
    for (const sow of homeBred) expect(sow.breedingValue).toBeGreaterThan(0);
  });
});

describe("opening stock as an opening balance", () => {
  const bare = plan((draft) => {
    draft.stock = {
      sows: 0,
      gilts: 0,
      boars: 0,
      weaners: 0,
      growers: 0,
      finishers: 0,
      starting: [],
    };
  });
  const stocked = empty([
    ...each("sow", 4, 300, 800),
    ...each("boar", 1, 450, 600),
    ...each("grower", 10, 80, 95),
  ]);

  it("lifts what the farm owns on day one", () => {
    const farm = new Farm(stocked);
    const opening = inventoryTotal(farm.books.opening);
    expect(opening).toBeCloseTo(4 * 300 + 450 + 10 * 80, 6);
    expect(opening).toBeCloseTo(openingStockValue(stocked), 6);
    expect(inventoryTotal(new Farm(bare).books.opening)).toBe(0);
  });

  it("raises the opening net assets by exactly what it is worth", () => {
    // The opening balance sheet, before a day has run. Comparing the two farms
    // any later than that would not be comparing the opening stock: a farm with
    // animals on it stocks its bins differently, pays a stockman and has eaten
    // a day's feed, and none of that is what this is about.
    const openingWorth = (config: PlannerConfig) => {
      const farm = new Farm(config);
      return netWorthAtCost({
        cash: config.project.openingCash,
        storeValue: 0,
        payables: 0,
        balances: farm.books.opening,
      });
    };

    expect(openingWorth(stocked) - openingWorth(bare)).toBeCloseTo(
      openingStockValue(stocked),
      6,
    );

    // And under the headings it belongs to rather than lumped into one line,
    // because a balance sheet that says "livestock $2,450" is not a balance
    // sheet a lender can read.
    const opening = new Farm(stocked).books.opening;
    expect(opening.sowAssets).toBeCloseTo(4 * 300, 6);
    expect(opening.boarAssets).toBeCloseTo(450, 6);
    expect(opening.marketWip).toBeCloseTo(10 * 80, 6);
    expect(opening.replacementWip).toBe(0);
  });

  it("charges no cost, moves no cash and books no sale for it", () => {
    const withStock = simulatePlan(stocked, { snapshots: false }).projection;
    const withNothing = simulatePlan(bare, { snapshots: false }).projection;
    const first = withStock.months[0];

    // Month one is not charged for animals the farm already had, so nothing in
    // the opening stock shows up as a purchase, a payment or a receipt.
    expect(first.totals["breeding-stock"]).toBe(0);
    expect(first.accounting.flows.breedingPurchases).toBe(0);
    expect(first.cashIn).toBeCloseTo(withNothing.months[0].cashIn, 6);

    // The opening balance is on the balance sheet from the first day rather
    // than arriving through it.
    expect(inventoryTotal(first.accounting.opening)).toBeCloseTo(
      openingStockValue(stocked),
      6,
    );
  });

  it("makes no profit and no loss out of simply having it", () => {
    const first = simulatePlan(stocked, { snapshots: false }).projection.months[0];
    const opened = {
      flows: first.accounting.flows,
      opening: first.accounting.opening,
      // A period that has not run: what was standing at the open is still
      // standing, and nothing has moved.
      closing: first.accounting.opening,
    };
    const still = { ...opened, flows: { ...opened.flows } };
    for (const key of Object.keys(still.flows) as (keyof typeof still.flows)[]) {
      still.flows[key] = 0;
    }
    const totals = { ...first.totals };
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] = 0;

    expect(currentProfitOrLoss(totals, still)).toBe(0);
    expect(inventoryAdjustedProfit(totals, still)).toBe(0);
  });
});

describe("plans saved before any of this existed", () => {
  it("load, and load onto the head counts they were saved with", () => {
    // What a stored plan looks like: no starting stock in it at all, because
    // the field did not exist when it was written.
    const stored = structuredClone(cloneDefaultConfig()) as Record<string, unknown>;
    const stock = stored.stock as Record<string, unknown>;
    delete stock.starting;
    stock.sows = 6;
    stock.growers = 30;

    const loaded = withConfigDefaults(stored);
    expect(loaded).not.toBeNull();
    expect(loaded!.stock.starting).toEqual([]);
    expect(hasDetailedStartingStock(loaded!)).toBe(false);
    // And it is still built from its counts, not from an empty animal list.
    expect(openingCounts(loaded!)).toMatchObject({ sow: 6, grower: 30 });
  });

  it("read a plan written in groups into the animals those groups stood for", () => {
    // The shape opening stock was first saved in: a row was a group, with a
    // head count and one value per head on it.
    const stored = structuredClone(cloneDefaultConfig()) as Record<string, unknown>;
    (stored.stock as Record<string, unknown>).starting = [
      { id: "a", type: "sow", count: 3, parity: 2, reproductiveState: "open", openingValuePerHead: 300 },
      { id: "b", type: "grower", count: 2, averageAgeDays: 95, openingValuePerHead: 80 },
    ];

    const loaded = withConfigDefaults(stored);
    expect(loaded).not.toBeNull();
    const starting = loaded!.stock.starting;
    expect(starting).toHaveLength(5);
    expect(openingStockValue(loaded!)).toBeCloseTo(3 * 300 + 2 * 80, 6);
    // An age it did give is the age it keeps.
    for (const entry of starting.filter((entry) => entry.type === "grower")) {
      expect(entry.ageDays).toBe(95);
    }
    // The parity and the state are the whole point of the row and come across
    // as they were: an old plan's parity-2 herd does not load as maidens.
    const sows = starting.filter((entry) => entry.type === "sow");
    expect(sows).toHaveLength(3);
    for (const sow of sows) {
      expect(sow.parity).toBe(2);
      expect(sow.reproductiveState).toBe("open");
      // Only the age it never gave is a reading rather than a record.
      expect(sow.ageDays).toBeGreaterThan(365);
    }
  });

  it("read an old boar's service across, not just his age", () => {
    const stored = structuredClone(cloneDefaultConfig()) as Record<string, unknown>;
    (stored.stock as Record<string, unknown>).starting = [
      { id: "b", type: "boar", count: 2, monthsInService: 9, openingValuePerHead: 400 },
    ];

    const loaded = withConfigDefaults(stored);
    const boars = loaded!.stock.starting.filter((entry) => entry.type === "boar");
    expect(boars).toHaveLength(2);
    for (const boar of boars) expect(boar.monthsInService).toBe(9);
  });
});

describe("both engines", () => {
  const starting: StartingStockEntry[] = [
    ...each("sow", 6, 300, 850),
    ...each("boar", 1, 480, 620),
    ...each("weaner", 20, 35, 45),
  ];

  it("open on the same balance sheet under 1.x and 2.0", () => {
    const one = empty(starting);
    const two = empty(starting);
    two.project.engine = "2.0";

    const expected = 6 * 300 + 480 + 20 * 35;
    for (const config of [one, two]) {
      const run = simulatePlan(config, { snapshots: false });
      expect(inventoryTotal(run.projection.accounting.opening)).toBeCloseTo(expected, 6);
    }
  });
});
