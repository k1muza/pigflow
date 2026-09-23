import type { PigDatasheet } from "./pig-datasheet";
import {
  applyBase,
  COLORS,
  DECIMAL_FORMAT,
  FONT,
  LANDSCAPE_PAGE,
  newWorkbook,
  PORTRAIT_PAGE,
  ruleRow,
  solidFill,
  styleTableHeader,
  styleTitle,
  workbookBytes,
} from "./reports/sheet";

function addSummary(
  workbook: import("exceljs").Workbook,
  sheet: PigDatasheet,
  generatedAt: Date,
): void {
  const ws = workbook.addWorksheet("Pig summary", {
    properties: { tabColor: { argb: COLORS.navy } },
    pageSetup: PORTRAIT_PAGE,
    views: [{ showGridLines: false }],
  });
  ws.columns = [
    { width: 4 },
    { width: 27 },
    { width: 30 },
    { width: 22 },
  ];

  styleTitle(
    ws,
    `${sheet.tag} — pig datasheet`,
    `${sheet.projectName} · ${sheet.engine} simulation · prepared ${generatedAt.toLocaleDateString("en-GB")}`,
    "D",
  );

  const summary: Array<[string, string | number]> = [
    ["Tag", sheet.tag],
    ["Sex", sheet.sex],
    ["Generation", sheet.generation ?? "External / unknown"],
    ["Origin", sheet.origin],
    ["Dam", sheet.damTag ?? "Unknown / founding"],
    ["Sire", sheet.sireTag ?? "Unknown / founding"],
    ["Birth date", sheet.birthDate ?? "Unknown"],
    ["Entered simulated farm", sheet.firstSeenDate],
    ["Last recorded date", sheet.lastSeenDate ?? "Not recorded"],
    ["Exit date", sheet.exitDate ?? "Still present at horizon / not recorded"],
    ["Exit reason", sheet.exitReason ?? "—"],
  ];

  ws.getCell("B6").value = "Identity and lineage";
  ws.getCell("B6").font = {
    name: FONT,
    size: 12,
    bold: true,
    color: { argb: COLORS.navy },
  };

  summary.forEach(([label, value], index) => {
    const row = 8 + index;
    ws.getCell(row, 2).value = label;
    ws.getCell(row, 3).value = value;
    ws.getCell(row, 2).font = { name: FONT, size: 10, color: { argb: COLORS.muted } };
    ws.getCell(row, 3).font = { name: FONT, size: 10, bold: true, color: { argb: COLORS.ink } };
    ws.getCell(row, 2).fill = solidFill(COLORS.plane);
    ws.getCell(row, 3).fill = solidFill(COLORS.plane);
  });

  const first = sheet.daily.at(0);
  const last = sheet.daily.at(-1);
  const heatedDays = sheet.daily.filter((row) => row.underHeat).length;
  const careCount = sheet.events.filter(
    (event) => event.type === "Vaccination" || event.type === "Processing",
  ).length;
  const metricsRow = 21;
  ws.getCell(metricsRow, 2).value = "Simulation record";
  ws.getCell(metricsRow, 2).font = {
    name: FONT,
    size: 12,
    bold: true,
    color: { argb: COLORS.navy },
  };

  const metrics: Array<[string, string | number]> = [
    ["Days recorded", sheet.daily.length],
    ["First recorded weight (kg)", first?.weightKg ?? 0],
    ["Last recorded weight (kg)", last?.weightKg ?? 0],
    ["Recorded weight change (kg)", first && last ? last.weightKg - first.weightKg : 0],
    ["Days under supplementary heat", heatedDays],
    ["Vaccination / processing records", careCount],
    ["All recorded events", sheet.events.length],
  ];

  metrics.forEach(([label, value], index) => {
    const row = metricsRow + 2 + index;
    ws.getCell(row, 2).value = label;
    ws.getCell(row, 3).value = value;
    if (typeof value === "number" && label.includes("(kg)")) {
      ws.getCell(row, 3).numFmt = DECIMAL_FORMAT;
    }
    ruleRow(ws, row, 3);
  });

  ws.mergeCells("B33:D35");
  ws.getCell("B33").value =
    "This is a simulated animal record generated from the plan's assumptions. Daily weights, health work and heating describe what the PigFlow model simulated or scheduled; they are not a substitute for physical farm records.";
  ws.getCell("B33").alignment = { wrapText: true, vertical: "top" };
  ws.getCell("B33").font = {
    name: FONT,
    size: 9,
    italic: true,
    color: { argb: COLORS.muted },
  };

  applyBase(ws);
  ws.headerFooter.oddFooter = "&LPigFlow pig datasheet&RPage &P of &N";
}

function addDaily(
  workbook: import("exceljs").Workbook,
  sheet: PigDatasheet,
): void {
  const ws = workbook.addWorksheet("Daily record", {
    properties: { tabColor: { argb: COLORS.blue } },
    views: [{ state: "frozen", ySplit: 6, showGridLines: false }],
    pageSetup: LANDSCAPE_PAGE,
  });

  const headers = [
    "Date",
    "Simulation day",
    "Age (days)",
    "Stage / role",
    "Status",
    "Weight (kg)",
    "Daily weight change (kg)",
    "Under heat",
    "Farm heaters alight",
    "Farm heating gas (kg)",
    "Allocated heating gas (kg)",
    "Care due / given",
  ];
  ws.columns = [
    { width: 14 },
    { width: 14 },
    { width: 12 },
    { width: 15 },
    { width: 24 },
    { width: 14 },
    { width: 20 },
    { width: 12 },
    { width: 17 },
    { width: 20 },
    { width: 23 },
    { width: 42 },
  ];

  styleTitle(
    ws,
    `${sheet.tag} — daily history`,
    "One row per simulated day this animal was present on the farm.",
    "L",
  );
  ws.getRow(6).values = headers;
  styleTableHeader(ws.getRow(6), 1, headers.length);

  sheet.daily.forEach((entry, index) => {
    const row = 7 + index;
    ws.getRow(row).values = [
      entry.date,
      entry.day,
      entry.ageDays,
      entry.kind,
      entry.status,
      entry.weightKg,
      entry.dailyGainKg,
      entry.underHeat ? "Yes" : "No",
      entry.farmHeatersAlight,
      entry.farmHeatingGasKg,
      entry.allocatedHeatingGasKg,
      entry.care.join("; "),
    ];
    ws.getCell(row, 6).numFmt = DECIMAL_FORMAT;
    ws.getCell(row, 7).numFmt = DECIMAL_FORMAT;
    ws.getCell(row, 10).numFmt = DECIMAL_FORMAT;
    ws.getCell(row, 11).numFmt = DECIMAL_FORMAT;
    if (entry.underHeat) ws.getCell(row, 8).fill = solidFill(COLORS.paleGold);
    ruleRow(ws, row, headers.length);
  });

  ws.autoFilter = { from: "A6", to: "L6" };
  applyBase(ws);
  ws.headerFooter.oddFooter = "&LDaily animal history&RPage &P of &N";
}

function addEvents(
  workbook: import("exceljs").Workbook,
  sheet: PigDatasheet,
): void {
  const ws = workbook.addWorksheet("Care & events", {
    properties: { tabColor: { argb: COLORS.green } },
    views: [{ state: "frozen", ySplit: 6, showGridLines: false }],
    pageSetup: LANDSCAPE_PAGE,
  });
  const headers = [
    "Date",
    "Simulation day",
    "Age (days)",
    "Type",
    "Event",
    "Detail",
    "Source",
  ];
  ws.columns = [
    { width: 14 },
    { width: 14 },
    { width: 12 },
    { width: 20 },
    { width: 38 },
    { width: 58 },
    { width: 18 },
  ];

  styleTitle(
    ws,
    `${sheet.tag} — care and events`,
    "Vaccinations, processing, heating periods, stage changes and attributable simulation events.",
    "G",
  );
  ws.getRow(6).values = headers;
  styleTableHeader(ws.getRow(6), 1, headers.length);

  sheet.events.forEach((entry, index) => {
    const row = 7 + index;
    ws.getRow(row).values = [
      entry.date,
      entry.day,
      entry.ageDays,
      entry.type,
      entry.event,
      entry.detail,
      entry.source,
    ];
    if (entry.type === "Vaccination") ws.getCell(row, 4).fill = solidFill(COLORS.paleBlue);
    if (entry.type === "Heating") ws.getCell(row, 4).fill = solidFill(COLORS.paleGold);
    if (entry.type === "Processing") ws.getCell(row, 4).fill = solidFill(COLORS.paleGreen);
    ws.getCell(row, 6).alignment = { wrapText: true, vertical: "top" };
    ruleRow(ws, row, headers.length);
  });

  ws.autoFilter = { from: "A6", to: "G6" };
  applyBase(ws);
  ws.headerFooter.oddFooter = "&LCare and event history&RPage &P of &N";
}

export async function buildPigDatasheetWorkbook(
  sheet: PigDatasheet,
  generatedAt = new Date(),
): Promise<ArrayBuffer> {
  const workbook = await newWorkbook({
    title: `${sheet.tag} pig datasheet`,
    subject: "Individual PigFlow simulated animal record",
    description:
      "Individual animal lineage, daily liveweight, heating and care history generated from PigFlow.",
    company: sheet.projectName,
    created: generatedAt,
  });

  addSummary(workbook, sheet, generatedAt);
  addDaily(workbook, sheet);
  addEvents(workbook, sheet);
  return workbookBytes(workbook);
}
