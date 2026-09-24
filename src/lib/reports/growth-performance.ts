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


type Rgb = readonly [number, number, number];

function rgb(hex: string): Rgb {
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function setPixel(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  colour: Rgb,
): void {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return;
  const offset = (py * width + px) * 4;
  pixels[offset] = colour[0];
  pixels[offset + 1] = colour[1];
  pixels[offset + 2] = colour[2];
  pixels[offset + 3] = 255;
}

function drawLine(
  pixels: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colour: Rgb,
  thickness = 2,
  dashed = false,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  for (let step = 0; step <= steps; step += 1) {
    if (dashed && Math.floor(step / 7) % 2 === 1) continue;
    const x = x0 + (dx * step) / steps;
    const y = y0 + (dy * step) / steps;
    const radius = Math.max(0, Math.floor(thickness / 2));
    for (let ox = -radius; ox <= radius; ox += 1) {
      for (let oy = -radius; oy <= radius; oy += 1) {
        setPixel(pixels, width, height, x + ox, y + oy, colour);
      }
    }
  }
}

function drawMarker(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  colour: Rgb,
): void {
  for (let ox = -3; ox <= 3; ox += 1) {
    for (let oy = -3; oy <= 3; oy += 1) {
      if (ox * ox + oy * oy <= 9) {
        setPixel(pixels, width, height, x + ox, y + oy, colour);
      }
    }
  }
}


const BITMAP_FONT: Record<string, readonly string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "d": ["100", "100", "111", "101", "111"],
  "a": ["000", "111", "001", "111", "111"],
  "y": ["000", "101", "111", "001", "111"],
  "s": ["000", "111", "100", "011", "111"],
  "k": ["100", "101", "110", "101", "101"],
  "g": ["000", "111", "101", "111", "001"],
  " ": ["0", "0", "0", "0", "0"],
};

function textWidth(text: string, scale = 2): number {
  let width = 0;
  for (const character of text) {
    const glyph = BITMAP_FONT[character] ?? BITMAP_FONT[" "];
    width += (glyph[0].length + 1) * scale;
  }
  return Math.max(0, width - scale);
}

function drawText(
  pixels: Uint8Array,
  width: number,
  height: number,
  text: string,
  x: number,
  y: number,
  colour: Rgb,
  scale = 2,
): void {
  let cursor = Math.round(x);
  const top = Math.round(y);
  for (const character of text) {
    const glyph = BITMAP_FONT[character] ?? BITMAP_FONT[" "];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] !== "1") continue;
        for (let sx = 0; sx < scale; sx += 1) {
          for (let sy = 0; sy < scale; sy += 1) {
            setPixel(
              pixels,
              width,
              height,
              cursor + column * scale + sx,
              top + row * scale + sy,
              colour,
            );
          }
        }
      }
    }
    cursor += (glyph[0].length + 1) * scale;
  }
}

function uint32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function joinBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

function pngChunk(type: string, payload: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  return joinBytes(
    uint32(payload.length),
    typeBytes,
    payload,
    uint32(crc32(joinBytes(typeBytes, payload))),
  );
}

async function compressForPng(raw: Uint8Array): Promise<Uint8Array> {
  const source = raw.buffer.slice(
    raw.byteOffset,
    raw.byteOffset + raw.byteLength,
  ) as ArrayBuffer;
  const stream = new Blob([source])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function base64Of(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

async function growthCurvePng(report: GrowthPerformanceReport): Promise<string | null> {
  const points = report.checkpoints.filter((point) => point.sampleSize > 0);
  if (points.length < 2) return null;

  const width = 760;
  const height = 330;
  const margin = { left: 52, right: 14, top: 18, bottom: 42 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxAge = Math.max(...points.map((point) => point.ageDays), 1);
  const maxObserved = Math.max(...points.map((point) => point.p90WeightKg), 1);
  const maxWeight = Math.max(20, Math.ceil(maxObserved / 20) * 20);

  const pixels = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = 255;
    pixels[offset + 1] = 255;
    pixels[offset + 2] = 255;
    pixels[offset + 3] = 255;
  }

  const line = rgb(COLORS.line);
  const ink = rgb(COLORS.ink);
  const series = [
    {
      values: points.map((point) => point.p10WeightKg),
      colour: rgb(COLORS.muted),
      dashed: true,
    },
    {
      values: points.map((point) => point.medianWeightKg),
      colour: rgb(COLORS.navy),
      dashed: false,
    },
    {
      values: points.map((point) => point.meanWeightKg),
      colour: rgb(COLORS.blue),
      dashed: false,
    },
    {
      values: points.map((point) => point.p90WeightKg),
      colour: rgb(COLORS.green),
      dashed: true,
    },
  ];

  const xOf = (ageDays: number) =>
    margin.left + (ageDays / maxAge) * plotWidth;
  const yOf = (weightKg: number) =>
    margin.top + (1 - weightKg / maxWeight) * plotHeight;

  for (let weight = 0; weight <= maxWeight; weight += 20) {
    const y = yOf(weight);
    drawLine(
      pixels,
      width,
      height,
      margin.left,
      y,
      width - margin.right,
      y,
      line,
      1,
    );
    const label = String(weight);
    drawText(
      pixels,
      width,
      height,
      label,
      margin.left - textWidth(label, 2) - 8,
      y - 5,
      ink,
      2,
    );
  }

  for (const point of points) {
    const x = xOf(point.ageDays);
    drawLine(
      pixels,
      width,
      height,
      x,
      margin.top,
      x,
      height - margin.bottom,
      line,
      1,
    );
    const label = String(point.ageDays);
    drawText(
      pixels,
      width,
      height,
      label,
      x - textWidth(label, 2) / 2,
      height - margin.bottom + 8,
      ink,
      2,
    );
  }

  drawText(
    pixels,
    width,
    height,
    "kg",
    4,
    margin.top - 3,
    ink,
    2,
  );
  drawText(
    pixels,
    width,
    height,
    "days",
    width - margin.right - textWidth("days", 2),
    height - 12,
    ink,
    2,
  );

  drawLine(
    pixels,
    width,
    height,
    margin.left,
    margin.top,
    margin.left,
    height - margin.bottom,
    ink,
    2,
  );
  drawLine(
    pixels,
    width,
    height,
    margin.left,
    height - margin.bottom,
    width - margin.right,
    height - margin.bottom,
    ink,
    2,
  );

  for (const item of series) {
    for (let index = 1; index < points.length; index += 1) {
      drawLine(
        pixels,
        width,
        height,
        xOf(points[index - 1].ageDays),
        yOf(item.values[index - 1]),
        xOf(points[index].ageDays),
        yOf(item.values[index]),
        item.colour,
        item.dashed ? 2 : 3,
        item.dashed,
      );
    }
    item.values.forEach((value, index) => {
      drawMarker(
        pixels,
        width,
        height,
        xOf(points[index].ageDays),
        yOf(value),
        item.colour,
      );
    });
  }

  const raw = new Uint8Array(height * (1 + width * 4));
  for (let row = 0; row < height; row += 1) {
    const target = row * (1 + width * 4);
    raw[target] = 0;
    raw.set(
      pixels.subarray(row * width * 4, (row + 1) * width * 4),
      target + 1,
    );
  }

  const ihdr = new Uint8Array(13);
  ihdr.set(uint32(width), 0);
  ihdr.set(uint32(height), 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const png = joinBytes(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", await compressForPng(raw)),
    pngChunk("IEND", new Uint8Array()),
  );

  return "data:image/png;base64," + base64Of(png);
}

async function addCurveSheet(
  workbook: Workbook,
  report: GrowthPerformanceReport,
): Promise<void> {
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

  const chartTitleRow = 23;
  sheet.mergeCells(chartTitleRow, 1, chartTitleRow, 7);
  sheet.getCell(chartTitleRow, 1).value = "Observed growth curve";
  sheet.getCell(chartTitleRow, 1).font = {
    bold: true,
    color: { argb: COLORS.navy },
  };

  const legendRow = chartTitleRow + 1;
  const legend = [
    ["P10", COLORS.muted],
    ["Median", COLORS.navy],
    ["Mean", COLORS.blue],
    ["P90", COLORS.green],
  ] as const;
  legend.forEach(([label, colour], index) => {
    const cell = sheet.getCell(legendRow, index + 1);
    cell.value = label;
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: colour },
    };
    cell.font = { bold: true, color: { argb: COLORS.white } };
    cell.alignment = { horizontal: "center" };
  });

  const png = await growthCurvePng(report);
  if (png) {
    const imageId = workbook.addImage({ base64: png, extension: "png" });
    sheet.addImage(imageId, "A26:G45");
    sheet.mergeCells("A46:G46");
    sheet.getCell("A46").value =
      "X-axis: age in days (0 to " +
      Math.max(...report.checkpoints.map((point) => point.ageDays), 0) +
      "). Y-axis: liveweight, scaled to the observed P90 range.";
    sheet.getCell("A46").font = {
      italic: true,
      size: 9,
      color: { argb: COLORS.muted },
    };
  }

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
  await addCurveSheet(workbook, report);
  addStageSheet(workbook, report);
  addMarketSheet(workbook, report, generatedAt);
}
