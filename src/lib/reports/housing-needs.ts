import type { Workbook } from "exceljs";

import type { PlannerConfig } from "../config";
import type {
  HousingBuilding,
  HousingConstructionPhase,
  HousingLayoutOption,
  HousingNeedsResult,
  HousingTypeResult,
} from "../housing";
import { HOUSING_LABELS, HOUSING_UNITS } from "../housing";
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
 * in on the worst morning, the room module that was chosen and why, the
 * buildings those rooms come to, and the order the work falls due in — and the
 * workbook prints that chain rather than only its answer.
 *
 * It is laid out to answer three questions in this order. What is the least I
 * genuinely have to build? What can I put off, and until when? And why this
 * arrangement rather than one of the others? The last of those has a sheet of
 * its own, because a recommendation that cannot show what it turned down is an
 * assertion.
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
  phases: HousingConstructionPhase[];
  layoutOptions: HousingLayoutOption[];
};

export function housingNeedsReport(result: PlanSimulationResult): HousingNeedsReport {
  const housing = result.housing;
  return {
    config: result.config,
    period: reportingPeriod(result.config),
    housing,
    types: housing?.types ?? [],
    buildings: housing?.buildings ?? [],
    phases: housing?.phases ?? [],
    layoutOptions: housing?.layoutOptions ?? [],
  };
}

// ------------------------------------------------------------------ the lines

/**
 * The statement, with a housing type in each column.
 *
 * The three parts of the peak are ordinary lines and the minimum requirement is
 * the total over them, so the workbook carries a real formula a reader can
 * check: occupied, plus booked ahead of use, plus standing empty under the hose, is
 * the number of pens that had to exist on the worst morning of the plan.
 *
 * Under it are the three capacities, and they are kept three separate lines on
 * purpose. What the simulation required is a result. What is recommended is that
 * figure rounded up to a whole room. What a reserve would add on top is a
 * decision somebody else gets to take. Rolled into one number they compound
 * invisibly, and a house that had to hold thirty-four pens gets drawn with
 * fifty.
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
  { kind: "line", label: "Occupied", format: "number", value: (t) => t.capacity.peakOccupiedPens },
  {
    kind: "line",
    label: "Held ahead of use",
    format: "number",
    value: (t) => t.capacity.peakReservedPens,
  },
  {
    kind: "line",
    label: "Unavailable for cleaning",
    format: "number",
    value: (t) => t.capacity.peakCleaningPens,
  },
  {
    kind: "total",
    label: "MINIMUM REQUIRED BY SIMULATION",
    format: "number",
    value: (t) => t.capacity.minimumPhysicalPens,
  },
  { kind: "blank" },
  { kind: "section", label: "WHAT TO BUILD" },
  {
    kind: "memo",
    label: "Chosen room module (pens / room)",
    format: "number",
    value: (t) => t.derivation.pensPerRoom,
  },
  {
    kind: "memo",
    label: "Optional operational reserve",
    format: "number",
    value: (t) => t.capacity.optionalReservePens,
  },
  {
    kind: "result",
    label: "RECOMMENDED DESIGN CAPACITY",
    format: "number",
    value: (t) => t.capacity.recommendedPens,
  },
  {
    kind: "memo",
    label: "With a flat percentage reserve instead",
    format: "number",
    value: (t) => t.reserveDesignPens,
  },
  { kind: "memo", label: "Head capacity provided", format: "number", value: (t) => t.headCapacity },
  { kind: "blank" },
  { kind: "section", label: "HOW HARD IT IS WORKED" },
  {
    kind: "memo",
    label: "Average utilisation (%)",
    format: "decimal",
    value: (t) => t.utilization.averageOccupiedPct,
  },
  {
    kind: "memo",
    label: "Days above 90% of capacity",
    format: "number",
    value: (t) => t.utilization.daysAbove90Pct,
  },
  {
    kind: "memo",
    label: "Days at capacity",
    format: "number",
    value: (t) => t.utilization.daysAt100Pct,
  },
  {
    kind: "memo",
    label: "Days the peak lasted",
    format: "number",
    value: (t) => t.utilization.peakDurationDays,
  },
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
  {
    kind: "memo",
    label: "One more room would add",
    format: "number",
    value: (t) => t.expansionStepPens,
  },
  {
    kind: "memo",
    label: "Layout efficiency (%)",
    format: "decimal",
    value: (t) => t.layoutEfficiencyPct,
  },
  {
    kind: "memo",
    label: "Unused rectangular floor (m²)",
    format: "decimal",
    value: (t) => t.unusedAreaM2,
  },
  {
    kind: "memo",
    label: "Construction phases",
    format: "number",
    value: (t) => t.phases.length,
  },
];

const NOTES = [
  "Every figure is read off the daily state of the simulated herd, not off the month-end herd development counts: a month end can miss the morning a dozen extra places were wanted and gone again.",
  "The minimum is what the simulation actually required. The recommendation is that figure taken up to a whole room. Any reserve on top is a separate decision and is shown separately, because only the first of the three is a simulation result.",
  "Floor areas, group sizes, cleaning downtime and farrowing reservations are hard constraints. No layout that breaks one of them is costed, so a cheaper arrangement is never a less compliant one.",
  "Room size is capped at the largest intake the run ever made, so that every room can be emptied, washed and refilled as a single batch.",
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
  addPhaseSheet(workbook, report, subtitle);
  addOptionsSheet(workbook, report, subtitle);
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
    { width: 28 },
    { width: 32 },
    { width: 8 },
    { width: 8 },
    { width: 9 },
    { width: 10 },
    { width: 10 },
    { width: 12 },
    { width: 11 },
    { width: 10 },
  ];
  styleTitle(sheet, `${report.config.project.name} — required buildings`, subtitle, "J");

  sheet.getRow(6).values = [
    "Building",
    "Holds",
    "Rooms",
    "Pens",
    "Head",
    "Width m",
    "Length m",
    "Footprint m²",
    "Unused m²",
    "Used %",
  ];
  styleTableHeader(sheet.getRow(6), 1, 10);

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
      building.unusedAreaM2,
      building.layoutEfficiencyPct,
    ];
    for (const column of [3, 4, 5]) sheet.getCell(row, column).numFmt = NUMBER_FORMAT;
    for (const column of [6, 7, 8, 9, 10]) sheet.getCell(row, column).numFmt = DECIMAL_FORMAT;
    sheet.getCell(row, 2).alignment = { wrapText: true, vertical: "top" };
    ruleRow(sheet, row, 10);
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
      totals.unusedAreaM2,
      totals.layoutEfficiencyPct,
    ];
    for (const column of [3, 4, 5]) sheet.getCell(row, column).numFmt = NUMBER_FORMAT;
    for (const column of [8, 9, 10]) sheet.getCell(row, column).numFmt = DECIMAL_FORMAT;
    sheet.getRow(row).font = { bold: true };
    row += 2;
    sheet.getCell(row, 1).value =
      `Pen floor across every pen: ${totals.animalFloorAreaM2.toFixed(2)} m². The footprint above is larger because it takes in service passages and squares each house off to a rectangle. ` +
      `"Used %" is how much of that rectangle is room rather than the strip left over where rooms of different depths stand side by side.`;
    sheet.getCell(row, 1).alignment = { wrapText: true, vertical: "top" };
  }

  applyBase(sheet);
  sheet.headerFooter.oddFooter = "&LRequired buildings&RPage &P of &N";
}

/** What has to be standing by when, which is rarely all of it on day one. */
function addPhaseSheet(
  workbook: Workbook,
  report: HousingNeedsReport,
  subtitle: string,
): void {
  const sheet = workbook.addWorksheet("Construction Phases", {
    properties: { tabColor: { argb: "0E8A5F" } },
    views: [{ showGridLines: false }],
    pageSetup: { ...PORTRAIT_PAGE, fitToHeight: 0 },
  });
  sheet.columns = [
    { width: 28 },
    { width: 9 },
    { width: 14 },
    { width: 11 },
    { width: 11 },
    { width: 13 },
    { width: 16 },
  ];
  styleTitle(sheet, `${report.config.project.name} — construction phases`, subtitle, "G");

  sheet.getRow(6).values = [
    "Housing",
    "Phase",
    "Build by",
    "Pens added",
    "Rooms added",
    "Buildings added",
    "Capacity after",
  ];
  styleTableHeader(sheet.getRow(6), 1, 7);

  let row = 7;
  for (const phase of report.phases) {
    sheet.getRow(row).values = [
      HOUSING_LABELS[phase.housingType],
      phase.phase,
      phase.buildByDate ?? `Day ${phase.buildByDay}`,
      phase.pensAdded,
      phase.roomsAdded,
      phase.buildingsAdded ?? 0,
      phase.resultingCapacity,
    ];
    for (const column of [2, 4, 5, 6, 7]) sheet.getCell(row, column).numFmt = NUMBER_FORMAT;
    ruleRow(sheet, row, 7);
    row += 1;
  }

  row += 1;
  sheet.getCell(row, 1).value =
    "A room is dated by the first morning the simulated herd wanted a pen the rooms already standing could not give it, less the construction lead time. " +
    "Rooms falling due close together are one phase: a house that fills over its first two months is one piece of work, not five. " +
    "Nothing here is a commitment — it is the latest each piece of capacity could be built without the herd in the plan running out of room.";
  sheet.getCell(row, 1).alignment = { wrapText: true, vertical: "top" };
  sheet.getRow(row).height = 42;

  applyBase(sheet);
  sheet.headerFooter.oddFooter = "&LConstruction phases&RPage &P of &N";
}

/** What was considered, what was chosen, and by how much. */
function addOptionsSheet(
  workbook: Workbook,
  report: HousingNeedsReport,
  subtitle: string,
): void {
  const sheet = workbook.addWorksheet("Layout Options", {
    properties: { tabColor: { argb: "8A5FD6" } },
    views: [{ showGridLines: false }],
    pageSetup: { ...PORTRAIT_PAGE, fitToHeight: 0 },
  });
  sheet.columns = [
    { width: 16 },
    { width: 44 },
    { width: 10 },
    { width: 8 },
    { width: 8 },
    { width: 9 },
    { width: 12 },
    { width: 10 },
    { width: 12 },
  ];
  styleTitle(sheet, `${report.config.project.name} — layouts considered`, subtitle, "I");

  sheet.getRow(6).values = [
    "Option",
    "Arrangement",
    "Buildings",
    "Rooms",
    "Pens",
    "Spare",
    "Footprint m²",
    "Used %",
    "Cost score",
  ];
  styleTableHeader(sheet.getRow(6), 1, 9);

  let row = 7;
  for (const option of report.layoutOptions) {
    sheet.getRow(row).values = [
      option.label,
      option.description,
      option.buildingCount,
      option.roomCount,
      option.totalPens,
      option.sparePens,
      option.footprintM2,
      option.layoutEfficiencyPct,
      option.estimatedCostScore,
    ];
    for (const column of [3, 4, 5, 6]) sheet.getCell(row, column).numFmt = NUMBER_FORMAT;
    for (const column of [7, 8, 9]) sheet.getCell(row, column).numFmt = DECIMAL_FORMAT;
    sheet.getCell(row, 2).alignment = { wrapText: true, vertical: "top" };
    if (option.chosen) sheet.getRow(row).font = { bold: true };
    ruleRow(sheet, row, 9);
    row += 1;
  }

  row += 1;
  sheet.getCell(row, 1).value =
    "Every module, layout, rotation, room order and grouping the policy allows is assembled into real buildings and costed; these are the best few for each house. " +
    "The cost score is a proxy in equivalent square metres — floor, roof, external wall, internal partition, a figure per room and per building, the strip of footprint no room sits on, and the fit-out of any pen built and never filled. " +
    "It is for ranking arrangements of the same house against each other and is not a quotation. " +
    "Housing rules are not in the score at all: a layout that breaks one is never generated, so the cheapest option here is never the least compliant one.";
  sheet.getCell(row, 1).alignment = { wrapText: true, vertical: "top" };
  sheet.getRow(row).height = 56;

  applyBase(sheet);
  sheet.headerFooter.oddFooter = "&LLayouts considered&RPage &P of &N";
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
    sheet.getRow(row).height = 42;
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
