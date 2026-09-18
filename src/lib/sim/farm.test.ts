import { addMonths, format, parseISO, subDays } from "date-fns";
import { describe, expect, it } from "vitest";

import {
  cloneDefaultConfig,
  ESTRUS_CYCLE_DAYS,
  expectedGiltServiceAgeDays,
  type PlannerConfig,
} from "../config";
import { generatedTotal, isGenerated, planCashInjections, planCashWithdrawals } from "../funding";
import { feedConversionAt, growoutFeedConversion, upkeepFeedKgDay } from "../growth-curve";
import { calculateProjection } from "../model";
import {
  expensesOf,
  Farm,
  FEED_RATIONS,
  feedOf,
  farmStateAt,
  farmTimeline,
  GrowingPig,
  horizonDay,
  incomeOf,
  runFarm,
  type Trip,
} from "./index";

function config(): PlannerConfig {
  return cloneDefaultConfig();
}

function pig(overrides: Partial<ConstructorParameters<typeof GrowingPig>[0]> = {}) {
  return new GrowingPig({
    id: "T",
    tag: "T",
    sex: "female",
    birthDay: 0,
    weightKg: 70,
    stage: "finisher",
    ...overrides,
  });
}

describe("Rule 1 — a pig's sex, weight and age drive what it eats", () => {
  it("feeds an entire male more than a gilt of the same weight", () => {
    const input = config();
    const male = pig({ sex: "male" });
    const female = pig({ sex: "female" });
    expect(male.dailyFeed(input).kg).toBeGreaterThan(female.dailyFeed(input).kg);
    // Two pigs of the same weight owe the same upkeep, so the faster grower
    // spreads it over more gain and converts better. That is why an entire male
    // is cheaper to finish than a gilt even though he eats more each day.
    expect(male.dailyFeed(input).kg / male.dailyGainKg(input)).toBeLessThan(
      female.dailyFeed(input).kg / female.dailyGainKg(input),
    );
  });

  it("feeds a heavy finisher more than a light one", () => {
    const input = config();
    const light = pig({ weightKg: 62 }).dailyFeed(input).kg;
    const heavy = pig({ weightKg: 98 }).dailyFeed(input).kg;
    expect(heavy).toBeGreaterThan(light);
    expect(heavy / light).toBeGreaterThan(1.05);
  });

  it("converts feed worse the heavier a pig gets", () => {
    const input = config();
    const gain = 0.85;
    const light = feedConversionAt(30, gain, input.growth);
    const middle = feedConversionAt(65, gain, input.growth);
    const heavy = feedConversionAt(100, gain, input.growth);
    expect(light).toBeLessThan(middle);
    expect(middle).toBeLessThan(heavy);
    // A weaner converting near 2:1 and a finisher near 3:1 is the shape the
    // published figures have. A flat ratio across the growout is not.
    expect(heavy - light).toBeGreaterThan(0.5);
  });

  it("charges upkeep by metabolic weight, so it does not double when a pig does", () => {
    const input = config();
    const fifty = upkeepFeedKgDay(50, input.growth);
    const hundred = upkeepFeedKgDay(100, input.growth);
    expect(hundred).toBeGreaterThan(fifty);
    expect(hundred / fifty).toBeLessThan(2);
    expect(hundred / fifty).toBeCloseTo(Math.pow(2, 0.75), 6);
  });

  it("offers creep feed only once a suckling piglet is old enough", () => {
    const input = config();
    const piglet = pig({ stage: "piglet", weightKg: 3 });
    expect(piglet.dailyFeed(input).kg).toBe(0);
    expect(piglet.creepFeed(input.feed.creepStartAgeDays - 1, input).kg).toBe(0);
    expect(piglet.creepFeed(input.feed.creepStartAgeDays + 1, input).kg).toBeGreaterThan(0);
  });

  it("keeps the herd's feed use close to the planned feed curve", () => {
    const input = config();
    input.stock = { sows: 0, gilts: 0, boars: 0, weaners: 2000, growers: 0, finishers: 0 };
    input.growth.weanerMortalityPct = 0;
    input.growth.growerMortalityPct = 0;
    input.growth.finisherMortalityPct = 0;
    input.herd.retainHomeBredGilts = false;
    const farm = runFarm(input, 400);
    const feedKg = farm.history.reduce((sum, day) => sum + day.growingFeedKg, 0);
    const gainKg =
      farm.lifetime.soldLiveweightKg - 2000 * ((input.growth.weaningWeightKg + 30) / 2);
    // Conversion depends on weight, so the expectation is what one average pig
    // eats walking the same curve from weaning to sale weight.
    const plannedFcr = growoutFeedConversion(input.growth).growoutFcr;
    expect(feedKg / gainKg).toBeGreaterThan(plannedFcr * 0.9);
    expect(feedKg / gainKg).toBeLessThan(plannedFcr * 1.15);
  });
});

describe("Rule 2 — sow places, gilt retention and surplus sales", () => {
  it("grows a two-gilt start into a full breeding herd", () => {
    const input = config();
    input.stock = { sows: 0, gilts: 2, boars: 1, weaners: 0, growers: 0, finishers: 0 };
    input.herd.maxSows = 20;
    input.project.months = 60;
    const farm = runFarm(input);
    expect(farm.lifetime.giltsPromoted).toBeGreaterThan(10);
    // At most two gilts are kept per litter, so the places fill over years, not months.
    expect(farm.sows.length).toBeGreaterThanOrEqual(input.herd.maxSows - 2);
    expect(farm.sows.length).toBeLessThanOrEqual(input.herd.maxSows);
    expect(farm.sows.every((sow) => sow.homeBred || sow.generation === 0)).toBe(true);
  });

  it("never carries more sows than the plan has places for", () => {
    const input = config();
    input.herd.maxSows = 14;
    input.project.months = 60;
    const result = calculateProjection(input);
    for (const month of result.months) {
      expect(month.sows).toBeLessThanOrEqual(input.herd.maxSows);
    }
  });

  it("sells surplus gilts once the herd is at capacity", () => {
    const input = config();
    input.stock.sows = 12;
    input.herd.maxSows = 12;
    input.project.months = 60;
    const result = calculateProjection(input);
    const giltsSold = result.months.reduce((sum, month) => sum + month.giltsSold, 0);
    expect(giltsSold).toBeGreaterThan(0);
    expect(result.months.reduce((sum, month) => sum + month.totals["gilt-sales"], 0)).toBeCloseTo(
      giltsSold * input.herd.surplusGiltSaleValue,
      6,
    );
  });

  it("retains no gilts at all when the farm is told not to", () => {
    const input = config();
    input.herd.retainHomeBredGilts = false;
    input.herd.buyGiltsWhenShort = false;
    const farm = runFarm(input);
    expect(farm.lifetime.giltsSelected).toBe(0);
    expect(farm.lifetime.giltsPromoted).toBe(0);
    expect(farm.sows.length).toBeLessThan(input.stock.sows);
  });

  it("buys gilts in only when asked and the home-bred pipeline is short", () => {
    const input = config();
    input.stock = { sows: 2, gilts: 0, boars: 1, weaners: 0, growers: 0, finishers: 0 };
    input.herd.maxSows = 12;
    input.herd.retainHomeBredGilts = false;
    input.herd.buyGiltsWhenShort = true;
    const farm = runFarm(input, 30);
    expect(farm.lifetime.giltsPurchased).toBe(10);
    expect(farm.sows.length).toBe(12);
  });
});

describe("Rule 3 — generations, including the ones that overlap", () => {
  it("numbers each pig one past its dam and keeps the lineage", () => {
    const input = config();
    input.project.months = 48;
    const farm = runFarm(input);
    const piglet = farm.pigs.find((animal) => animal.damTag !== null);
    expect(piglet).toBeDefined();
    const dam = farm.sows.find((sow) => sow.tag === piglet!.damTag);
    if (dam) expect(piglet!.generation).toBe(dam.generation + 1);
    expect(piglet!.sireTag).toMatch(/^BOAR-/);
  });

  it("reports several generations alive on the farm at the same time", () => {
    const input = config();
    input.project.months = 60;
    const state = farmStateAt(input, "2031-06-01T09:00");
    const living = state.generations.filter((row) => row.alive > 0);
    expect(living.length).toBeGreaterThanOrEqual(3);
    // Descendants of different depths are breeding side by side.
    expect(state.generations.filter((row) => row.breedingFemales > 0).length).toBeGreaterThan(1);
    // Every birth lands in exactly one generation. The count runs ahead of the
    // simulated farrowings by the piglets that were already suckling on day one.
    const bornTotal = state.generations.reduce((sum, row) => sum + row.born, 0);
    expect(bornTotal).toBeGreaterThanOrEqual(state.lifetime.bornAlive);
    expect(bornTotal - state.lifetime.bornAlive).toBeLessThan(
      state.generations[1].born * 0.2,
    );
  });

  it("accounts for every pig born as alive, sold or dead", () => {
    const input = config();
    input.project.months = 48;
    const farm = runFarm(input);
    const state = farm.state();
    for (const row of state.generations) {
      if (row.generation === 0) continue;
      expect(row.born).toBe(row.alive + row.sold + row.died);
    }
  });
});

describe("Rule 4 — what a pig costs at each age", () => {
  it("charges each vaccination once, at the age it is due", () => {
    const input = config();
    input.stock = { sows: 0, gilts: 0, boars: 0, weaners: 100, growers: 0, finishers: 0 };
    input.herd.retainHomeBredGilts = false;
    const farm = runFarm(input, 200);
    // Starting weaners are past the early doses, so only the later ones are given.
    const perPig = input.health.vaccinations
      .filter((dose) => dose.ageDays > 40)
      .reduce((sum, dose) => sum + dose.costPerPig, 0);
    const charged = farm.ledger.totals.vaccination;
    expect(charged).toBeGreaterThan(0);
    expect(charged).toBeLessThanOrEqual(100 * perPig + 0.001);
  });

  it("charges heating only while a pig is under the heated age", () => {
    const warm = config();
    const cold = config();
    cold.health.heatedUntilAgeDays = 0;
    expect(runFarm(warm, 200).ledger.totals.gas).toBeGreaterThan(0);
    expect(runFarm(cold, 200).ledger.totals.gas).toBe(0);
  });

  it("splits a market pig's bill across the stages it passed through", () => {
    const farm = runFarm(config());
    const cost = farm.costOfProduction();
    expect(cost.pigsSold).toBeGreaterThan(0);
    expect(cost.directPerPig).toBeCloseTo(
      cost.directByStage.piglet +
        cost.directByStage.weaner +
        cost.directByStage.grower +
        cost.directByStage.finisher +
        cost.directByStage.gilt +
        cost.directByStage.breeding,
      6,
    );
    expect(cost.directPerPig).toBeCloseTo(
      cost.directByType.feed +
        cost.directByType.health +
        cost.directByType.heating +
        cost.directByType.transport +
        cost.directByType.purchase,
      6,
    );
    // Feed dominates, and the finishing stage costs more than the nursery.
    expect(cost.directByType.feed / cost.directPerPig).toBeGreaterThan(0.6);
    expect(cost.directByStage.finisher).toBeGreaterThan(cost.directByStage.weaner);
    expect(cost.fullCostPerPig).toBeGreaterThan(cost.directPerPig);
    expect(cost.marginPerPig).toBeCloseTo(cost.revenuePerPig - cost.fullCostPerPig, 6);
  });

  it("keeps a running bill on each individual sow", () => {
    const farm = runFarm(config(), 500);
    const sow = farm.sows.find((animal) => animal.parity > 0);
    expect(sow).toBeDefined();
    expect(sow!.costs.total).toBeGreaterThan(0);
    expect(sow!.costs.byType.feed).toBeGreaterThan(0);
    expect(sow!.costs.byStage.breeding).toBeGreaterThan(0);
  });

  it("carries a gilt's rearing cost onto the sow she becomes", () => {
    const input = config();
    input.project.months = 48;
    const farm = runFarm(input);
    const homeBred = farm.sows.find((sow) => sow.homeBred);
    expect(homeBred).toBeDefined();
    // Her bill includes what she ate before she ever entered the breeding herd.
    expect(homeBred!.costs.byStage.weaner).toBeGreaterThan(0);
    expect(homeBred!.costs.byStage.gilt).toBeGreaterThan(0);
  });
});

describe("Farm entities", () => {
  it("starts the default farm with two open sows, one boar and no young stock", () => {
    const farm = new Farm(config());
    expect(farm.sows).toHaveLength(2);
    expect(farm.boars).toHaveLength(1);
    expect(farm.sows.every((sow) => sow.alive && sow.tag.startsWith("SOW-"))).toBe(true);
    expect(farm.sows.every((sow) => sow.state === "open" && sow.nextServiceDay === 0)).toBe(true);
    expect([...farm.sows, ...farm.boars].every((animal) => Math.round(animal.ageMonths(0)) === 7)).toBe(
      true,
    );
    expect(farm.pigs).toHaveLength(0);
  });

  it("puts every starting sow on the same day when the herd is synchronised", () => {
    const input = config();
    input.herd.startMode = "synchronised";
    const farm = new Farm(input);
    expect(farm.sows.every((sow) => sow.state === "open" && sow.nextServiceDay === 0)).toBe(true);
    expect(farm.pigs).toHaveLength(0);
  });

  it("runs a sow from service through gestation, farrowing and weaning", () => {
    const input = config();
    input.herd.startMode = "synchronised";
    input.reproduction.farrowingSuccessPct = 100;
    const farm = new Farm(input);
    const sow = farm.sows[0];

    farm.advanceTo(0);
    expect(sow.state).toBe("gestating");
    // Gestation varies by a day or two from sow to sow.
    expect(sow.dueDay).toBeGreaterThan(input.reproduction.gestationDays - 6);
    expect(sow.dueDay).toBeLessThan(input.reproduction.gestationDays + 6);

    farm.advanceTo(sow.dueDay!);
    expect(sow.state).toBe("lactating");
    expect(sow.parity).toBe(1);
    expect(sow.litter.length).toBeGreaterThan(0);

    farm.advanceTo(sow.weanDay!);
    expect(sow.state).toBe("open");
    expect(sow.litter).toHaveLength(0);
    expect(sow.totalWeaned).toBeGreaterThan(0);
    expect(farm.pigs.some((animal) => animal.stage === "weaner")).toBe(true);
  });

  it("grows pigs through the stages and sells them at the target liveweight", () => {
    const input = config();
    input.stock = { sows: 0, gilts: 0, boars: 0, weaners: 20, growers: 0, finishers: 0 };
    input.herd.retainHomeBredGilts = false;
    const farm = runFarm(input);
    expect(farm.lifetime.sold).toBeGreaterThan(15);
    const average = farm.lifetime.soldLiveweightKg / farm.lifetime.sold;
    expect(average).toBeGreaterThanOrEqual(input.growth.saleWeightKg);
    expect(average).toBeLessThan(input.growth.saleWeightKg + 1.5);
  });

  it("keeps the ledger balanced against the cash it reports", () => {
    const farm = runFarm(config());
    const state = farm.state();
    expect(state.finance.cash).toBeCloseTo(
      state.finance.openingCash + state.finance.income - state.finance.expenses,
      6,
    );
    const posted = farm.ledger.entries.reduce(
      (total, entry) => total + (entry.kind === "income" ? entry.amount : -entry.amount),
      0,
    );
    expect(state.finance.cash).toBeCloseTo(state.finance.openingCash + posted, 6);
  });

  it("culls sows at the planned parity", () => {
    const input = config();
    input.herd.cullAfterParity = 3;
    const farm = runFarm(input);
    expect(farm.lifetime.sowsCulled).toBeGreaterThan(0);
    expect(farm.sows.every((sow) => sow.parity <= input.herd.cullAfterParity)).toBe(true);
  });

  it("always keeps the boar team up to strength", () => {
    const input = config();
    input.stock.boars = 2;
    input.herd.sowAnnualMortalityPct = 60;
    input.project.months = 48;
    const farm = runFarm(input);
    expect(farm.boars).toHaveLength(2);
  });
});

describe("Point-in-time farm state", () => {
  it("reports the herd and the money standing on a chosen date and time", () => {
    const input = config();
    const state = farmStateAt(input, "2028-06-15T14:30");
    expect(state.date).toBe("2028-06-15");
    expect(state.timestamp).toBe("2028-06-15T14:30");
    expect(state.withinHorizon).toBe(true);
    expect(state.herd.total).toBe(state.herd.growingTotal + state.herd.sows + state.herd.boars);
    expect(state.herd.sows).toBe(
      state.herd.gestatingSows + state.herd.lactatingSows + state.herd.openSows,
    );
    expect(state.sows).toHaveLength(state.herd.sows);
    expect(state.stock).toHaveLength(state.herd.total);
    expect(state.stock.every((animal) => animal.ageDays >= 0)).toBe(true);
    expect(state.stock.some((animal) => animal.kind === "sow")).toBe(true);
    expect(state.finance.netWorth).toBeCloseTo(state.finance.cash + state.finance.herdValue, 6);
    expect(state.recentEvents.length).toBeGreaterThan(0);
  });

  it("agrees with the monthly cashflow at each month end", () => {
    const input = config();
    const projection = calculateProjection(input);
    const start = parseISO(input.project.startDate);

    for (const index of [0, 5, 17, input.project.months - 1]) {
      const monthEnd = subDays(addMonths(start, index + 1), 1);
      const state = farmStateAt(input, format(monthEnd, "yyyy-MM-dd") + "T23:00");
      const month = projection.months[index];
      expect(state.finance.cash).toBeCloseTo(month.closingCash, 6);
      expect(state.herd.piglets).toBe(month.piglets);
      expect(state.herd.weaners).toBe(month.weaners);
      expect(state.herd.growers).toBe(month.growers);
      expect(state.herd.finishers).toBe(month.finishers);
      expect(state.herd.gilts).toBe(month.gilts);
      expect(state.herd.sows).toBe(month.sows);
    }
  });

  it("reads the day before the plan starts as the opening position", () => {
    const input = config();
    const state = farmStateAt(input, "2026-12-20T08:00");
    expect(state.day).toBe(-1);
    expect(state.finance.cash).toBe(input.project.openingCash);
    expect(state.herd.sows).toBe(input.stock.sows);
    expect(state.withinHorizon).toBe(false);
  });

  it("clamps a request past the horizon to the last planned day", () => {
    const input = config();
    const state = farmStateAt(input, "2040-01-01T08:00");
    expect(state.day).toBe(horizonDay(input));
    expect(state.date).toBe("2029-12-31");
  });

  it("lays the plan out as clickable days and as a list of months", () => {
    const input = config();
    input.project.months = 12;
    const { days, months } = farmTimeline(input);

    expect(days.length).toBe(horizonDay(input) + 1);
    expect(days[0].date).toBe(input.project.startDate);
    expect(days.at(-1)!.day).toBe(horizonDay(input));
    expect(months.length).toBe(12);
    expect(months[0].date).toBe(input.project.startDate);
    expect(months.at(-1)!.endDate).toBe(days.at(-1)!.date);

    // A calendar square and the farm read at that moment are the same farm.
    const square = days[40];
    const state = farmStateAt(input, square.date + "T23:00");
    expect(square.total).toBe(state.herd.total);
    expect(square.closingCash).toBeCloseTo(state.finance.cash, 6);

    // A month is its own days, nothing lost and nothing counted twice.
    const first = months[0];
    const itsDays = days.filter((day) => day.date.startsWith(first.date.slice(0, 7)));
    expect(first.sold).toBe(itsDays.reduce((total, day) => total + day.sold, 0));
    expect(first.total).toBe(itsDays.at(-1)!.total);

    const events = months.flatMap((month) => month.events);
    expect(events.every((event) => event.count > 0)).toBe(true);
    expect(events.some((event) => event.type === "service")).toBe(true);
    expect(events.some((event) => event.type === "vaccination")).toBe(true);
    expect(events.some((event) => event.type === "feed")).toBe(true);
  });
});

describe("Boar rotation and the genetics of a closed herd", () => {
  /** Walks a farm day by day and reports what its breeding females were served by. */
  function runWatchingMatings(input: PlannerConfig) {
    const farm = new Farm(input);
    const finalDay = horizonDay(input);
    let sireDaughterMatings = 0;
    let ancestorMatings = 0;
    let aiMatings = 0;
    let homeBredServed = 0;
    let mostBoarsStanding = 0;
    const boarsSeen = new Set<string>();

    for (let day = 0; day <= finalDay; day += 1) {
      farm.advanceTo(day);
      mostBoarsStanding = Math.max(mostBoarsStanding, farm.boars.length);
      for (const boar of farm.boars) boarsSeen.add(boar.tag);
      for (const sow of farm.sows) {
        if (sow.lastSireTag === null) continue;
        if (sow.sireTag !== null && sow.lastSireTag === sow.sireTag) sireDaughterMatings += 1;
        if (sow.relatedTo(sow.lastSireTag)) ancestorMatings += 1;
        if (sow.lastSireTag.startsWith("AI-")) aiMatings += 1;
        if (sow.homeBred) homeBredServed += 1;
      }
    }
    return {
      farm,
      sireDaughterMatings,
      ancestorMatings,
      aiMatings,
      homeBredServed,
      mostBoarsStanding,
      boarsSeen,
    };
  }

  it("never serves a female with her own sire", () => {
    const input = config();
    input.project.months = 60;
    const watched = runWatchingMatings(input);

    // The check is only worth anything if home-bred females really were bred.
    expect(watched.homeBredServed).toBeGreaterThan(0);
    expect(watched.sireDaughterMatings).toBe(0);
  });

  it("stands a second, unrelated boar once home-bred gilts come to service", () => {
    const input = config();
    input.project.months = 60;
    const watched = runWatchingMatings(input);

    // The plan asks for one boar, yet two stand together once the home-bred
    // females need a mate that is not their father.
    expect(input.stock.boars).toBe(1);
    expect(watched.mostBoarsStanding).toBeGreaterThanOrEqual(2);
    expect(watched.boarsSeen.size).toBeGreaterThan(2);
  });

  it("rotates a boar off at the end of his working life", () => {
    const input = config();
    input.project.months = 60;
    input.herd.boarWorkingLifeMonths = 18;
    const farm = runFarm(input);

    expect(farm.lifetime.boarsRotated).toBeGreaterThan(0);
    expect(farm.boars.length).toBeGreaterThanOrEqual(1);
    // Nobody standing has been working longer than his term.
    const workingLifeDays = Math.round(18 * 30.4375);
    for (const boar of farm.boars) {
      expect(farm.day - boar.joinedDay).toBeLessThan(workingLifeDays);
    }
  });

  it("never serves a female with her own maternal grandsire", () => {
    const input = config();
    input.project.months = 60;
    // A boar standing his full term meets his granddaughters at about day 708,
    // three weeks before he is rotated off. Standing him for longer than that
    // widens the window rather than opening it.
    input.herd.boarWorkingLifeMonths = 36;
    const watched = runWatchingMatings(input);

    expect(watched.homeBredServed).toBeGreaterThan(0);
    expect(watched.ancestorMatings).toBe(0);
  });

  it("buys semen instead of standing another boar once AI is on", () => {
    const natural = config();
    natural.project.months = 60;
    const withAi = config();
    withAi.project.months = 60;
    withAi.service.useAi = true;

    const a = runWatchingMatings(natural);
    const b = runWatchingMatings(withAi);

    // Natural service has to stand a second boar for the home-bred females. AI
    // covers exactly those matings, so the farm keeps the one boar it planned.
    expect(a.mostBoarsStanding).toBeGreaterThanOrEqual(2);
    expect(b.mostBoarsStanding).toBe(withAi.stock.boars);
    expect(b.aiMatings).toBeGreaterThan(0);
    expect(b.ancestorMatings).toBe(0);
    expect(b.farm.lifetime.aiCost).toBeCloseTo(
      b.farm.lifetime.aiServices * withAi.service.aiCostPerService,
      6,
    );
  });

  it("puts the share of services to AI that the plan asks for", () => {
    function shareAtBoars(boars: number) {
      const input = config();
      input.project.months = 36;
      input.project.variation = "settled";
      input.service.useAi = true;
      input.service.aiSharePct = 40;
      input.stock.boars = boars;
      const farm = runFarm(input);
      expect(farm.lifetime.aiCost).toBe(farm.lifetime.aiServices * input.service.aiCostPerService);
      return farm.lifetime.aiServices / farm.lifetime.servicesAttempted;
    }

    // With a team wide enough that every female can always find an unrelated
    // boar, the share is the plan's and nothing else: settled takes it exactly,
    // bar the part-service of remainder it is always carrying.
    const spoiltForChoice = shareAtBoars(3);
    expect(spoiltForChoice).toBeCloseTo(0.4, 2);

    // On one boar it is a floor rather than a figure. Once the herd is his own
    // daughters, their services can only go to semen, so the realised share
    // climbs above what was asked for — which is the plan working, not drifting.
    const oneBoar = shareAtBoars(1);
    expect(oneBoar).toBeGreaterThan(spoiltForChoice + 0.05);
  });

  it("breeds on with no boar at all when every service is by AI", () => {
    const input = config();
    input.project.months = 36;
    input.service.useAi = true;
    input.service.aiSharePct = 100;
    input.stock.boars = 0;
    const farm = runFarm(input);

    expect(farm.boars.length).toBe(0);
    expect(farm.lifetime.aiServices).toBe(farm.lifetime.servicesAttempted);
    expect(farm.lifetime.bornAlive).toBeGreaterThan(0);
    expect(farm.lifetime.servicesMissedForBoarCapacity).toBe(0);
    // Nothing is spent on boars to buy, feed or rotate.
    expect(farm.lifetime.boarsRotated).toBe(0);
  });

  it("charges a service that did not hold again when she comes back", () => {
    const input = config();
    input.project.months = 36;
    input.service.useAi = true;
    input.service.aiSharePct = 100;
    input.stock.boars = 0;
    input.reproduction.farrowingSuccessPct = 50;
    const farm = runFarm(input);

    // At half the services holding, the herd pays for about two per litter.
    expect(farm.lifetime.aiServices).toBeGreaterThan(farm.lifetime.litters * 1.5);
    expect(farm.lifetime.aiCost).toBe(farm.lifetime.aiServices * input.service.aiCostPerService);
  });

  it("spreads services across the team instead of working one boar", () => {
    const input = config();
    input.project.months = 60;
    const farm = runFarm(input);
    const services = farm.boars.map((boar) => boar.totalServices);

    expect(services.length).toBeGreaterThanOrEqual(1);
    expect(services.every((count) => count >= 0)).toBe(true);
    expect(farm.lifetime.servicesAttempted).toBeGreaterThan(0);
  });
});

/**
 * Every home-bred female's first service: her age and weight on the day, and
 * how many cycles past her own first heat it fell.
 */
function firstServices(input: PlannerConfig) {
  const farm = new Farm(input);
  const served: { ageDays: number; weightKg: number; cycles: number }[] = [];
  const seen = new Set<string>();
  const firstHeat = new Map<string, number>();
  const joinedOn = new Map<string, number>();
  for (let day = 0; day <= horizonDay(input); day += 1) {
    farm.advanceTo(day);
    for (const pig of farm.pigs) {
      if (pig.firstHeatDay !== null) firstHeat.set(pig.tag, pig.firstHeatDay);
    }
    for (const sow of farm.sows) {
      if (!joinedOn.has(sow.tag)) joinedOn.set(sow.tag, day);
    }
    for (const sow of farm.sows) {
      if (!sow.homeBred || sow.lastSireTag === null || seen.has(sow.tag)) continue;
      // Only females this plan reared. The starting gilts are seeded part-grown
      // and already cycling, so their age at service says nothing about how the
      // plan rears one.
      if (sow.birthDay < 0) continue;
      seen.add(sow.tag);
      const heat = firstHeat.get(sow.tag);
      // Counted from the day she joined the herd, not the day she was served:
      // she joins on a standing heat, and is served on it unless the boar team
      // was busy, in which case she waits a day or two for one.
      const joined = joinedOn.get(sow.tag) ?? day;
      served.push({
        ageDays: sow.ageDays(day),
        weightKg: sow.weightKg,
        cycles: heat === undefined ? NaN : (joined - heat) / ESTRUS_CYCLE_DAYS,
      });
    }
  }
  return served;
}

function median(list: number[]): number {
  return [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
}

describe("First service at the weight and age good practice calls for", () => {
  it("serves home-bred gilts on a standing heat at about 210-240 days and 135-150 kg", () => {
    const input = config();
    input.project.months = 30;
    input.project.variation = "settled";

    // The floors cannot be the target: a gilt is served on a heat, so the age
    // the plan really breeds at is puberty plus the cycles she is held for.
    expect(expectedGiltServiceAgeDays(input)).toBeGreaterThanOrEqual(210);
    expect(expectedGiltServiceAgeDays(input)).toBeLessThanOrEqual(240);

    const served = firstServices(input);
    expect(served.length).toBeGreaterThan(10);

    expect(median(served.map((entry) => entry.ageDays))).toBeGreaterThanOrEqual(210);
    expect(median(served.map((entry) => entry.ageDays))).toBeLessThanOrEqual(240);
    expect(median(served.map((entry) => entry.weightKg))).toBeGreaterThanOrEqual(135);
    expect(median(served.map((entry) => entry.weightKg))).toBeLessThanOrEqual(150);

    // A whole cycle of slack either way, because a gilt short of her weight on
    // one heat waits three weeks for the next rather than a day for the scale —
    // but no straggler far outside the band.
    const inBand = served.filter((e) => e.ageDays >= 210 && e.ageDays <= 240).length;
    expect(inBand / served.length).toBeGreaterThan(0.85);

    for (const entry of served) {
      // Served a whole number of cycles past her own first heat, never a part
      // of one, and never before the heat the plan holds her to.
      expect(Number.isInteger(entry.cycles)).toBe(true);
      expect(entry.cycles).toBeGreaterThanOrEqual(input.herd.giltServeAtHeat - 1);
    }
  });

  it("holds her a whole cycle longer when the plan waits for a later heat", () => {
    function medianAge(serveAtHeat: number) {
      const input = config();
      input.project.months = 30;
      input.project.variation = "settled";
      input.herd.giltServeAtHeat = serveAtHeat;
      return median(firstServices(input).map((entry) => entry.ageDays));
    }

    // Waiting for the third heat rather than the second costs about one cycle,
    // which is the whole point of counting heats instead of days.
    const gap = medianAge(3) - medianAge(2);
    expect(gap).toBeGreaterThanOrEqual(ESTRUS_CYCLE_DAYS - 7);
    expect(gap).toBeLessThanOrEqual(ESTRUS_CYCLE_DAYS + 7);
  });

  it("holds every home-bred gilt back until she meets both thresholds", () => {
    const input = config();
    input.project.months = 48;
    const farm = new Farm(input);
    const known = new Set(farm.sows.map((sow) => sow.tag));
    const entries: { ageDays: number; weightKg: number }[] = [];

    for (let day = 0; day <= horizonDay(input); day += 1) {
      farm.advanceTo(day);
      for (const sow of farm.sows) {
        if (known.has(sow.tag)) continue;
        known.add(sow.tag);
        if (!sow.homeBred) continue;
        entries.push({ ageDays: sow.ageDays(day), weightKg: sow.weightKg });
      }
    }

    expect(entries.length).toBeGreaterThan(5);
    for (const entry of entries) {
      expect(entry.ageDays).toBeGreaterThanOrEqual(input.herd.giltServiceAgeDays);
      expect(entry.weightKg).toBeGreaterThanOrEqual(input.herd.giltServiceWeightKg);
    }
  });
});

describe("Labour scales with the number of head", () => {
  it("hires another stockperson as the herd outgrows the last one", () => {
    const input = config();
    input.finance.pigsPerWorker = 120;
    const farm = runFarm(input);
    const first = farm.history[0];
    const last = farm.history.at(-1)!;

    expect(first.workers).toBe(input.finance.minimumWorkers);
    expect(last.counts.total).toBeGreaterThan(first.counts.total);
    expect(last.workers).toBeGreaterThan(first.workers);
    // Never more staff than the head count calls for, never fewer than the floor.
    for (const day of farm.history) {
      expect(day.workers).toBeGreaterThanOrEqual(input.finance.minimumWorkers);
      expect(day.workers).toBeLessThanOrEqual(Math.ceil(day.counts.total / 120) + 1);
    }
  });

  it("does not lay a stockperson off over one month's swing in the herd", () => {
    const input = config();
    input.project.months = 60;
    const farm = runFarm(input);
    const monthly = farm.history
      .filter((day, index) => index === 0 || day.workers !== farm.history[index - 1].workers)
      .map((day) => day.workers);

    // The payroll moves a handful of times over five years, not every month.
    expect(monthly.length).toBeGreaterThan(1);
    expect(monthly.length).toBeLessThan(8);
  });

  it("charges a whole wage for every stockperson, and charges it monthly", () => {
    const input = config();
    const result = calculateProjection(input);
    const wage = input.finance.labourCostPerWorkerMonth;
    const charged = result.months.map((month) => month.totals.labour);

    expect(charged.every((amount) => amount > 0)).toBe(true);
    expect(charged.every((amount) => Number.isInteger(amount / wage))).toBe(true);
    expect(charged.at(-1)!).toBeGreaterThan(charged[0]);
    expect(result.summary.totalCost).toBeGreaterThan(0);
  });

  it("keeps one stockperson on when the herd never outgrows the ratio", () => {
    const input = config();
    input.finance.pigsPerWorker = 5000;
    const farm = runFarm(input);
    expect(farm.history.every((day) => day.workers === 1)).toBe(true);
  });
});

describe("What a market pig costs reconciles with the cash book", () => {
  it("carries the breeding herd, net of its own sales, onto the pigs it produced", () => {
    const input = config();
    input.stock.sows = 20;
    input.herd.startMode = "staggered";
    input.project.months = 96;
    const farm = runFarm(input);
    const cop = farm.costOfProduction();

    // Sow and boar feed is the single largest cost the old readout left out.
    expect(cop.breedingCostPerPig).toBeGreaterThan(15);
    expect(cop.fullCostPerPig).toBeCloseTo(
      cop.directPerPig + cop.breedingCostPerPig + cop.allocatedOverheadPerPig,
      6,
    );
    expect(cop.marginPerPig).toBeCloseTo(cop.revenuePerPig - cop.fullCostPerPig, 6);
  });

  it("does not tell a different story from the money the farm actually made", () => {
    const input = config();
    input.stock.sows = 20;
    input.herd.startMode = "staggered";
    input.project.months = 96;
    const farm = runFarm(input);
    const cop = farm.costOfProduction();
    const cashNetPerPig =
      (incomeOf(farm.ledger.totals) - expensesOf(farm.ledger.totals)) / farm.lifetime.sold;

    // An allocation never matches the cash book to the cent, and the difference
    // has a name: everything the farm still owns on the last day was paid for out
    // of the cash book and has earned nothing yet — the pigs and sows standing in
    // the sheds, and the capital the plan opened with. So the allocated margin
    // must read ahead of the cash, by no more than what the farm is holding.
    // Measuring it that way rather than as a multiple of the margin keeps the
    // bound honest: a thinner margin does not make the same gap a bigger failure.
    //
    // Whether the plan makes money at all is a question for its prices, not for
    // the allocation, so it is not asserted here: the two have to agree with one
    // another whichever side of zero they land on. On the figures this test runs
    // they land below it, because heating a piglet to eight weeks on a gas
    // brooder at 2 kg a night costs more than the plan's margin.
    const standing =
      farm.pigs.reduce((total, pig) => total + (pig.alive ? pig.costs.total : 0), 0) +
      farm.sows.reduce((total, sow) => total + (sow.alive ? sow.costs.total : 0), 0) +
      farm.boars.reduce((total, boar) => total + (boar.alive ? boar.costs.total : 0), 0) +
      farm.ledger.totals.capital;
    expect(cop.marginPerPig).toBeGreaterThan(cashNetPerPig);
    expect(cop.marginPerPig - cashNetPerPig).toBeLessThan(standing / farm.lifetime.sold);

    // And the same farm with the brooders off is the same allocation, still
    // reading ahead of its cash book — this time with both sides in profit.
    const warm = runFarm({
      ...input,
      health: { ...input.health, heatedUntilAgeDays: 21 },
    });
    const warmCop = warm.costOfProduction();
    const warmCash =
      (incomeOf(warm.ledger.totals) - expensesOf(warm.ledger.totals)) / warm.lifetime.sold;
    expect(warmCash).toBeGreaterThan(0);
    expect(warmCop.marginPerPig).toBeGreaterThan(warmCash);
  });

  it("charges a dead pig's feed to the pigs that did reach the abattoir", () => {
    const healthy = config();
    healthy.stock.sows = 20;
    healthy.herd.startMode = "staggered";
    healthy.project.months = 60;
    const lossy = structuredClone(healthy);
    lossy.growth.weanerMortalityPct = 12;
    lossy.growth.growerMortalityPct = 10;
    lossy.growth.finisherMortalityPct = 10;

    const healthyCost = runFarm(healthy).costOfProduction().directPerPig;
    const lossyCost = runFarm(lossy).costOfProduction().directPerPig;
    expect(lossyCost).toBeGreaterThan(healthyCost);
  });
});

describe("Goods come by the lorryload, planned forwards from what was used", () => {
  function busyFarm(): PlannerConfig {
    const input = config();
    input.stock.sows = 20;
    input.herd.startMode = "staggered";
    input.project.months = 36;
    return input;
  }

  /** What a trip is carrying as feed, which is the part the allowance caps. */
  function feedOnBoard(trip: Trip): number {
    return trip.lines
      .filter((line) => line.store !== "gas" && line.store !== "bedding")
      .reduce((kg, line) => kg + line.kg, 0);
  }

  it("loads every ration due onto the same deck, up to what the farm allows", () => {
    const farm = runFarm(busyFarm());
    const trips = farm.haulage.trips;
    const gross = farm.config.feed.truckCapacityKg;
    const forFeed = gross - farm.config.feed.sundriesAllowanceKg;
    expect(trips.length).toBeGreaterThan(20);

    const supplies = trips.filter((trip) => trip.kind === "supplies");
    for (const trip of supplies) {
      // Nothing is loaded past the deck, and the feed on it never eats into the
      // weight held back for the sundries.
      expect(trip.payloadKg).toBeLessThanOrEqual(gross + 1e-6);
      expect(feedOnBoard(trip)).toBeLessThanOrEqual(forFeed + 1e-6);
      expect(trip.payloadKg).toBeCloseTo(
        trip.lines.reduce((kg, line) => kg + line.kg, 0),
        6,
      );
    }

    // The point of the change: a run carries a mixed order. Cut one ration at a
    // time, every load held one thing and the farm ran a lorry per bin.
    const mixed = supplies.filter(
      (trip) => new Set(trip.lines.map((line) => line.store)).size > 1,
    );
    expect(mixed.length).toBeGreaterThan(supplies.length / 2);

    // Full but for the last, which carries what the stores had left to take.
    const carryingFeed = supplies.filter((trip) => feedOnBoard(trip) > 0);
    for (const trip of carryingFeed.slice(0, -1)) {
      expect(feedOnBoard(trip)).toBeCloseTo(forFeed, 6);
    }
  });

  it("makes the trips the feed needs, not the trips the bins would have needed", () => {
    const input = busyFarm();
    const farm = runFarm(input);
    const forFeed = input.feed.truckCapacityKg - input.feed.sundriesAllowanceKg;

    const byRation = FEED_RATIONS.map((ration) =>
      farm.history.reduce((kg, day) => kg + day.feedByRation[ration], 0),
    );
    const total = byRation.reduce((sum, kg) => sum + kg, 0);

    // Pooled, the feed needs one lorry per full deck and one for the remainder.
    const carryingFeed = farm.haulage.trips.filter((trip) => feedOnBoard(trip) > 0).length;
    expect(carryingFeed).toBe(Math.ceil(total / forFeed));

    // A bin at a time, each ration rounded up to its own lorry — five part
    // loads instead of one, and that is trips the farm was paying for twice.
    const oneBinAtATime = byRation.reduce((trips, kg) => trips + Math.ceil(kg / forFeed), 0);
    expect(carryingFeed).toBeLessThan(oneBinAtATime);
  });

  it("delivers nothing the herd does not use, and delivers it before it is needed", () => {
    const input = busyFarm();
    const farm = runFarm(input);
    const eaten = farm.history.reduce((kg, day) => kg + day.sowFeedKg + day.growingFeedKg, 0);

    // Planned off feeding that has already happened, so the two agree exactly.
    expect(farm.lifetime.feedDeliveredKg).toBeCloseTo(eaten, 3);

    for (const trip of farm.haulage.trips) {
      expect(trip.day).toBeLessThanOrEqual(trip.neededFromDay);
      expect(trip.day).toBeGreaterThanOrEqual(0);
      expect(trip.neededFromDay - trip.day).toBeLessThanOrEqual(input.feed.feedBufferDays);
    }

    // A feed run lands the buffer ahead of the day the herd starts on it, unless
    // the plan has not been running long enough for the full buffer. Read on a
    // farm with the heaters off, so no gas bottle is riding along to pull a
    // trip's first day of need earlier than the feed's.
    const dry = runFarm({ ...input, health: { ...input.health, gasKgPerHeaterDay: 0 } });
    for (const trip of dry.haulage.trips.filter((one) => one.kind === "supplies")) {
      expect(trip.neededFromDay - trip.day).toBe(
        Math.min(input.feed.feedBufferDays, trip.neededFromDay),
      );
    }

    // The bins never run dry: on any day, what has landed covers what was eaten.
    let delivered = 0;
    let consumed = 0;
    for (const day of farm.history) {
      delivered += day.feedDeliveredKg;
      consumed += day.sowFeedKg + day.growingFeedKg;
      expect(delivered).toBeGreaterThanOrEqual(consumed - 1e-6);
    }
  });

  it("reads the same on any date, because the trips are anchored to the horizon", () => {
    const input = busyFarm();
    const wholePlan = runFarm(input).haulage.trips;
    const halfway = farmStateAt(input, "2028-06-15T23:00");

    const landedByThen = wholePlan.filter((trip) => trip.day <= halfway.day);
    expect(halfway.lifetime.lorries).toBe(landedByThen.length);

    // A journey is charged once, whatever was on it, so the delivery line by
    // that date is simply the trips made by then.
    expect(halfway.finance.totals["deliveries"]).toBeCloseTo(
      landedByThen.reduce((paid, trip) => paid + trip.cost, 0),
      6,
    );
  });

  it("puts the haulage on the pigs that ate the load", () => {
    const paid = busyFarm();
    // This is about the feed lorry, so the other stores are told to send
    // nothing: bedding is not charged for, and the gas is turned off entirely
    // rather than left to make journeys of its own between feed days.
    paid.housing.beddingDeliveryCost = 0;
    paid.health.gasKgPerHeaterDay = 0;
    const free = structuredClone(paid);
    free.feed.deliveryCostPerTrip = 0;

    const withTruck = runFarm(paid);
    const without = runFarm(free);

    // The lorry changes no biology at all: same pigs, same feed, same kilograms.
    expect(withTruck.lifetime.sold).toBe(without.lifetime.sold);
    expect(feedOf(withTruck.ledger.totals)).toBeCloseTo(feedOf(without.ledger.totals), 6);

    // It only adds money, and the money it adds is the trips it made. The
    // bedding lorry still runs, but it has been told its journey is free, so
    // every cent on the line came off a feed run.
    const haulage = withTruck.ledger.totals["deliveries"];
    const feedRuns = withTruck.haulage.trips.filter((trip) => trip.kind === "supplies");
    expect(haulage).toBeCloseTo(feedRuns.length * paid.feed.deliveryCostPerTrip, 6);
    expect(feedRuns.length).toBeGreaterThan(0);
    expect(without.ledger.totals["deliveries"]).toBe(0);

    // Every last cent of it reaches an animal, because each kilogram eaten is
    // known to have come off one particular load of one particular ration.
    const attributed = withTruck.history.reduce(
      (total, day) =>
        total +
        FEED_RATIONS.reduce(
          (perDay, ration) =>
            perDay +
            day.feedByRation[ration] *
              (withTruck.haulage.haulagePerKgByDay[ration]?.[day.day] ?? 0),
          0,
        ),
      0,
    );
    expect(attributed).toBeCloseTo(haulage, 3);

    const dearer = withTruck.costOfProduction();
    const cheaper = without.costOfProduction();
    expect(dearer.directPerPig).toBeGreaterThan(cheaper.directPerPig);
    expect(dearer.directByType.transport).toBeGreaterThan(cheaper.directByType.transport);
  });

  it("makes fewer, bigger trips when the farm runs a bigger truck", () => {
    const small = busyFarm();
    small.feed.truckCapacityKg = 1_000;
    const big = busyFarm();
    big.feed.truckCapacityKg = 5_000;

    const smallTruck = runFarm(small);
    const bigTruck = runFarm(big);

    expect(smallTruck.lifetime.lorries).toBeGreaterThan(bigTruck.lifetime.lorries * 2);
    expect(smallTruck.ledger.totals["deliveries"]).toBeGreaterThan(
      bigTruck.ledger.totals["deliveries"],
    );
    // The same feed either way — only the number of trips moves.
    expect(smallTruck.lifetime.feedDeliveredKg).toBeCloseTo(bigTruck.lifetime.feedDeliveredKg, 3);
  });

  it("reads the same opening months however far out the plan was drawn", () => {
    // The reason the fill runs forwards. Planned backwards, the opening load
    // came out as the whole plan's feed modulo a lorry, so asking for three
    // years instead of one changed what arrived in January and how many trips
    // month one was charged for — a difference of a whole trip on the default
    // plan. Forwards, the months two plans share are the same months.
    // A herd with enough volume that each store takes several full loads, so
    // there is something to compare beyond the part load each one ends on.
    const short = busyFarm();
    short.project.months = 12;
    const long = busyFarm();
    long.project.months = 36;

    const shortLoads = runFarm(short).haulage.trips.filter((trip) => feedOnBoard(trip) > 0);
    const longLoads = runFarm(long).haulage.trips.filter((trip) => feedOnBoard(trip) > 0);
    const horizon = horizonDay(short);

    // Every feed run the shorter plan makes — bar the part load it ends on — is
    // a run the longer plan makes on the same day carrying the same kilograms.
    expect(shortLoads.length).toBeGreaterThan(3);
    for (const [index, trip] of shortLoads.slice(0, -1).entries()) {
      expect(longLoads[index].day).toBe(trip.day);
      expect(feedOnBoard(longLoads[index])).toBeCloseTo(feedOnBoard(trip), 6);
    }
    // And the longer plan carries on past the shorter one's horizon.
    expect(longLoads.filter((trip) => trip.day > horizon).length).toBeGreaterThan(0);
  });

  it("gives a two-sow herd a full lorry, because a load costs a trip and not a bin", () => {
    // This reverses a guarantee the backwards fill used to make. A small herd
    // now takes a full lorry on day one and eats it over months. Nothing is lost
    // by that here: feed is charged as it is eaten and haulage as it lands, so
    // the load is one trip charged once rather than money spent early, and the
    // model has no store to overfill. A farm whose store really is that small
    // says so by lowering the truck capacity.
    const small = config();
    small.project.months = 12;
    const farm = runFarm(small);
    const forFeed = small.feed.truckCapacityKg - small.feed.sundriesAllowanceKg;
    const opening = farm.haulage.trips.find((trip) => feedOnBoard(trip) > 0)!;
    const eatenInAYear = farm.history.reduce(
      (kg, day) => kg + day.sowFeedKg + day.growingFeedKg,
      0,
    );

    expect(feedOnBoard(opening)).toBeCloseTo(forFeed, 6);
    // It is still a plan's worth of feed, not a year's: nothing is delivered
    // that the herd does not go on to eat.
    expect(feedOnBoard(opening)).toBeLessThan(eatenInAYear);

    const smaller = config();
    smaller.project.months = 12;
    smaller.feed.truckCapacityKg = 600;
    smaller.feed.sundriesAllowanceKg = 100;
    const cramped = runFarm(smaller).haulage.trips.find((trip) => feedOnBoard(trip) > 0)!;
    expect(feedOnBoard(cramped)).toBeCloseTo(500, 6);
  });

  it("shows the lorry in the day's activities, with the order it carried", () => {
    const input = busyFarm();
    const { days, months } = farmTimeline(input);
    const deliveryDay = days.find(
      (day) => day.events.filter((event) => event.type === "feed").length > 0,
    )!;

    const notes = deliveryDay.events.filter((event) => event.type === "feed");
    // A delivery note, not a single-line order: what came, and what was on it.
    for (const note of notes) {
      expect(note.label).toMatch(/^(Bedding lorry|Lorry) in, [\d,]+ kg: .+ \d[\d,]* kg/);
    }

    // And a supply run reads as the mixed order it is, several stores deep.
    // Thousands are separated with a bare comma and the order with a comma and
    // a space, so the line splits cleanly into what was on the lorry.
    const mixed = days
      .flatMap((day) => day.events)
      .find(
        (event) =>
          event.type === "feed" &&
          event.label.startsWith("Lorry in, ") &&
          event.label.split(": ")[1].split(", ").length > 1,
      )!;
    expect(mixed).toBeDefined();
    expect(mixed.label).toMatch(/^Lorry in, [\d,]+ kg: .+ kg, .+ kg/);

    // Zoomed out to a month, the same trips are counted rather than listed.
    const busyMonth = months.find((month) => month.lorriesIn > 1)!;
    expect(busyMonth.events.some((event) => event.label.includes("lorries"))).toBe(true);
  });

  it("brings the gas in the weight held back for it, and never with the bedding", () => {
    const input = busyFarm();
    const farm = runFarm(input);
    const gross = input.feed.truckCapacityKg;
    const trips = farm.haulage.trips;

    const carryingGas = trips.filter((trip) => trip.lines.some((line) => line.store === "gas"));
    expect(carryingGas.length).toBeGreaterThan(0);
    // Most bottles come in on a run that was happening anyway: they ride in the
    // space held back for them, so they cost the farm no journey of their own.
    const riding = carryingGas.filter((trip) => feedOnBoard(trip) > 0);
    expect(riding.length).toBeGreaterThan(carryingGas.length / 2);
    for (const trip of carryingGas) {
      expect(trip.kind).toBe("supplies");
      expect(trip.payloadKg).toBeLessThanOrEqual(gross + 1e-6);
      expect(trip.lines.some((line) => line.store === "bedding")).toBe(false);
    }

    // Bedding travels alone, always. Nothing else is ever on the deck with it.
    const beddingTrips = trips.filter((trip) =>
      trip.lines.some((line) => line.store === "bedding"),
    );
    expect(beddingTrips.length).toBeGreaterThan(0);
    for (const trip of beddingTrips) {
      expect(trip.kind).toBe("bedding");
      expect(trip.lines).toHaveLength(1);
      expect(trip.cost).toBe(input.housing.beddingDeliveryCost);
    }
    // And no supply run ever carries any.
    for (const trip of trips.filter((one) => one.kind === "supplies")) {
      expect(trip.lines.some((line) => line.store === "bedding")).toBe(false);
    }
  });

  it("spreads a journey over everything that was on it", () => {
    const input = busyFarm();
    const farm = runFarm(input);

    // The delivery line is the journeys made, no more and no less.
    expect(farm.ledger.totals["deliveries"]).toBeCloseTo(
      farm.haulage.trips.reduce((paid, trip) => paid + trip.cost, 0),
      6,
    );

    // And every cent of the supply runs reaches the goods they carried: feed
    // through the pigs that ate it, gas through the piglets it warmed.
    const suppliesCost = farm.haulage.trips
      .filter((trip) => trip.kind === "supplies")
      .reduce((paid, trip) => paid + trip.cost, 0);
    const attributed = farm.history.reduce((total, day) => {
      const feed = FEED_RATIONS.reduce(
        (perDay, ration) =>
          perDay +
          day.feedByRation[ration] * (farm.haulage.haulagePerKgByDay[ration]?.[day.day] ?? 0),
        0,
      );
      return total + feed + day.gasKg * (farm.haulage.haulagePerKgByDay.gas?.[day.day] ?? 0);
    }, 0);
    expect(attributed).toBeCloseTo(suppliesCost, 3);
  });
});

describe("Income and costs the owner adds by hand", () => {
  it("lands the money in the month it is booked to, and nowhere else", () => {
    const plain = config();
    const added = config();
    added.finance.cashMovements = [
      { id: "a", monthIndex: 3, kind: "in", amount: 20_000, note: "Grant", auto: false },
      { id: "b", monthIndex: 24, kind: "out", amount: 5_000, note: "Roof repair", auto: false },
    ];

    const before = calculateProjection(plain);
    const after = calculateProjection(added);

    // Nothing moves until the month it is booked to.
    expect(after.months[2].closingCash).toBeCloseTo(before.months[2].closingCash, 6);
    expect(after.months[4].totals["other-income"]).toBeCloseTo(
      before.months[4].totals["other-income"],
      6,
    );

    // It joins the farm's own general lines rather than a line of its own.
    expect(after.months[3].totals["other-income"]).toBeCloseTo(
      before.months[3].totals["other-income"] + 20_000,
      6,
    );
    expect(after.months[24].totals.overheads).toBeCloseTo(
      before.months[24].totals.overheads + 5_000,
      6,
    );

    // From there on the balance carries it.
    expect(after.months[3].closingCash).toBeCloseTo(before.months[3].closingCash + 20_000, 6);
    expect(after.summary.peakFundingNeed).toBeLessThan(before.summary.peakFundingNeed);
  });

  it("is money, not pigs: the herd and what it produces do not move", () => {
    const plain = config();
    const added = config();
    added.finance.cashMovements = [
      { id: "a", monthIndex: 6, kind: "in", amount: 30_000, note: "", auto: false },
      { id: "b", monthIndex: 12, kind: "out", amount: 9_000, note: "", auto: false },
    ];

    const before = calculateProjection(plain);
    const after = calculateProjection(added);

    expect(after.summary.totalPigsSold).toBe(before.summary.totalPigsSold);
    expect(after.summary.totalWeaned).toBe(before.summary.totalWeaned);
    expect(after.summary.totalRevenue).toBeCloseTo(before.summary.totalRevenue + 30_000, 6);

    // A cost the owner adds is a cost of the business, so it is carried over the
    // pigs sold like any other overhead — and the contingency covers it too.
    expect(after.costOfProduction.fullCostPerPig).toBeGreaterThan(
      before.costOfProduction.fullCostPerPig,
    );
    expect(after.months[12].totals.contingency).toBeGreaterThan(
      before.months[12].totals.contingency,
    );
  });

  it("ignores a row booked past the end of the plan", () => {
    const input = config();
    input.finance.cashMovements = [
      { id: "a", monthIndex: input.project.months + 5, kind: "in", amount: 50_000, note: "", auto: false },
    ];

    const projection = calculateProjection(input);
    expect(projection.summary.closingCash).toBeCloseTo(
      calculateProjection(config()).summary.closingCash,
      6,
    );
  });
});

describe("Funding the plan: cash in to stay solvent, cash out when it is spare", () => {
  function fundedPlan(workingCapital: number) {
    const input = config();
    input.finance.workingCapitalTarget = workingCapital;
    return input;
  }

  it("injects exactly enough, month by month, to never close below the target", () => {
    const input = fundedPlan(2_500);
    const bare = calculateProjection(input);
    expect(bare.summary.peakFundingNeed).toBeGreaterThan(0);

    input.finance.cashMovements = planCashInjections(input, bare);
    const funded = calculateProjection(input);

    expect(input.finance.cashMovements.length).toBeGreaterThan(0);
    for (const month of funded.months) {
      expect(month.closingCash).toBeGreaterThanOrEqual(2_500 - 0.02);
    }
    // Enough, and not a penny more: some month sits exactly on the target.
    const lowest = Math.min(...funded.months.map((month) => month.closingCash));
    expect(lowest).toBeCloseTo(2_500, 1);
    expect(funded.summary.peakFundingNeed).toBe(0);
  });

  it("takes the surplus out without ever putting a later month short", () => {
    const input = fundedPlan(3_000);
    input.stock.sows = 20;
    input.herd.startMode = "staggered";
    input.project.months = 60;

    // Fund it first, so there is a surplus to take out at all.
    const bare = calculateProjection(input);
    input.finance.cashMovements = planCashInjections(input, bare);
    const funded = calculateProjection(input);

    input.finance.cashMovements = [
      ...input.finance.cashMovements,
      ...planCashWithdrawals(input, funded),
    ];
    const drawn = calculateProjection(input);

    expect(generatedTotal(input.finance.cashMovements, "out")).toBeGreaterThan(0);
    for (const month of drawn.months) {
      expect(month.closingCash).toBeGreaterThanOrEqual(3_000 - 0.02);
    }
    // The business is left with its working capital and no more.
    expect(drawn.summary.closingCash).toBeCloseTo(3_000, 1);
    // Four full 60-month runs of a 20-sow herd: over vitest's 5s default.
  }, 30_000);

  it("is financing, not farming: it costs nothing to service", () => {
    const plain = config();
    const drawn = config();
    drawn.finance.cashMovements = [
      { id: "auto-out-20", monthIndex: 20, kind: "out", amount: 4_000, note: "Cash withdrawal", auto: true },
    ];

    const before = calculateProjection(plain);
    const after = calculateProjection(drawn);

    // It shows in the cashflow under fixed overheads, as every other cost does.
    expect(after.months[20].totals.overheads).toBeCloseTo(
      before.months[20].totals.overheads + 4_000,
      6,
    );
    // But no contingency is charged on it, and no pig is any dearer for it.
    expect(after.months[20].totals.contingency).toBeCloseTo(
      before.months[20].totals.contingency,
      6,
    );
    expect(after.costOfProduction.fullCostPerPig).toBeCloseTo(
      before.costOfProduction.fullCostPerPig,
      6,
    );
    expect(after.summary.closingCash).toBeCloseTo(before.summary.closingCash - 4_000, 6);
  });

  it("gives the same answer however many times the button is pressed", () => {
    const input = fundedPlan(1_000);
    const once = planCashInjections(input, calculateProjection(input));

    const repeated = { ...input, finance: { ...input.finance, cashMovements: once } };
    const kept = repeated.finance.cashMovements.filter(
      (movement) => !isGenerated(movement, "in"),
    );
    const base = { ...repeated, finance: { ...repeated.finance, cashMovements: kept } };
    const twice = planCashInjections(base, calculateProjection(base));

    expect(twice).toEqual(once);
  });
});

describe("Pigs leave in cohorts, on the lorry, the day they are sold", () => {
  function busyFarm(months = 36): PlannerConfig {
    const input = config();
    input.stock.sows = 20;
    input.herd.startMode = "staggered";
    input.project.months = months;
    return input;
  }

  it("sells a cohort together, on the day its average reaches sale weight", () => {
    const input = config();
    const target = input.growth.saleWeightKg;
    const farm = new Farm(input).advanceTo(1);

    // Three litter mates: one behind the batch, one on it, one ahead. Entire
    // males, so none of them is taken out of the batch as a replacement gilt.
    farm.pigs.push(
      pig({ id: "A", tag: "A", sex: "male", birthDay: 1, weightKg: target - 14 }),
      pig({ id: "B", tag: "B", sex: "male", birthDay: 1, weightKg: target - 4 }),
      pig({ id: "C", tag: "C", sex: "male", birthDay: 1, weightKg: target + 6 }),
    );

    const cohort = () => farm.pigs.filter((animal) => animal.birthDay === 1);
    let lastAverage = 0;
    let saleDay = -1;
    for (let day = 2; day <= 200 && saleDay < 0; day += 1) {
      const standing = cohort();
      lastAverage = standing.reduce((total, animal) => total + animal.weightKg, 0) / 3;
      farm.advanceTo(day);
      if (cohort().length === 0) saleDay = day;
      // A cohort is never split: they are all there, or all gone.
      else expect(cohort()).toHaveLength(3);
    }

    expect(saleDay).toBeGreaterThan(1);
    // The heaviest was over the target well before the batch went.
    expect(lastAverage).toBeLessThan(target);
    const sold = farm.history.at(-1)!;
    expect(sold.sold).toBe(3);
    // They averaged the target between them, which means one went under it.
    expect(sold.soldLiveweightKg / 3).toBeGreaterThanOrEqual(target);
    expect(sold.soldLiveweightKg / 3).toBeLessThan(target + 2);
    // They travel alive, the same day, and three pigs is one lorry.
    expect(sold.marketTrips).toBe(1);
  });

  it("sends the lorry on the day of the sale, as often as the head needs", () => {
    const input = busyFarm();
    const farm = runFarm(input);
    const capacity = input.finance.marketTruckCapacityPigs;

    const saleDays = farm.history.filter((day) => day.sold > 0);
    expect(saleDays.length).toBeGreaterThan(10);

    for (const day of farm.history) {
      expect(day.marketTrips).toBe(Math.ceil(day.sold / capacity));
    }
    // Nothing goes out on a day with no pigs sold, and every sale day travels.
    for (const day of saleDays) expect(day.marketTrips).toBeGreaterThan(0);
  });

  it("takes more than one run when the cohort will not fit on the lorry", () => {
    const small = busyFarm();
    small.finance.marketTruckCapacityPigs = 4;
    const farm = runFarm(small);

    const biggest = farm.history.reduce((most, day) => (day.sold > most.sold ? day : most));
    expect(biggest.sold).toBeGreaterThan(4);
    expect(biggest.marketTrips).toBe(Math.ceil(biggest.sold / 4));
    expect(farm.lifetime.marketHaulageCost).toBeCloseTo(
      farm.lifetime.marketTrips * small.finance.marketTripCost,
      6,
    );
    // A bigger lorry is fewer runs for the same pigs.
    const roomy = busyFarm();
    roomy.finance.marketTruckCapacityPigs = 40;
    expect(runFarm(roomy).lifetime.marketTrips).toBeLessThan(farm.lifetime.marketTrips);
  });

  it("charges the run to the pigs that were on it, not to the farm at large", () => {
    const input = busyFarm(24);
    const farm = runFarm(input);
    const dearer = { ...structuredClone(input) };
    dearer.finance.marketTripCost = input.finance.marketTripCost * 2;
    const dearFarm = runFarm(dearer);

    expect(farm.lifetime.marketTrips).toBe(dearFarm.lifetime.marketTrips);
    // Doubling the trip lands on the pig, and on the transport line, not on overheads.
    const extra = farm.lifetime.marketHaulageCost;
    expect(dearFarm.ledger.totals.transport).toBeCloseTo(
      farm.ledger.totals.transport + extra,
      6,
    );
    expect(dearFarm.ledger.totals.overheads).toBeCloseTo(farm.ledger.totals.overheads, 6);
    expect(dearFarm.costOfProduction().directPerPig).toBeGreaterThan(
      farm.costOfProduction().directPerPig,
    );
  });
});
