import { money, number as count } from "../format";
import type { PlannerConfig } from "../config";
import type { PlanSimulationResult } from "../simulation-result";
import {
  addBalanceSheetSheets,
  balanceSheetReport,
  BALANCE_SHEET_ROWS,
} from "./balance-sheet";
import { addFundingPlanSheets, fundingPlanReport } from "./funding-plan";
import {
  addHerdDevelopmentSheets,
  herdDevelopmentReport,
  HERD_ROWS,
} from "./herd-development";
import {
  addHousingNeedsSheets,
  housingNeedsReport,
  HOUSING_ROWS,
} from "./housing-needs";
import { addMortalitySheet, mortalityReport } from "./mortality";
import { addGrowthPerformanceSheets, growthPerformanceReport } from "./growth-performance";
import { addNativeGrowthChart } from "./native-chart";
import {
  addProfitAndLossSheets,
  profitAndLossReport,
  PROFIT_AND_LOSS_ROWS,
} from "./profit-and-loss";
import { newWorkbook, workbookBytes } from "./sheet";
import { previewLines, type PreviewLine } from "./statement";

/**
 * The report centre's catalogue.
 *
 * Every document the product can generate is one entry in {@link REPORTS}: what
 * it is called, what it contains, how to preview it and how to write the file.
 * The page renders the list; it knows nothing about profit statements or herd
 * counts. Adding a fifth report is a fifth entry here and a module beside this
 * one, with no change to the page at all.
 *
 * All of them are built from a finished {@link PlanSimulationResult} and none of
 * them simulates anything. That is the whole reason the centre exists: four
 * reports each running their own farm would be four farms, and four farms drawn
 * from a random seed are four different answers to the same question. One run,
 * read four ways, cannot disagree with the money page or with itself.
 */

export type ReportFormat = "xlsx";

export type ReportId =
  | "profit-and-loss"
  | "balance-sheet"
  | "funding-plan"
  | "herd-development"
  | "housing-needs"
  | "mortality"
  | "growth-performance";

/**
 * A report as the page shows it before anything is downloaded: the headline
 * figures, and the report's own lines over its summary columns.
 *
 * Built from the same row definitions the worksheets are written from, so the
 * preview is the document rather than a description of it.
 */
export type ReportPreviewChart = {
  type: "line";
  title: string;
  description: string;
  xKey: string;
  xLabel: string;
  yLabel: string;
  series: {
    key: string;
    label: string;
    colour: string;
    dashed?: boolean;
  }[];
  data: Array<Record<string, number>>;
};

export type ReportPreview = {
  facts: { label: string; value: string; note?: string }[];
  columns: string[];
  lines: PreviewLine[];
  chart?: ReportPreviewChart;
  /** What the panel is showing, and what the download adds to it. */
  note: string;
};

export type ReportDefinition = {
  id: ReportId;
  name: string;
  /** One sentence on what is inside, for the card. */
  description: string;
  format: ReportFormat;
  /** What the downloaded file is called, after the plan's own name. */
  slug: string;
  /** The figures a reader sees before deciding to download. */
  preview: (result: PlanSimulationResult) => ReportPreview;
  /** The file itself. */
  build: (result: PlanSimulationResult, generatedAt: Date) => Promise<ArrayBuffer>;
};

/** A workbook for one report, with the document properties a sent file wants. */
async function workbookFor(
  config: PlannerConfig,
  title: string,
  description: string,
  generatedAt: Date,
) {
  return newWorkbook({
    title: `${config.project.name} — ${title}`,
    subject: title,
    description,
    company: config.project.name,
    created: generatedAt,
  });
}

export const REPORTS: readonly ReportDefinition[] = [
  {
    id: "profit-and-loss",
    name: "Projected Profit & Loss",
    description:
      "Revenue, operating costs and projected profitability over the plan, month by month and year by year — with the inventory-adjusted reading beside it and financing kept out of both.",
    format: "xlsx",
    slug: "projected-profit-and-loss",
    preview: (result) => {
      const report = profitAndLossReport(result);
      const periods = report.wholePlan ? [...report.years, report.wholePlan] : report.years;
      const currency = result.config.project.currency;
      const whole = report.wholePlan;
      return {
        facts: [
          {
            label: "Total trading income",
            value: money(whole?.revenue.total ?? 0, currency),
            note: "Over the whole plan, financing excluded",
          },
          {
            label: "Total operating costs",
            value: money(whole?.operatingCosts.total ?? 0, currency),
          },
          {
            label: "Operating profit / (loss)",
            value: money(whole?.operatingProfit ?? 0, currency),
            note: "Income less expenditure",
          },
          {
            label: "Inventory-adjusted",
            value: money(whole?.inventoryAdjusted.operatingProfit ?? 0, currency),
            note: "Experimental second reading",
          },
        ],
        columns: periods.map((period) => period.label),
        lines: previewLines(PROFIT_AND_LOSS_ROWS, periods, currency),
        note: "Plan years and the whole plan. The workbook carries the same statement month by month as well.",
      };
    },
    build: async (result, generatedAt) => {
      const report = profitAndLossReport(result);
      const workbook = await workbookFor(
        result.config,
        "projected profit & loss",
        "Projected trading account generated from the PigFlow animal-level simulation.",
        generatedAt,
      );
      addProfitAndLossSheets(workbook, report, generatedAt);
      return workbookBytes(workbook);
    },
  },
  {
    id: "balance-sheet",
    name: "Projected Balance Sheet",
    description:
      "Projected assets, liabilities and farm net worth at cost — month end by month end, with the opening position beside the close of each plan year.",
    format: "xlsx",
    slug: "projected-balance-sheet",
    preview: (result) => {
      const report = balanceSheetReport(result);
      const periods = [report.opening, ...report.years];
      const currency = result.config.project.currency;
      return {
        facts: [
          {
            label: "Opening net worth",
            value: money(report.opening.worth.netWorth, currency),
            note: "Before the first simulated day",
          },
          {
            label: "Closing net worth",
            value: money(report.closing.worth.netWorth, currency),
            note: report.closing.span,
          },
          {
            label: "Total assets at the close",
            value: money(report.closing.worth.totalAssets, currency),
          },
          {
            label: "Total liabilities at the close",
            value: money(report.closing.worth.totalLiabilities, currency),
          },
        ],
        columns: periods.map((point) => point.label),
        lines: previewLines(BALANCE_SHEET_ROWS, periods, currency),
        note: "The opening position and the close of each plan year. The workbook carries every month end as well.",
      };
    },
    build: async (result, generatedAt) => {
      const report = balanceSheetReport(result);
      const workbook = await workbookFor(
        result.config,
        "projected balance sheet",
        "Projected balance sheet at cost, generated from the PigFlow animal-level simulation.",
        generatedAt,
      );
      addBalanceSheetSheets(workbook, report, generatedAt);
      return workbookBytes(workbook);
    },
  },
  {
    id: "funding-plan",
    name: "Proposed Funding Plan",
    description:
      "When funding is required, how much is required at each point, and the maximum capital tied up — with the month-by-month working the schedule was read off.",
    format: "xlsx",
    slug: "proposed-funding-plan",
    preview: (result) => {
      const report = fundingPlanReport(result);
      const { plan } = report;
      const currency = result.config.project.currency;
      const lines: PreviewLine[] = plan.tranches.map((tranche) => ({
        kind: "line",
        label: tranche.label,
        cells: [
          money(tranche.amount, currency),
          money(tranche.cumulative, currency),
          `${tranche.reason} · carries the plan through ${tranche.carriesThrough}`,
        ],
      }));
      if (lines.length === 0) {
        lines.push({
          kind: "memo",
          label: "—",
          cells: [
            money(0, currency),
            money(0, currency),
            "No injection is required: the plan holds its working capital throughout.",
          ],
        });
      }
      lines.push({
        kind: "result",
        label: "Maximum external funding required",
        cells: [money(plan.peakRequirement, currency), "", ""],
      });
      return {
        facts: [
          { label: "Opening capital available", value: money(plan.openingCapital, currency) },
          {
            label: "Capital works in this plan",
            value: money(plan.capitalExpenditure, currency),
            note: plan.fundsCapitalWorks
              ? "Inside the requirement below"
              : "None entered — the figure below is working capital only",
          },
          {
            label: plan.fundsCapitalWorks
              ? "Maximum external funding"
              : "Maximum working capital",
            value: money(plan.peakRequirement, currency),
            note: plan.fullyDrawnMonth ? "Fully drawn by " + plan.fullyDrawnMonth : "None needed",
          },
          {
            label: "Operating cash recovers",
            value: plan.recoveryMonth ?? "Not within the horizon",
            note: "Closing cash " + money(plan.closingCash, currency),
          },
        ],
        columns: ["Proposed injection", "Cumulative", "Reason"],
        lines,
        note: plan.fundsCapitalWorks
          ? "The proposed drawdown schedule. The workbook carries the month-by-month cash working the schedule was read off."
          : "This plan costs no capital works, so this is a working capital facility only — housing, land, water, power, equipment and finance charges are not in it. The workbook carries the month-by-month cash working and the full list of exclusions.",
      };
    },
    build: async (result, generatedAt) => {
      const report = fundingPlanReport(result);
      const workbook = await workbookFor(
        result.config,
        "proposed funding plan",
        "Proposed funding schedule derived from the projected cash requirement of the plan.",
        generatedAt,
      );
      addFundingPlanSheets(workbook, report, generatedAt);
      return workbookBytes(workbook);
    },
  },
  {
    id: "herd-development",
    name: "Herd Development Plan",
    description:
      "Month-by-month development of the breeding herd and the growing stock, with plan-year summaries and the milestones a unit is built around.",
    format: "xlsx",
    slug: "herd-development-plan",
    preview: (result) => {
      const report = herdDevelopmentReport(result);
      const currency = result.config.project.currency;
      const closing = report.months[report.months.length - 1] ?? null;
      const peak = report.milestones.find((milestone) => milestone.label === "Peak total head count");
      const target = report.milestones.find(
        (milestone) => milestone.label === "Target sow herd reached",
      );
      return {
        facts: [
          {
            label: "Breeding sows at the close",
            value: count(closing?.closing.sows ?? 0, 0),
            note: `Of ${result.config.herd.maxSows} places`,
          },
          {
            label: "Total head at the close",
            value: count(closing?.closing.head ?? 0, 0),
          },
          {
            label: "Peak head count",
            value: count(peak?.value ?? 0, 0),
            note: peak?.month ? "In " + peak.month : undefined,
          },
          {
            label: "Target sow herd reached",
            value: target?.month ?? "Not within the plan",
          },
        ],
        columns: report.years.map((period) => period.label),
        lines: previewLines(HERD_ROWS, report.years, currency),
        note: "Plan years. The workbook carries every month, and the milestones, as well.",
      };
    },
    build: async (result, generatedAt) => {
      const report = herdDevelopmentReport(result);
      const workbook = await workbookFor(
        result.config,
        "herd development plan",
        "Month-by-month herd projection generated from the PigFlow animal-level simulation.",
        generatedAt,
      );
      addHerdDevelopmentSheets(workbook, report, generatedAt);
      return workbookBytes(workbook);
    },
  },
  {
    id: "housing-needs",
    name: "Housing Needs Plan",
    description:
      "The smallest practical unit this herd can be run in: pens by type, the room module each house is built to, the buildings those rooms come to and the order the work falls due — sized on the busiest morning of the plan rather than on a month end, and chosen by costing the alternatives rather than by a rule of thumb.",
    format: "xlsx",
    slug: "housing-needs-plan",
    preview: (result) => {
      const report = housingNeedsReport(result);
      const currency = result.config.project.currency;
      const totals = report.housing?.totals;
      const minimum = report.types.reduce((sum, type) => sum + type.minimumPens, 0);
      const laterPhases = report.phases.filter((phase) => phase.phase > 1);
      const postponed = laterPhases.reduce((sum, phase) => sum + phase.pensAdded, 0);
      return {
        facts: [
          {
            label: "Buildings required",
            value: count(totals?.buildings ?? 0, 0),
            note: report.buildings.map((building) => building.label).join(", ") || undefined,
          },
          {
            label: "Pens and places",
            value: count(totals?.pens ?? 0, 0),
            note: `Simulated minimum ${count(minimum, 0)}, in ${count(totals?.rooms ?? 0, 0)} rooms`,
          },
          {
            label: "Can be postponed",
            value: count(postponed, 0),
            note: postponed > 0
              ? `${count(laterPhases.length, 0)} later phase${laterPhases.length === 1 ? "" : "s"}; the rest is wanted from the start`
              : "Every house is wanted from the start",
          },
          {
            label: "Approximate footprint",
            value: count(totals?.estimatedStructureAreaM2 ?? 0, 0) + " m²",
            note: `${count(totals?.layoutEfficiencyPct ?? 0, 0)}% of it room, the rest passage and squaring off`,
          },
        ],
        columns: report.types.map((type) => type.label),
        lines: previewLines(HOUSING_ROWS, report.types, currency),
        note: report.housing
          ? `Derived from ${count(report.housing.generatedFromSimulationDayCount, 0)} simulated days against the ${report.housing.policySource}. The workbook carries the building schedule, the construction phases, the layouts that were costed and turned down, and the working behind every figure.`
          : "This run was not asked to plan the housing.",
      };
    },
    build: async (result, generatedAt) => {
      const report = housingNeedsReport(result);
      const workbook = await workbookFor(
        result.config,
        "housing needs plan",
        "Housing capacity and structure requirements derived from the PigFlow animal-level simulation.",
        generatedAt,
      );
      addHousingNeedsSheets(workbook, report, generatedAt);
      return workbookBytes(workbook);
    },
  },
  {
    id: "mortality",
    name: "Mortality by Stage",
    description: "Production losses by piglet, weaner, grower and finisher stage — showing stage entries, deaths, observed mortality and the configured whole-stage assumption.",
    format: "xlsx",
    slug: "mortality-by-stage",
    preview: (result) => {
      const report = mortalityReport(result);
      const worst = [...report.rows].sort((a, b) => b.observedRatePct - a.observedRatePct)[0];
      return {
        facts: [
          { label: "Production-stage deaths", value: count(report.totalDeaths, 0) },
          { label: "Highest observed stage", value: worst?.label ?? "—", note: worst ? worst.observedRatePct.toFixed(1) + "% observed" : undefined },
          { label: "Piglets entering pre-weaning", value: count(report.rows.find((row) => row.stage === "piglet")?.entered ?? 0, 0) },
          { label: "Finishers entering stage", value: count(report.rows.find((row) => row.stage === "finisher")?.entered ?? 0, 0) },
        ],
        columns: ["Entered", "Deaths", "Observed", "Configured", "Variance"],
        lines: report.rows.map((row) => ({ kind: "line" as const, label: row.label, cells: [count(row.entered, 0), count(row.deaths, 0), row.observedRatePct.toFixed(1) + "%", row.configuredRatePct.toFixed(1) + "%", (row.variancePctPoints >= 0 ? "+" : "") + row.variancePctPoints.toFixed(1) + " pp"] })),
        note: "Observed mortality is deaths divided by animals entering that stage during the plan, including opening stock already in that stage. Pigs entering near the end of the horizon may not yet have completed the stage's full mortality exposure.",
      };
    },
    build: async (result, generatedAt) => {
      const workbook = await workbookFor(result.config, "mortality by stage", "Stage-based production mortality generated from the PigFlow animal-level simulation.", generatedAt);
      addMortalitySheet(workbook, mortalityReport(result), generatedAt);
      return workbookBytes(workbook);
    },
  },
  {
    id: "growth-performance",
    name: "Growth Performance Report",
    description:
      "Observed weight-for-age distribution, stage ADG and market-age performance from the simulated herd — so the realised growth curve can be assessed rather than inferred from configured gains.",
    format: "xlsx",
    slug: "growth-performance",
    preview: (result) => {
      const report = growthPerformanceReport(result);
      const market = report.market;
      return {
        facts: [
          {
            label: "Mean market age",
            value: market.sold > 0 ? market.meanAgeDays.toFixed(0) + " days" : "No sales",
            note: market.sold > 0 ? market.p10AgeDays.toFixed(0) + "–" + market.p90AgeDays.toFixed(0) + " days (P10–P90)" : undefined,
          },
          {
            label: "Mean sale weight",
            value: market.sold > 0 ? market.meanWeightKg.toFixed(1) + " kg" : "No sales",
            note: "Configured target " + report.saleWeightKg.toFixed(1) + " kg",
          },
          {
            label: "Mean lifetime ADG",
            value: market.meanLifetimeAdgKg > 0 ? (market.meanLifetimeAdgKg * 1000).toFixed(0) + " g/day" : "—",
          },
          {
            label: "Market-age spread",
            value: market.sold > 0 ? (market.p90AgeDays - market.p10AgeDays).toFixed(0) + " days" : "—",
            note: "P10 to P90",
          },
        ],
        columns: ["Sample", "Mean kg", "P10", "Median", "P90", "CV"],
        chart: {
          type: "line",
          title: "Observed growth curve",
          description:
            "Observed liveweight distribution by age. P10 and P90 show the spread around the median and mean.",
          xKey: "ageDays",
          xLabel: "Age (days)",
          yLabel: "Liveweight (kg)",
          series: [
            { key: "p10", label: "P10", colour: "#667085", dashed: true },
            { key: "median", label: "Median", colour: "#17324D" },
            { key: "mean", label: "Mean", colour: "#2A78D6" },
            { key: "p90", label: "P90", colour: "#18794E", dashed: true },
          ],
          data: report.checkpoints
            .filter((point) => point.sampleSize > 0)
            .map((point) => ({
              ageDays: point.ageDays,
              p10: point.p10WeightKg,
              median: point.medianWeightKg,
              mean: point.meanWeightKg,
              p90: point.p90WeightKg,
            })),
        },
        lines: report.checkpoints.map((point) => ({
          kind: "line" as const,
          label: "Age " + point.ageDays + " days",
          cells: [
            count(point.sampleSize, 0),
            point.meanWeightKg.toFixed(1),
            point.p10WeightKg.toFixed(1),
            point.medianWeightKg.toFixed(1),
            point.p90WeightKg.toFixed(1),
            point.cvPct.toFixed(1) + "%",
          ],
        })),
        note:
          "These are observed weights from the simulated animals at fixed ages. The workbook also shows completed-stage observed ADG versus configured ADG and the distribution of age and weight at market.",
      };
    },
    build: async (result, generatedAt) => {
      const report = growthPerformanceReport(result);
      const workbook = await workbookFor(
        result.config,
        "growth performance",
        "Observed growth performance generated from the PigFlow animal-level simulation.",
        generatedAt,
      );
      await addGrowthPerformanceSheets(workbook, report, generatedAt);
      const bytes = await workbookBytes(workbook);
      return addNativeGrowthChart(bytes, report);
    },
  }
];

export function reportById(id: ReportId): ReportDefinition {
  const report = REPORTS.find((entry) => entry.id === id);
  if (!report) throw new Error("No report is registered as " + id);
  return report;
}

/** A filename that says which plan the document came from, and which document. */
export function reportFilename(config: PlannerConfig, report: ReportDefinition): string {
  const slug = config.project.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "plan"}-${report.slug}.${report.format}`;
}

export { reportingPeriod } from "./periods";
export type { PreviewLine } from "./statement";
