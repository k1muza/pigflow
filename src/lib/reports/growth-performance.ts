import type { Workbook } from "exceljs";

import type { ProductionGrowthStage } from "../growth-observer";
import type { PlanSimulationResult } from "../simulation-result";
import {
  applyBase,
  COLORS,
  DECIMAL_FORMAT,
  LANDSCAPE_PAGE,
  NUMBER_FORMAT,
  PORTRAIT_PAGE,
  ruleRow,
  styleTableHeader,
  styleTitle,
} from "./sheet";

const STAGE_LABELS: Record<ProductionGrowthStage, string> = {
  piglet: "Pre-weaning",
  weaner: "Weaner / nursery",
  grower: "Grower",
  finisher: "Finisher",
};

export function growthPerformanceReport(result: PlanSimulationResult) {
  const growth = result.growth;
  return {
    projectName: result.config.project.name,
    saleWeightKg: result.config.growth.saleWeightKg,
    checkpoints: growth?.checkpoints ?? [],
    stages:
      growth?.stages.map((row) => ({
        ...row,
        label: STAGE_LABELS[row.stage],
        varianceAdgKg: row.observedAdgKg - row.configuredAdgKg,
      })) ?? [],
    market:
      growth?.market ?? {
        sold: 0,
        meanAgeDays: 0,
        p10AgeDays: 0,
        medianAgeDays: 0,
        p90AgeDays: 0,
        meanWeightKg: 0,
        p10WeightKg: 0,
        medianWeightKg: 0,
        p90WeightKg: 0,
        meanLifetimeAdgKg: 0,
      },
  };
}

export type GrowthPerformanceReport = ReturnType<
  typeof growthPerformanceReport
>;


function addCurveSheet(
  workbook: Workbook,
  report: GrowthPerformanceReport,
): void {
  const sheet = workbook.addWorksheet("Weight by age");
  sheet.pageSetup = LANDSCAPE_PAGE;
  sheet.columns = [
    { width: 13 },
    { width: 14 },
    { width: 16 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 12 },
  ];
  styleTitle(
    sheet,
    report.projectName + " — weight by age",
    "Observed liveweight distribution at standard ages. Later checkpoints can have fewer pigs because animals may already have left the farm.",
    "G",
  );
  sheet.getRow(6).values = [
    "Age (days)",
    "Sample",
    "Mean weight (kg)",
    "P10 (kg)",
    "Median (kg)",
    "P90 (kg)",
    "CV",
  ];
  styleTableHeader(sheet.getRow(6));

  report.checkpoints.forEach((point, index) => {
    const row = 7 + index;
    sheet.getRow(row).values = [
      point.ageDays,
      point.sampleSize,
      point.meanWeightKg,
      point.p10WeightKg,
      point.medianWeightKg,
      point.p90WeightKg,
      point.cvPct / 100,
    ];
    sheet.getCell(row, 1).numFmt = NUMBER_FORMAT;
    sheet.getCell(row, 2).numFmt = NUMBER_FORMAT;
    for (let column = 3; column <= 6; column += 1) {
      sheet.getCell(row, column).numFmt = DECIMAL_FORMAT;
    }
    sheet.getCell(row, 7).numFmt = "0.0%";
    ruleRow(sheet, row, 7);
  });

  sheet.autoFilter = { from: "A6", to: "G6" };

  // Rows 23–46 are deliberately left clear. After ExcelJS serialises the
  // workbook, native-chart.ts anchors a real OOXML line chart here. Keeping the
  // source table above it means Excel users can edit the figures and the chart
  // updates like any ordinary workbook chart.
  sheet.mergeCells("A47:G47");
  sheet.getCell("A47").value =
    "Native Excel chart · X-axis: age in days · Y-axis: liveweight (kg) · P10 and P90 show the observed spread around the median and mean.";
  sheet.getCell("A47").font = {
    italic: true,
    size: 9,
    color: { argb: COLORS.muted },
  };

  sheet.views = [{ state: "frozen", ySplit: 6, showGridLines: false }];
  applyBase(sheet);
}

function addStageSheet(
  workbook: Workbook,
  report: GrowthPerformanceReport,
): void {
  const sheet = workbook.addWorksheet("Stage performance");
  sheet.pageSetup = LANDSCAPE_PAGE;
  sheet.columns = [
    { width: 22 },
    { width: 14 },
    { width: 18 },
    { width: 18 },
    { width: 14 },
    { width: 20 },
    { width: 20 },
    { width: 16 },
  ];
  styleTitle(
    sheet,
    report.projectName + " — stage growth performance",
    "Observed ADG is calculated only from pigs whose complete stage was observed inside the simulation horizon; opening stock already part-way through a stage is excluded.",
    "H",
  );
  sheet.getRow(6).values = [
    "Stage",
    "Completed",
    "Mean entry kg",
    "Mean exit kg",
    "Mean days",
    "Observed ADG kg/day",
    "Configured ADG kg/day",
    "Variance kg/day",
  ];
  styleTableHeader(sheet.getRow(6));

  report.stages.forEach((stage, index) => {
    const row = 7 + index;
    sheet.getRow(row).values = [
      stage.label,
      stage.completed,
      stage.meanEntryWeightKg,
      stage.meanExitWeightKg,
      stage.meanDays,
      stage.observedAdgKg,
      stage.configuredAdgKg,
      stage.varianceAdgKg,
    ];
    sheet.getCell(row, 2).numFmt = NUMBER_FORMAT;
    for (let column = 3; column <= 8; column += 1) {
      sheet.getCell(row, column).numFmt = DECIMAL_FORMAT;
    }
    ruleRow(sheet, row, 8);
  });

  sheet.views = [{ state: "frozen", ySplit: 6, showGridLines: false }];
  applyBase(sheet);
}

function addMarketSheet(
  workbook: Workbook,
  report: GrowthPerformanceReport,
  generatedAt: Date,
): void {
  const sheet = workbook.addWorksheet("Market performance");
  sheet.pageSetup = PORTRAIT_PAGE;
  sheet.columns = [{ width: 34 }, { width: 20 }, { width: 22 }];
  styleTitle(
    sheet,
    report.projectName + " — market growth performance",
    "Age and liveweight distribution of market pigs actually sold during this simulated run.",
    "C",
  );

  const rows: Array<[string, number, string]> = [
    ["Market pigs sold", report.market.sold, "head"],
    ["Configured sale weight", report.saleWeightKg, "kg"],
    ["Mean sale weight", report.market.meanWeightKg, "kg"],
    ["P10 sale weight", report.market.p10WeightKg, "kg"],
    ["Median sale weight", report.market.medianWeightKg, "kg"],
    ["P90 sale weight", report.market.p90WeightKg, "kg"],
    ["Mean market age", report.market.meanAgeDays, "days"],
    ["P10 market age", report.market.p10AgeDays, "days"],
    ["Median market age", report.market.medianAgeDays, "days"],
    ["P90 market age", report.market.p90AgeDays, "days"],
    ["Mean lifetime ADG", report.market.meanLifetimeAdgKg, "kg/day"],
  ];

  sheet.getRow(6).values = ["Metric", "Observed", "Unit"];
  styleTableHeader(sheet.getRow(6));

  rows.forEach(([label, value, unit], index) => {
    const row = 7 + index;
    sheet.getRow(row).values = [label, value, unit];
    sheet.getCell(row, 2).numFmt =
      label === "Market pigs sold" ? NUMBER_FORMAT : DECIMAL_FORMAT;
    ruleRow(sheet, row, 3);
  });

  sheet.mergeCells(20, 1, 22, 3);
  sheet.getCell(20, 1).value =
    "The weight-for-age curve is an observed distribution, not the configured growth curve echoed back. Stage ADG likewise uses realised weight gain and elapsed days. Pigs that die before completing a stage do not contribute a completed-stage ADG, but they do affect the age checkpoints while alive.";
  sheet.getCell(20, 1).alignment = { wrapText: true, vertical: "top" };
  sheet.getCell(20, 1).font = {
    italic: true,
    color: { argb: COLORS.muted },
  };

  sheet.mergeCells(24, 1, 24, 3);
  sheet.getCell(24, 1).value =
    "Generated by PigFlow · " + generatedAt.toISOString();
  sheet.getCell(24, 1).font = {
    size: 9,
    color: { argb: COLORS.muted },
  };
  applyBase(sheet);
}

export async function addGrowthPerformanceSheets(
  workbook: Workbook,
  report: GrowthPerformanceReport,
  generatedAt: Date,
): Promise<void> {
  addCurveSheet(workbook, report);
  addStageSheet(workbook, report);
  addMarketSheet(workbook, report, generatedAt);
}
