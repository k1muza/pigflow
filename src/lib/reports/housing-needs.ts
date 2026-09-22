import type { Workbook } from "exceljs";

import type { PlannerConfig } from "../config";
import type {
  HousingBuilding,
  HousingNeedsResult,
  HousingTypeResult,
} from "../housing";
import { HOUSING_UNITS } from "../housing";
import type { PlanSimulationResult } from "../simulation-result";
import { provenance, reportingPeriod } from "./periods";
import {
  applyBase,
  DECIMAL_FORMAT,
  NUMBER_FORMAT,
  PORTRAIT_PAGE,
  ruleRow,
  styleTableHeader,
  styleTitle,
} from "./sheet";
import { addStatementSheet, type StatementRow } from "./statement";

/**
 * What this plan would have to be built.
 *
 * The other four reports say what the farm earns, owns, owes and carries. This
 * one says what it has to stand in, which is the question a lender asks second
 * and a builder asks first. Every figure on it is traceable back through the
 * same chain — the herd the simulation grew, the pens those animals had to be
 * in on the worst morning, the reserve added to that, the room module it was
 * rounded up to and the buildings those rooms come to — and the workbook prints
 * that chain rather than only its answer.
 *
 * Nothing here calculates anything. The plan is worked out during the run, from
 * the same daily state the herd development plan is rolled up from, and this
 * lays it out.
 */

export type HousingNeedsReport = {
  config: PlannerConfig;
  period: string;
  /** Null when the run was not asked to plan the housing. */
  housing: HousingNeedsResult | null;
  types: HousingTypeResult[];
  buildings: HousingBuilding[];
};

export function housingNeedsReport(result: PlanSimulationResult): HousingNeedsReport {
  const housing = result.housing;
  return {
    config: result.config,
    period: reportingPeriod(result.config),
    housing,
    types: housing?.types ?? [],
    buildings: housing?.buildings ?? [],
  };
}

// ------------------------------------------------------------------ the lines

/**
 * The statement, with a housing type in each column.
 *
 * The three parts of the peak are ordinary lines and the minimum requirement is
 * the total over them, so the workbook carries a real formula a reader can check:
 * occupied, plus held in reserve, plus standing empty under the hose, is the
 * number of pens that had to exist on the worst morning of the plan.
 */
export const HOUSING_ROWS: StatementRow<HousingTypeResult>[] = [
  { kind: "section", label: "DEMAND FROM THE SIMULATION" },
  {
    kind: "memo",
    label: "Peak head requiring this housing",
    format: "number",
    value: (type) => type.peakHead,
  },
  { kind: "blank" },
  { kind: "section", label: "PENS ON THE BUSIEST MORNING" },
  { kind: "line", label: "Occupied", format: "number", value: (t) => t.derivation.peakOccupiedPens },
  {
    kind: "line",
    label: "Held in reserve",
    format: "number",
    value: (t) => t.derivation.peakReservedPens,
  },
  {
    kind: "line",
    label: "Unavailable for cleaning",
    format: "number",
    value: (t) => t.derivation.peakCleaningPens,
  },
  {
    kind: "total",
    label: "MINIMUM SIMULATED REQUIREMENT",
    format: "number",
    value: (t) => t.minimumPens,
  },
  {
    kind: "subtotal",
    label: "With operational reserve",
    format: "number",
    value: (t) => t.recommendedPens,
  },
  {
    kind: "result",
    label: "RECOMMENDED CAPACITY, ROUNDED TO THE ROOM MODULE",
    format: "number",
    value: (t) => t.moduleCapacityPens,
  },
  { kind: "memo", label: "Head capacity provided", format: "number", value: (t) => t.headCapacity },
  {
    kind: "memo",
    label: "Pens in use on an ordinary day",
    format: "decimal",
    value: (t) => t.averagePensInUse,
  },
  {
    kind: "memo",
    label: "Head housed on an ordinary day",
    format: "decimal",
    value: (t) => t.averageHeadHoused,
  },
  { kind: "blank" },
  { kind: "section", label: "ONE PEN" },
  { kind: "line", label: "Head per pen", format: "number", value: (t) => t.pen?.capacityHead ?? 0 },
  { kind: "line", label: "Width (m)", format: "decimal", value: (t) => t.pen?.widthM ?? 0 },
  { kind: "line", label: "Length (m)", format: "decimal", value: (t) => t.pen?.lengthM ?? 0 },
  { kind: "line", label: "Floor area (m²)", format: "decimal", value: (t) => t.pen?.areaM2 ?? 0 },
  {
    kind: "memo",
    label: "Floor the animals must have (m²)",
    format: "decimal",
    value: (t) => t.pen?.requiredAreaM2 ?? 0,
  },
  { kind: "blank" },
  { kind: "section", label: "ROOMS AND BUILDINGS" },
  { kind: "line", label: "Pens per room", format: "number", value: (t) => t.room?.pensPerRoom ?? 0 },
  { kind: "line", label: "Rooms", format: "number", value: (t) => t.room?.roomCount ?? 0 },
  { kind: "line", label: "Room width (m)", format: "decimal", value: (t) => t.room?.widthM ?? 0 },
  { kind: "line", label: "Room length (m)", format: "decimal", value: (t) => t.room?.lengthM ?? 0 },
  {
    kind: "memo",
    label: "Buildings this housing sits in",
    format: "number",
    value: (t) => t.buildings.length,
  },
];

const NOTES = [
  "Every figure is read off the daily state of the simulated herd, not off the month-end herd development counts: a month end can miss the morning a dozen extra places were wanted and gone again.",
  "The minimum is what the simulation actually required. The reserve is an operating margin on top of it, and the recommended capacity is that figure rounded up to a whole room. All three are shown because they are three different numbers and only one of them is a simulation result.",
  "Floor areas for growing pigs are set by the heaviest the pigs are expected to be while they are in the pen, not by the weight they enter it at.",
  "This is capacity and structure planning only. It carries no costs, no ventilation, no manure or water engineering, and no site layout.",
];

// ------------------------------------------------------------- the worksheets

export function addHousingNeedsSheets(
  workbook: Workbook,
  report: HousingNeedsReport,
  generatedAt: Date,
): void {
  const name = report.config.project.name;
  const subtitle = provenance(report.config, generatedAt);

  addStatementSheet(workbook, {
    name: "Housing Needs",
    tabColor: "17324D",
    title: `${name} — housing needs by type`,
    subtitle,
    heading: (type) => type.label,
    periods: report.types,
    rows: HOUSING_ROWS,
    labelWidth: 44,
    columnWidth: 16,
    footer: "Housing needs plan",
    notes: NOTES,
  });

  addScheduleSheet(workbook, report, subtitle);
  addWorkingSheet(workbook, report, subtitle);
}

/** The buildings themselves: what to put up, and roughly how big. */
function addScheduleSheet(
  workbook: Workbook,
  report: HousingNeedsReport,
  subtitle: string,
): void {
  const sheet = workbook.addWorksheet("Building Schedule", {
    properties: { tabColor: { argb: "2A78D6" } },
    views: [{ showGridLines: false }],
    pageSetup: { ...PORTRAIT_PAGE, fitToHeight: 0 },
  });
  sheet.columns = [
    { width: 30 },
    { width: 34 },
    { width: 9 },
    { width: 9 },
    { width: 11 },
    { width: 11 },
    { width: 11 },
    { width: 12 },
  ];
  styleTitle(sheet, `${report.config.project.name} — required buildings`, subtitle, "H");

  sheet.getRow(6).values = [
    "Building",
    "Holds",
    "Rooms",
    "Pens",
    "Head",
    "Width m",
    "Length m",
    "Footprint m²",
  ];
  styleTableHeader(sheet.getRow(6), 1, 8);

  let row = 7;
  for (const building of report.buildings) {
    sheet.getRow(row).values = [
      building.label,
      building.sections
        .map(
          (section) =>
            `${section.penCount} ${HOUSING_UNITS[section.housingType]} in ${section.roomCount} room${section.roomCount === 1 ? "" : "s"}`,
        )
        .join("; "),
      building.roomCount,
      building.penCount,
      building.headCapacity,
      building.rectangle.widthM,
      building.rectangle.lengthM,
      building.rectangle.areaM2,
    ];
    for (const column of [3, 4, 5]) sheet.getCell(row, column).numFmt = NUMBER_FORMAT;
    for (const column of [6, 7, 8]) sheet.getCell(row, column).numFmt = DECIMAL_FORMAT;
    sheet.getCell(row, 2).alignment = { wrapText: true, vertical: "top" };
    ruleRow(sheet, row, 8);
    row += 1;
  }

  const totals = report.housing?.totals;
  if (totals) {
    row += 1;
    sheet.getRow(row).values = [
      "Total",
      "",
      totals.rooms,
      totals.pens,
      totals.headCapacity,
      "",
      "",
      totals.estimatedStructureAreaM2,
    ];
    for (const column of [3, 4, 5]) sheet.getCell(row, column).numFmt = NUMBER_FORMAT;
    sheet.getCell(row, 8).numFmt = DECIMAL_FORMAT;
    sheet.getRow(row).font = { bold: true };
    row += 2;
    sheet.getCell(row, 1).value =
      `Pen floor across every pen: ${totals.animalFloorAreaM2.toFixed(2)} m². The footprint above is larger because it takes in service passages and squares each house off to a rectangle.`;
    sheet.getCell(row, 1).alignment = { wrapText: true, vertical: "top" };
  }

  applyBase(sheet);
  sheet.headerFooter.oddFooter = "&LRequired buildings&RPage &P of &N";
}

/** Why each number is the number it is, and what was assumed to get there. */
function addWorkingSheet(
  workbook: Workbook,
  report: HousingNeedsReport,
  subtitle: string,
): void {
  const sheet = workbook.addWorksheet("Housing Working", {
    properties: { tabColor: { argb: "667085" } },
    views: [{ showGridLines: false }],
    pageSetup: { ...PORTRAIT_PAGE, fitToHeight: 0 },
  });
  sheet.columns = [{ width: 28 }, { width: 18 }, { width: 76 }];
  styleTitle(
    sheet,
    `${report.config.project.name} — how the housing figures were derived`,
    subtitle,
    "C",
  );

  sheet.getRow(6).values = ["Housing", "Peak demand", "Working and assumptions"];
  styleTableHeader(sheet.getRow(6), 1, 3);

  let row = 7;
  for (const type of report.types) {
    sheet.getCell(row, 1).value = type.label;
    sheet.getCell(row, 1).font = { bold: true };
    sheet.getCell(row, 2).value = `${type.peakHead} head, ${type.peakDate}`;
    sheet.getCell(row, 3).value = type.derivation.steps.join("\n");
    sheet.getCell(row, 3).alignment = { wrapText: true, vertical: "top" };
    sheet.getRow(row).height = 14 * Math.max(type.derivation.steps.length, 1);
    ruleRow(sheet, row, 3);
    row += 1;

    sheet.getCell(row, 3).value = type.sourceAssumptions.join("\n");
    sheet.getCell(row, 3).alignment = { wrapText: true, vertical: "top" };
    sheet.getCell(row, 3).font = { italic: true };
    sheet.getRow(row).height = 14 * Math.max(type.sourceAssumptions.length, 1);
    ruleRow(sheet, row, 3);
    row += 2;
  }

  for (const warning of report.housing?.warnings ?? []) {
    sheet.getCell(row, 1).value = "Warning";
    sheet.getCell(row, 3).value = warning.message;
    sheet.getCell(row, 3).alignment = { wrapText: true, vertical: "top" };
    sheet.getRow(row).height = 28;
    ruleRow(sheet, row, 3);
    row += 1;
  }

  row += 1;
  sheet.getCell(row, 1).value = "Source";
  sheet.getCell(row, 3).value =
    `${report.housing?.policySource ?? "—"}. These are planning defaults taken from that manual and from Pigflow's own assumptions where it is silent; they are not a statement of current legislation.`;
  sheet.getCell(row, 3).alignment = { wrapText: true, vertical: "top" };
  sheet.getRow(row).height = 28;

  applyBase(sheet);
  sheet.headerFooter.oddFooter = "&LHousing working&RPage &P of &N";
}
