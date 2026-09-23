import { addDays, format, parseISO } from "date-fns";

import { plannerSchema, type PlannerConfig, type Vaccination } from "./config";
import { Engine, engineHorizonDay } from "./engine/engine";
import type { DomainEvent } from "./engine/events";
import {
  Animal,
  Boar,
  Farm,
  GrowingPig,
  Sow,
  horizonDay,
  type DayRecord,
  type FarmEvent,
  type StockKind,
} from "./sim";

export type PigDailyRecord = {
  day: number;
  date: string;
  ageDays: number;
  kind: StockKind;
  status: string;
  weightKg: number;
  dailyGainKg: number | null;
  underHeat: boolean;
  farmHeatersAlight: number;
  farmHeatingGasKg: number;
  allocatedHeatingGasKg: number;
  care: string[];
};

export type PigDataEvent = {
  day: number;
  date: string;
  ageDays: number | null;
  type: string;
  event: string;
  detail: string;
  source: "simulation" | "care schedule" | "derived";
};

export type PigDatasheet = {
  projectName: string;
  engine: string;
  tag: string;
  sex: "female" | "male";
  generation: number | null;
  damTag: string | null;
  sireTag: string | null;
  origin: string;
  birthDay: number | null;
  birthDate: string | null;
  firstSeenDay: number;
  firstSeenDate: string;
  lastSeenDay: number | null;
  lastSeenDate: string | null;
  exitDay: number | null;
  exitDate: string | null;
  exitReason: string | null;
  daily: PigDailyRecord[];
  events: PigDataEvent[];
};

type MinimalDayRecord = Pick<DayRecord, "day" | "date" | "gasKg" | "gasHeaters">;

type TraceRun = {
  config: PlannerConfig;
  horizon: number;
  advanceTo(day: number): void;
  sows(): readonly Sow[];
  boars(): readonly Boar[];
  pigs(): readonly GrowingPig[];
  dayRecord(): MinimalDayRecord | null;
  pedigree(): ReturnType<Farm["pedigree"]["records"]>;
  simulationEvents(tag: string): PigDataEvent[];
};

function traceRun(input: PlannerConfig): TraceRun {
  const config = plannerSchema.parse(input);
  if (config.project.engine === "2.0") {
    const engine = new Engine(config, { keepEveryEvent: true });
    const world = engine.world;
    return {
      config,
      horizon: engineHorizonDay(config),
      advanceTo: (day) => engine.advanceTo(day),
      sows: () => world.sows,
      boars: () => world.boars,
      pigs: () => world.pigs,
      dayRecord: () => (world.history.at(-1) ?? null) as MinimalDayRecord | null,
      pedigree: () => world.pedigree.records(),
      simulationEvents: (tag) =>
        world.log.events
          .filter((event) => event.entities?.includes(tag))
          .filter((event) => event.type !== "ProcessingDone")
          .map((event) => domainEventRow(event, tag)),
    };
  }

  const farm = new Farm(config, undefined, { keepEveryEvent: true });
  return {
    config,
    horizon: horizonDay(config),
    advanceTo: (day) => {
      farm.advanceTo(day);
    },
    sows: () => farm.sows,
    boars: () => farm.boars,
    pigs: () => farm.pigs,
    dayRecord: () => (farm.history.at(-1) ?? null) as MinimalDayRecord | null,
    pedigree: () => farm.pedigree.records(),
    // The legacy log does not carry entity ids. It is still useful for breeding
    // animals because those messages name the animal explicitly.
    simulationEvents: (tag) =>
      farm.events
        .filter((event) => event.message.includes(tag))
        .map((event) => farmEventRow(event, tag, farm.start)),
  };
}

function domainEventRow(event: DomainEvent, tag: string): PigDataEvent {
  return {
    day: event.day,
    date: event.date,
    ageDays: null,
    type: event.type,
    event: event.message,
    detail: event.cause ?? (event.entities?.filter((entity) => entity !== tag).join(", ") || ""),
    source: "simulation",
  };
}

function farmEventRow(event: FarmEvent, _tag: string, start: Date): PigDataEvent {
  return {
    day: event.day,
    date: event.date || format(addDays(start, event.day), "yyyy-MM-dd"),
    ageDays: null,
    type: event.type,
    event: event.message,
    detail: "",
    source: "simulation",
  };
}

function activeAnimal(run: TraceRun, tag: string): Animal | null {
  return (
    run.sows().find((animal) => animal.tag === tag && animal.alive) ??
    run.boars().find((animal) => animal.tag === tag && animal.alive) ??
    run.pigs().find((animal) => animal.tag === tag && animal.alive) ??
    null
  );
}

function anyAnimal(run: TraceRun, tag: string): Animal | null {
  return (
    activeAnimal(run, tag) ??
    run.sows().find((animal) => animal.tag === tag) ??
    run.boars().find((animal) => animal.tag === tag) ??
    run.pigs().find((animal) => animal.tag === tag) ??
    null
  );
}

function kindOf(animal: Animal): StockKind {
  if (animal instanceof Sow) return "sow";
  if (animal instanceof Boar) return "boar";
  if (animal instanceof GrowingPig) return animal.stage;
  throw new Error("Unknown animal kind.");
}

function statusOf(animal: Animal): string {
  if (animal instanceof Sow) {
    return animal.state === "gestating"
      ? "In pig"
      : animal.state === "lactating"
        ? "Suckling"
        : "Awaiting service";
  }
  if (animal instanceof Boar) return "Working boar";
  if (animal instanceof GrowingPig) {
    return animal.destination === "breeding" ? "Replacement" : "Market";
  }
  return "On farm";
}

function scheduleApplies(job: Vaccination, sex: "female" | "male"): boolean {
  if (job.appliesTo === "all") return true;
  return job.appliesTo === (sex === "male" ? "males" : "females");
}

function careScheduleEvents(
  config: PlannerConfig,
  sheet: Pick<
    PigDatasheet,
    "sex" | "birthDay" | "firstSeenDay" | "lastSeenDay" | "daily"
  >,
): PigDataEvent[] {
  if (sheet.birthDay === null || sheet.lastSeenDay === null) return [];
  const byDay = new Map(sheet.daily.map((row) => [row.day, row]));
  const events: PigDataEvent[] = [];

  for (const job of config.health.vaccinations) {
    if (!scheduleApplies(job, sheet.sex)) continue;
    const dueDay = Math.ceil(sheet.birthDay + job.ageDays);
    if (dueDay > sheet.lastSeenDay) continue;

    const type = job.kind === "processing" ? "Processing" : "Vaccination";
    if (dueDay < sheet.firstSeenDay) {
      events.push({
        day: dueDay,
        date: format(addDays(parseISO(config.project.startDate), dueDay), "yyyy-MM-dd"),
        ageDays: Math.round(job.ageDays),
        type,
        event: job.name,
        detail: "Assumed completed before this animal entered the simulated plan.",
        source: "care schedule",
      });
      continue;
    }

    const row = byDay.get(dueDay);
    if (!row || row.kind === "sow" || row.kind === "boar") continue;
    events.push({
      day: dueDay,
      date: row.date,
      ageDays: row.ageDays,
      type,
      event: job.name,
      detail: `Scheduled at age ${job.ageDays} days · configured unit cost ${job.costPerPig.toFixed(2)}`,
      source: "care schedule",
    });
  }

  return events;
}

function stageEvents(daily: readonly PigDailyRecord[]): PigDataEvent[] {
  const events: PigDataEvent[] = [];
  let previous: PigDailyRecord | null = null;

  for (const row of daily) {
    if (previous && row.kind !== previous.kind) {
      events.push({
        day: row.day,
        date: row.date,
        ageDays: row.ageDays,
        type: "Stage change",
        event: `${previous.kind} → ${row.kind}`,
        detail: row.status,
        source: "derived",
      });
    } else if (previous && row.status !== previous.status) {
      events.push({
        day: row.day,
        date: row.date,
        ageDays: row.ageDays,
        type: "Status change",
        event: row.status,
        detail: `Previously ${previous.status}`,
        source: "derived",
      });
    }
    previous = row;
  }

  return events;
}

function heatingEvents(daily: readonly PigDailyRecord[]): PigDataEvent[] {
  const events: PigDataEvent[] = [];
  let from: PigDailyRecord | null = null;
  let last: PigDailyRecord | null = null;

  const close = () => {
    if (!from || !last) return;
    const days = last.day - from.day + 1;
    events.push({
      day: from.day,
      date: from.date,
      ageDays: from.ageDays,
      type: "Heating",
      event: "Supplementary heat",
      detail:
        days === 1
          ? "Under heat for 1 simulated day."
          : `Under heat for ${days} simulated days, through ${last.date}.`,
      source: "derived",
    });
    from = null;
    last = null;
  };

  for (const row of daily) {
    if (row.underHeat) {
      if (from === null) from = row;
      last = row;
    } else {
      close();
    }
  }
  close();
  return events;
}

function attachCareToDays(
  daily: PigDailyRecord[],
  events: readonly PigDataEvent[],
): void {
  const byDay = new Map<number, string[]>();
  for (const event of events) {
    if (event.day < 0) continue;
    const labels = byDay.get(event.day) ?? [];
    labels.push(event.type + ": " + event.event);
    byDay.set(event.day, labels);
  }
  for (const row of daily) row.care = byDay.get(row.day) ?? [];
}

/**
 * Re-runs a plan only when somebody asks for one animal's sheet.
 *
 * Keeping one row per animal per day in the normal simulation result would make
 * every page carry a very large payload for an export button most people never
 * press. This trace instead follows just the selected tag, off-thread.
 */
export function pigDatasheetFor(input: PlannerConfig, tag: string): PigDatasheet {
  const run = traceRun(input);
  const start = parseISO(run.config.project.startDate);
  const daily: PigDailyRecord[] = [];
  let known: Animal | null = null;
  let previousWeight: number | null = null;
  let exitDay: number | null = null;
  let exitReason: string | null = null;

  for (let day = 0; day <= run.horizon; day += 1) {
    run.advanceTo(day);

    const active = activeAnimal(run, tag);
    if (active) known = active;
    else if (known === null) known = anyAnimal(run, tag);

    const animal = active ?? (known?.exitDay === day ? known : null);
    if (animal === null) continue;

    if (!animal.alive && animal.exitDay === day) {
      exitDay = day;
      exitReason = animal.exitReason;
    }

    const record = run.dayRecord();
    const ageDays = animal.ageDays(day);
    const underHeatEligible =
      animal instanceof GrowingPig &&
      ageDays >= 0 &&
      ageDays < run.config.health.heatedUntilAgeDays;
    const underHeat =
      underHeatEligible &&
      (record?.gasHeaters ?? 0) > 0 &&
      (record?.gasKg ?? 0) > 0;

    const heatedHead = run.pigs().filter(
      (pig) =>
        pig.alive &&
        pig.ageDays(day) >= 0 &&
        pig.ageDays(day) < run.config.health.heatedUntilAgeDays,
    ).length;
    const allocatedHeatingGasKg =
      underHeat && heatedHead > 0 ? (record?.gasKg ?? 0) / heatedHead : 0;

    const weightKg = animal.weightKg;
    daily.push({
      day,
      date: record?.date ?? format(addDays(start, day), "yyyy-MM-dd"),
      ageDays,
      kind: kindOf(animal),
      status: !animal.alive && animal.exitReason ? `Left farm · ${animal.exitReason}` : statusOf(animal),
      weightKg,
      dailyGainKg: previousWeight === null ? null : weightKg - previousWeight,
      underHeat,
      farmHeatersAlight: record?.gasHeaters ?? 0,
      farmHeatingGasKg: record?.gasKg ?? 0,
      allocatedHeatingGasKg,
      care: [],
    });
    previousWeight = weightKg;
  }

  const pedigree = run.pedigree().find((row) => row.tag === tag);
  if (!pedigree) throw new Error(`Pig ${tag} was not found in this simulation.`);

  const firstSeenDay = pedigree.firstSeenDay;
  const lastSeenDay = daily.at(-1)?.day ?? null;
  const base: PigDatasheet = {
    projectName: run.config.project.name,
    engine: run.config.project.engine,
    tag,
    sex: pedigree.sex,
    generation: pedigree.generation,
    damTag: pedigree.damTag,
    sireTag: pedigree.sireTag,
    origin: pedigree.origin,
    birthDay: pedigree.birthDay,
    birthDate:
      pedigree.birthDay === null
        ? null
        : format(addDays(start, pedigree.birthDay), "yyyy-MM-dd"),
    firstSeenDay,
    firstSeenDate: format(addDays(start, firstSeenDay), "yyyy-MM-dd"),
    lastSeenDay,
    lastSeenDate:
      lastSeenDay === null ? null : format(addDays(start, lastSeenDay), "yyyy-MM-dd"),
    exitDay,
    exitDate: exitDay === null ? null : format(addDays(start, exitDay), "yyyy-MM-dd"),
    exitReason,
    daily,
    events: [],
  };

  const care = careScheduleEvents(run.config, base);
  const events = [
    ...care,
    ...heatingEvents(daily),
    ...stageEvents(daily),
    ...run.simulationEvents(tag),
  ].sort(
    (a, b) =>
      a.day - b.day ||
      a.type.localeCompare(b.type) ||
      a.event.localeCompare(b.event),
  );

  attachCareToDays(daily, events.filter((event) => event.source === "care schedule"));
  base.events = events;
  return base;
}
