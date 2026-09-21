import type { Workbook } from "exceljs";

import type { PlannerConfig } from "../config";
import type { MonthlyProjection, ProjectionSummary } from "../model";
import type { PlanSimulationResult } from "../simulation-result";
import { periodsAt, provenance, reportingPeriod, type ReportPeriod } from "./periods";
import {
  applyBase,
  monthCellDate,
  NUMBER_FORMAT,
  PORTRAIT_PAGE,
  ruleRow,
  styleTableHeader,
  styleTitle,
} from "./sheet";
import { addStatementSheet, type StatementRow } from "./statement";

/**
 * The breeding herd and the growing stock, month by month.
 *
 * Two different kinds of figure live on this plan and they are not added
 * together. A count is what is standing at the month end: it is read off the
 * last day of the period and a year's count is the count on its last day, not
 * twelve of them summed. A flow is what happened during the period: it is added
 * up, and a year's flow is the sum of its months. Confusing the two is how a
 * herd plan comes to report four thousand sows.
 *
 * Every figure is read off {@link MonthlyProjection}, which is the same roll-up
 * the money page, the simulator and the funding workbook read. Nothing here
 * counts an animal.
 */

/** One period of the herd plan: what was standing, and what moved. */
export type HerdPeriod = {
  key: string;
  label: string;
  span: string;
  startDate: string;
  endDate: string;
  /** What was standing at the close of the period. */
  closing: {
    sows: number;
    gestatingSows: number;
    lactatingSows: number;
    openSows: number;
    replacementGilts: number;
    boars: number;
    piglets: number;
    weaners: number;
    growers: number;
    finishers: number;
    breedingStock: number;
    head: number;
  };
  /** What happened over the period. */
  flows: {
    born: number;
    weaned: number;
    sold: number;
    giltsSold: number;
    deaths: number;
    giltsSelected: number;
    giltsPromoted: number;
    breedingStockCulled: number;
  };
  /** The most head the farm carried on any one day inside the period. */
  peakHead: number;
};

function herdPeriod(period: ReportPeriod): HerdPeriod {
  const months = period.months;
  const last = months[months.length - 1];
  const sum = (pick: (month: MonthlyProjection) => number) =>
    months.reduce((total, month) => total + pick(month), 0);
  return {
    key: period.key,
    label: period.label,
    span: period.span,
    startDate: period.startDate,
    endDate: period.endDate,
    closing: {
      sows: last.sows,
      gestatingSows: last.gestatingSows,
      lactatingSows: last.lactatingSows,
      openSows: last.openSows,
      replacementGilts: last.gilts,
      boars: last.boars,
      piglets: last.piglets,
      weaners: last.weaners,
      growers: last.growers,
      finishers: last.finishers,
      breedingStock: last.breedingStock,
      head: last.head,
    },
    flows: {
      born: sum((month) => month.bornAlive),
      weaned: sum((month) => month.weaned),
      sold: sum((month) => month.pigsSold),
      giltsSold: sum((month) => month.giltsSold),
      deaths: sum((month) => month.deaths),
      giltsSelected: sum((month) => month.giltsSelected),
      giltsPromoted: sum((month) => month.giltsPromoted),
      // Both doors breeding stock leaves by other than dying: a sow culled at
      // the end of her parities, and a boar rotated off at the end of his life.
      breedingStockCulled: sum((month) => month.sowsCulled + month.boarsRotated),
    },
    peakHead: Math.max(0, ...months.map((month) => month.peakHead)),
  };
}

/** A point in the plan worth pointing at. */
export type HerdMilestone = {
  label: string;
  /** The month it happens in, or null if it never does within the horizon. */
  month: string | null;
  detail: string;
  value: number;
};

/** The highest a monthly figure ever gets, and the month it gets there. */
function peakOf(
  months: readonly MonthlyProjection[],
  pick: (month: MonthlyProjection) => number,
): { month: MonthlyProjection | null; value: number } {
  let best: MonthlyProjection | null = null;
  let value = 0;
  for (const month of months) {
    const figure = pick(month);
    if (best === null || figure > value) {
      best = month;
      value = figure;
    }
  }
  return { month: best, value };
}

export function herdMilestones(
  config: PlannerConfig,
  months: readonly MonthlyProjection[],
  /**
   * The herd figures the application worked out once. Passed in rather than
   * counted again here: the cashflow warning and this milestone used to answer
   * "did the herd reach its places?" separately, and on a herd that filled its
   * places and was then drawn down by culling they gave opposite answers in the
   * same workbook.
   */
  summary: ProjectionSummary,
): HerdMilestone[] {
  if (months.length === 0) return [];
  const milestones: HerdMilestone[] = [];

  const target = config.herd.maxSows;
  const reached = summary.sowCapacityReachedMonth;
  const finished = summary.finalSows;
  milestones.push({
    label: "Target sow herd reached",
    month: reached,
    value: target,
    detail: reached
      ? finished < target
        ? `The herd first stands at its ${target} sow places in ${reached}, peaks at ${summary.peakSows}, and finishes below capacity at ${finished} as culling and mortality take females out.`
        : `The herd first stands at its ${target} sow places in ${reached} and holds them to the end of the plan.`
      : `The herd does not reach its ${target} sow places within the plan. It peaks at ${summary.peakSows} and ends at ${finished}.`,
  });

  milestones.push({
    label: "Peak breeding sows",
    month: summary.peakSowsMonth,
    value: summary.peakSows,
    detail: `The most sows the herd ever stands, against ${target} places.`,
  });

  const head = peakOf(months, (month) => month.peakHead);
  milestones.push({
    label: "Peak total head count",
    month: head.month?.month ?? null,
    value: head.value,
    detail: "The most pigs on the place on any one day, breeding stock included. This is what has to be housed.",
  });

  const stages: [string, (month: MonthlyProjection) => number][] = [
    ["Peak piglets", (month) => month.piglets],
    ["Peak weaners", (month) => month.weaners],
    ["Peak growers", (month) => month.growers],
    ["Peak finishers", (month) => month.finishers],
    ["Peak replacement gilts", (month) => month.gilts],
  ];
  for (const [label, pick] of stages) {
    const peak = peakOf(months, pick);
    milestones.push({
      label,
      month: peak.month?.month ?? null,
      value: peak.value,
      detail: "Month-end count, which is what the stage has to hold.",
    });
  }

  return milestones;
}

export type HerdDevelopmentReport = {
  config: PlannerConfig;
  period: string;
  months: HerdPeriod[];
  years: HerdPeriod[];
  milestones: HerdMilestone[];
};

export function herdDevelopmentReport(result: PlanSimulationResult): HerdDevelopmentReport {
  return {
    config: result.config,
    period: reportingPeriod(result.config),
    months: periodsAt(result, "month").map(herdPeriod),
    years: periodsAt(result, "year").map(herdPeriod),
    milestones: herdMilestones(
      result.config,
      result.projection.months,
      result.projection.summary,
    ),
  };
}

// ------------------------------------------------------------- the worksheets

export const HERD_ROWS: StatementRow<HerdPeriod>[] = [
  { kind: "section", label: "BREEDING HERD AT THE PERIOD END" },
  { kind: "line", label: "Sows in pig", format: "number", value: (p) => p.closing.gestatingSows },
  { kind: "line", label: "Sows suckling", format: "number", value: (p) => p.closing.lactatingSows },
  { kind: "line", label: "Sows to serve", format: "number", value: (p) => p.closing.openSows },
  { kind: "total", label: "Breeding sows", format: "number", value: (p) => p.closing.sows },
  { kind: "line", label: "Boars", format: "number", value: (p) => p.closing.boars },
  {
    kind: "subtotal",
    label: "Total breeding stock",
    format: "number",
    value: (p) => p.closing.breedingStock,
  },
  { kind: "blank" },
  { kind: "section", label: "GROWING STOCK AT THE PERIOD END" },
  { kind: "line", label: "Piglets", format: "number", value: (p) => p.closing.piglets },
  { kind: "line", label: "Weaners", format: "number", value: (p) => p.closing.weaners },
  { kind: "line", label: "Growers", format: "number", value: (p) => p.closing.growers },
  { kind: "line", label: "Finishers", format: "number", value: (p) => p.closing.finishers },
  {
    kind: "line",
    label: "Replacement gilts",
    format: "number",
    value: (p) => p.closing.replacementGilts,
  },
  {
    kind: "subtotal",
    label: "TOTAL HEAD COUNT",
    format: "number",
    value: (p) => p.closing.head,
  },
  {
    kind: "memo",
    label: "Peak head carried on any one day",
    format: "number",
    value: (p) => p.peakHead,
  },
  { kind: "blank" },
  { kind: "section", label: "MOVEMENTS DURING THE PERIOD" },
  { kind: "line", label: "Pigs born alive", format: "number", value: (p) => p.flows.born },
  { kind: "line", label: "Pigs weaned", format: "number", value: (p) => p.flows.weaned },
  { kind: "line", label: "Pigs sold", format: "number", value: (p) => p.flows.sold },
  { kind: "line", label: "Breeding gilts sold", format: "number", value: (p) => p.flows.giltsSold },
  { kind: "line", label: "Deaths", format: "number", value: (p) => p.flows.deaths },
  {
    kind: "line",
    label: "Gilts selected for breeding",
    format: "number",
    value: (p) => p.flows.giltsSelected,
  },
  {
    kind: "line",
    label: "Gilts promoted into the sow herd",
    format: "number",
    value: (p) => p.flows.giltsPromoted,
  },
  {
    kind: "line",
    label: "Breeding stock culled or rotated out",
    format: "number",
    value: (p) => p.flows.breedingStockCulled,
  },
];

const NOTES = [
  "Counts are month-end positions and are never added across periods: a plan year shows what was standing on its last day. Movements are totals for the period and are added.",
  "Sows in pig, suckling and to serve add up to the breeding sow herd. Replacement gilts are growing females picked out to breed; they join the sow herd when they are promoted.",
  "Peak head is the most pigs carried on any one day inside the period. Month-end counts miss a batch that arrived and left inside the month, and it is the peak that has to be housed.",
];

export function addHerdDevelopmentSheets(
  workbook: Workbook,
  report: HerdDevelopmentReport,
  generatedAt: Date,
): void {
  const name = report.config.project.name;
  const subtitle = provenance(report.config, generatedAt);

  addStatementSheet(workbook, {
    name: "Herd Development",
    tabColor: "18794E",
    title: `${name} — herd development plan, month by month`,
    subtitle,
    heading: (period) => monthCellDate(period.startDate),
    periods: report.months,
    rows: HERD_ROWS,
    labelWidth: 36,
    footer: "Herd development plan — monthly",
    notes: NOTES,
  });

  addStatementSheet(workbook, {
    name: "Herd Annual",
    tabColor: "0F5132",
    title: `${name} — herd development plan, by plan year`,
    subtitle,
    heading: (period) => period.label,
    periods: report.years,
    rows: HERD_ROWS,
    labelWidth: 36,
    columnWidth: 18,
    footer: "Herd development plan — annual",
    notes: NOTES,
  });

  addMilestoneSheet(workbook, report, subtitle);
}

function addMilestoneSheet(
  workbook: Workbook,
  report: HerdDevelopmentReport,
  subtitle: string,
): void {
  const sheet = workbook.addWorksheet("Herd Milestones", {
    properties: { tabColor: { argb: "6AA84F" } },
    views: [{ showGridLines: false }],
    pageSetup: { ...PORTRAIT_PAGE, fitToHeight: 1 },
  });
  sheet.columns = [{ width: 34 }, { width: 14 }, { width: 14 }, { width: 62 }];
  styleTitle(sheet, `${report.config.project.name} — herd milestones`, subtitle, "D");
  sheet.getRow(6).values = ["Milestone", "Head", "Month", "What it means"];
  styleTableHeader(sheet.getRow(6), 1, 4);
  report.milestones.forEach((milestone, index) => {
    const row = index + 7;
    sheet.getRow(row).values = [
      milestone.label,
      milestone.value,
      milestone.month ?? "Not reached",
      milestone.detail,
    ];
    sheet.getCell(row, 2).numFmt = NUMBER_FORMAT;
    sheet.getCell(row, 4).alignment = { wrapText: true, vertical: "top" };
    sheet.getRow(row).height = 28;
    ruleRow(sheet, row, 4);
  });
  applyBase(sheet);
  sheet.headerFooter.oddFooter = "&LHerd milestones&RPage &P of &N";
}
