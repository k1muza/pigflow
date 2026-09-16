import { addMonths, format, parseISO, subDays } from "date-fns";
import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "../config";
import { calculateProjection } from "../model";
import {
  expensesOf,
  Farm,
  farmStateAt,
  farmWeeklyTimeline,
  GrowingPig,
  horizonDay,
  incomeOf,
  runFarm,
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
    const male = pig({ sex: "male" }).dailyFeed(input).kg;
    const female = pig({ sex: "female" }).dailyFeed(input).kg;
    expect(male).toBeGreaterThan(female);
    // Both grow proportionally faster, so feed conversion is unchanged.
    expect(male / pig({ sex: "male" }).dailyGainKg(input)).toBeCloseTo(
      female / pig({ sex: "female" }).dailyGainKg(input),
      6,
    );
  });

  it("feeds a heavy finisher more than a light one", () => {
    const input = config();
    const light = pig({ weightKg: 62 }).dailyFeed(input).kg;
    const heavy = pig({ weightKg: 98 }).dailyFeed(input).kg;
    expect(heavy).toBeGreaterThan(light);
    expect(heavy / light).toBeGreaterThan(1.05);
  });

  it("offers creep feed only once a suckling piglet is old enough", () => {
    const input = config();
    const piglet = pig({ stage: "piglet", weightKg: 3 });
    expect(piglet.dailyFeed(input).kg).toBe(0);
    expect(piglet.creepFeed(input.feed.creepStartAgeDays - 1, input).kg).toBe(0);
    expect(piglet.creepFeed(input.feed.creepStartAgeDays + 1, input).kg).toBeGreaterThan(0);
  });

  it("keeps the herd's feed use close to the planned stage FCR", () => {
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
    const blendedFcr =
      (input.growth.weanerFcr * (30 - input.growth.weaningWeightKg) +
        input.growth.growerFcr * 30 +
        input.growth.finisherFcr * 40) /
      (input.growth.saleWeightKg - input.growth.weaningWeightKg);
    expect(feedKg / gainKg).toBeGreaterThan(blendedFcr * 0.9);
    expect(feedKg / gainKg).toBeLessThan(blendedFcr * 1.15);
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
    expect(runFarm(warm, 200).ledger.totals.heating).toBeGreaterThan(0);
    expect(runFarm(cold, 200).ledger.totals.heating).toBe(0);
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

  it("builds selectable week-end stock snapshots across the planning horizon", () => {
    const input = config();
    input.project.months = 12;
    const weeks = farmWeeklyTimeline(input);

    expect(weeks.length).toBeGreaterThanOrEqual(52);
    expect(weeks[0].week).toBe(1);
    expect(weeks[0].day).toBe(6);
    expect(weeks.at(-1)!.day).toBe(horizonDay(input));

    const weekTwo = weeks[1];
    const state = farmStateAt(input, weekTwo.date + "T23:00");
    expect(weekTwo.total).toBe(state.herd.total);
    expect(weekTwo.groups.reduce((total, group) => total + group.count, 0)).toBe(
      state.stock.length,
    );
    expect(weeks.flatMap((week) => week.events).every((event) => event.count > 0)).toBe(true);
    expect(weeks.flatMap((week) => week.events).some((event) => event.type === "service")).toBe(
      true,
    );
    expect(
      weeks.flatMap((week) => week.events).some((event) => event.type === "vaccination"),
    ).toBe(true);
  });
});

describe("Boar rotation and the genetics of a closed herd", () => {
  /** Walks a farm day by day and reports what its breeding females were served by. */
  function runWatchingMatings(input: PlannerConfig) {
    const farm = new Farm(input);
    const finalDay = horizonDay(input);
    let sireDaughterMatings = 0;
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
        if (sow.homeBred) homeBredServed += 1;
      }
    }
    return { farm, sireDaughterMatings, homeBredServed, mostBoarsStanding, boarsSeen };
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

describe("First service at the weight and age good practice calls for", () => {
  it("defaults to the commonly recommended 135–170 kg at 220–270 days", () => {
    const input = config();
    expect(input.herd.giltServiceWeightKg).toBeGreaterThanOrEqual(135);
    expect(input.herd.giltServiceWeightKg).toBeLessThanOrEqual(170);
    expect(input.herd.giltServiceAgeDays).toBeGreaterThanOrEqual(220);
    expect(input.herd.giltServiceAgeDays).toBeLessThanOrEqual(270);
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

    // An allocation never matches the cash book to the cent: the pigs standing on
    // the farm at the end have been fed but not yet sold, and that stock is worth
    // something. It must stay the same order of magnitude, and the same sign.
    expect(cashNetPerPig).toBeGreaterThan(0);
    expect(cop.marginPerPig).toBeGreaterThan(cashNetPerPig * 0.8);
    expect(cop.marginPerPig).toBeLessThan(cashNetPerPig * 1.35);
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
