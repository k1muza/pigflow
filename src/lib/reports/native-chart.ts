import JSZip from "jszip";

import type { GrowthPerformanceReport } from "./growth-performance";
import { COLORS } from "./sheet";

const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const DRAWING_NS =
  "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const DRAWING_MAIN_NS =
  "http://schemas.openxmlformats.org/drawingml/2006/main";
const CHART_NS =
  "http://schemas.openxmlformats.org/drawingml/2006/chart";

function attr(xml: string, name: string): string | null {
  return new RegExp(name + '="([^"]*)"').exec(xml)?.[1] ?? null;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function withRelationshipNamespace(xml: string): string {
  if (xml.includes("xmlns:r=")) return xml;
  return xml.replace(
    /<worksheet\b/,
    '<worksheet xmlns:r="' + OFFICE_REL_NS + '"',
  );
}

function nextRelationshipId(xml: string): string {
  let max = 0;
  for (const match of xml.matchAll(/\bId="rId(\d+)"/g)) {
    max = Math.max(max, Number(match[1]));
  }
  return "rId" + (max + 1);
}

function addRelationship(
  xml: string,
  id: string,
  type: string,
  target: string,
): string {
  const relationship =
    '<Relationship Id="' +
    escapeXml(id) +
    '" Type="' +
    escapeXml(type) +
    '" Target="' +
    escapeXml(target) +
    '"/>';
  return xml.replace("</Relationships>", relationship + "</Relationships>");
}

function addContentType(
  xml: string,
  partName: string,
  contentType: string,
): string {
  if (xml.includes('PartName="' + partName + '"')) return xml;
  const override =
    '<Override PartName="' +
    escapeXml(partName) +
    '" ContentType="' +
    escapeXml(contentType) +
    '"/>';
  return xml.replace("</Types>", override + "</Types>");
}

function nextPartNumber(paths: readonly string[], pattern: RegExp): number {
  let max = 0;
  for (const path of paths) {
    const match = pattern.exec(path);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function normaliseWorkbookTarget(target: string): string {
  const withoutLeadingSlash = target.replace(/^\//, "");
  return withoutLeadingSlash.startsWith("xl/")
    ? withoutLeadingSlash
    : "xl/" + withoutLeadingSlash;
}

function chartTitle(text: string): string {
  return (
    "<c:title><c:tx><c:rich>" +
    '<a:bodyPr xmlns:a="' +
    DRAWING_MAIN_NS +
    '"/>' +
    '<a:p xmlns:a="' +
    DRAWING_MAIN_NS +
    '"><a:pPr><a:defRPr/></a:pPr><a:r><a:t>' +
    escapeXml(text) +
    "</a:t></a:r></a:p></c:rich></c:tx></c:title>"
  );
}

function seriesReference(formula: string): string {
  return "<c:numRef><c:f>" + escapeXml(formula) + "</c:f></c:numRef>";
}

function chartSeries(options: {
  index: number;
  column: string;
  colour: string;
  marker: "circle" | "diamond" | "square" | "triangle";
  dashed?: boolean;
  firstRow: number;
  lastRow: number;
}): string {
  const categoryFormula =
    "'Weight by age'!$A$" + options.firstRow + ":$A$" + options.lastRow;
  const valueFormula =
    "'Weight by age'!$" +
    options.column +
    "$" +
    options.firstRow +
    ":$" +
    options.column +
    "$" +
    options.lastRow;
  const headerFormula = "'Weight by age'!" + options.column + "6";
  const dash = options.dashed ? "dash" : "solid";

  return (
    "<c:ser>" +
    '<c:idx val="' +
    options.index +
    '"/><c:order val="' +
    options.index +
    '"/>' +
    "<c:tx><c:strRef><c:f>" +
    escapeXml(headerFormula) +
    "</c:f></c:strRef></c:tx>" +
    '<c:spPr><a:ln xmlns:a="' +
    DRAWING_MAIN_NS +
    '" w="25000"><a:solidFill><a:srgbClr val="' +
    options.colour +
    '"/></a:solidFill><a:prstDash val="' +
    dash +
    '"/></a:ln></c:spPr>' +
    '<c:marker><c:symbol val="' +
    options.marker +
    '"/><c:size val="6"/><c:spPr>' +
    '<a:solidFill xmlns:a="' +
    DRAWING_MAIN_NS +
    '"><a:srgbClr val="' +
    options.colour +
    '"/></a:solidFill>' +
    '<a:ln xmlns:a="' +
    DRAWING_MAIN_NS +
    '"><a:solidFill><a:srgbClr val="' +
    options.colour +
    '"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
    "</c:spPr></c:marker>" +
    "<c:cat>" +
    seriesReference(categoryFormula) +
    "</c:cat>" +
    "<c:val>" +
    seriesReference(valueFormula) +
    "</c:val>" +
    "</c:ser>"
  );
}

/**
 * This deliberately mirrors the conservative chart markup produced by
 * established XLSX writers. Excel repairs chart parts aggressively: optional
 * elements in the wrong schema position are enough for it to discard a chart.
 * Keep this small and standards-shaped rather than "feature rich" XML.
 */
function growthChartXml(report: GrowthPerformanceReport): string {
  const points = report.checkpoints.filter((point) => point.sampleSize > 0);
  const firstRow = 7;
  const lastRow = firstRow + points.length - 1;
  const categoryAxisId = 10;
  const valueAxisId = 100;

  const series = [
    chartSeries({
      index: 0,
      column: "D",
      colour: COLORS.muted,
      marker: "circle",
      dashed: true,
      firstRow,
      lastRow,
    }),
    chartSeries({
      index: 1,
      column: "E",
      colour: COLORS.navy,
      marker: "diamond",
      firstRow,
      lastRow,
    }),
    chartSeries({
      index: 2,
      column: "C",
      colour: COLORS.blue,
      marker: "square",
      firstRow,
      lastRow,
    }),
    chartSeries({
      index: 3,
      column: "F",
      colour: COLORS.green,
      marker: "triangle",
      dashed: true,
      firstRow,
      lastRow,
    }),
  ].join("");

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<c:chartSpace xmlns:c="' +
    CHART_NS +
    '">' +
    "<c:chart>" +
    chartTitle("Observed growth curve") +
    "<c:plotArea>" +
    '<c:lineChart><c:grouping val="standard"/>' +
    series +
    '<c:axId val="' +
    categoryAxisId +
    '"/><c:axId val="' +
    valueAxisId +
    '"/></c:lineChart>' +
    '<c:catAx><c:axId val="' +
    categoryAxisId +
    '"/><c:scaling><c:orientation val="minMax"/></c:scaling>' +
    '<c:axPos val="l"/>' +
    chartTitle("Age (days)") +
    '<c:majorTickMark val="none"/><c:minorTickMark val="none"/>' +
    '<c:crossAx val="' +
    valueAxisId +
    '"/><c:lblOffset val="100"/></c:catAx>' +
    '<c:valAx><c:axId val="' +
    valueAxisId +
    '"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling>' +
    '<c:axPos val="l"/><c:majorGridlines/>' +
    chartTitle("Liveweight (kg)") +
    '<c:majorTickMark val="none"/><c:minorTickMark val="none"/>' +
    '<c:crossAx val="' +
    categoryAxisId +
    '"/></c:valAx>' +
    "</c:plotArea>" +
    '<c:legend><c:legendPos val="b"/></c:legend>' +
    '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>' +
    "</c:chart></c:chartSpace>"
  );
}

function drawingXml(chartRelationshipId: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<xdr:wsDr xmlns:xdr="' +
    DRAWING_NS +
    '">' +
    "<xdr:oneCellAnchor>" +
    "<xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>22</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>" +
    '<xdr:ext cx="7920000" cy="3600000"/>' +
    "<xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id=\"1\" name=\"Observed growth curve\"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/>" +
    '<a:graphic xmlns:a="' +
    DRAWING_MAIN_NS +
    '"><a:graphicData uri="' +
    CHART_NS +
    '"><c:chart xmlns:c="' +
    CHART_NS +
    '" xmlns:r="' +
    OFFICE_REL_NS +
    '" r:id="' +
    escapeXml(chartRelationshipId) +
    '"/></a:graphicData></a:graphic>' +
    "</xdr:graphicFrame><xdr:clientData/>" +
    "</xdr:oneCellAnchor></xdr:wsDr>"
  );
}

function insertWorksheetDrawing(
  worksheetXml: string,
  relationshipId: string,
): string {
  const drawing = '<drawing r:id="' + escapeXml(relationshipId) + '"/>';
  const laterElements =
    /<(?:legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/;
  const match = laterElements.exec(worksheetXml);
  if (match) {
    return (
      worksheetXml.slice(0, match.index) +
      drawing +
      worksheetXml.slice(match.index)
    );
  }
  return worksheetXml.replace("</worksheet>", drawing + "</worksheet>");
}

/**
 * Adds a real Excel chart to the workbook package.
 *
 * ExcelJS can read and write workbook data but does not expose chart creation.
 * XLSX is an OOXML zip package, so we add the standard worksheet drawing and
 * chart parts after ExcelJS has serialised the workbook. Excel/LibreOffice then
 * see an ordinary editable chart whose series point at the worksheet cells.
 */
export async function addNativeGrowthChart(
  input: ArrayBuffer,
  report: GrowthPerformanceReport,
): Promise<ArrayBuffer> {
  const points = report.checkpoints.filter((point) => point.sampleSize > 0);
  if (points.length < 2) return input;

  const zip = await JSZip.loadAsync(input);
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  const workbookRelsXml = await zip
    .file("xl/_rels/workbook.xml.rels")
    ?.async("string");
  const contentTypesXml = await zip.file("[Content_Types].xml")?.async("string");
  if (!workbookXml || !workbookRelsXml || !contentTypesXml) {
    throw new Error("The workbook package is missing its core OOXML parts.");
  }

  const sheetTag = [...workbookXml.matchAll(/<sheet\b[^>]*>/g)].find(
    (match) => attr(match[0], "name") === "Weight by age",
  )?.[0];
  const sheetRelationshipId = sheetTag ? attr(sheetTag, "r:id") : null;
  if (!sheetRelationshipId) {
    throw new Error("Weight by age worksheet relationship was not found.");
  }

  const workbookRelationship = [
    ...workbookRelsXml.matchAll(/<Relationship\b[^>]*>/g),
  ].find((match) => attr(match[0], "Id") === sheetRelationshipId)?.[0];
  const sheetTarget = workbookRelationship
    ? attr(workbookRelationship, "Target")
    : null;
  if (!sheetTarget) {
    throw new Error("Weight by age worksheet target was not found.");
  }

  const sheetPath = normaliseWorkbookTarget(sheetTarget);
  const worksheet = zip.file(sheetPath);
  if (!worksheet) throw new Error("Weight by age worksheet XML was not found.");
  let sheetXml = await worksheet.async("string");

  const allPaths = Object.keys(zip.files);
  const drawingNumber = nextPartNumber(
    allPaths,
    /^xl\/drawings\/drawing(\d+)\.xml$/,
  );
  const chartNumber = nextPartNumber(
    allPaths,
    /^xl\/charts\/chart(\d+)\.xml$/,
  );
  const drawingPath = "xl/drawings/drawing" + drawingNumber + ".xml";
  const chartPath = "xl/charts/chart" + chartNumber + ".xml";

  const slash = sheetPath.lastIndexOf("/");
  const sheetDirectory = sheetPath.slice(0, slash);
  const sheetFile = sheetPath.slice(slash + 1);
  const sheetRelsPath =
    sheetDirectory + "/_rels/" + sheetFile + ".rels";

  let sheetRelsXml = await zip.file(sheetRelsPath)?.async("string");
  if (!sheetRelsXml) {
    sheetRelsXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="' +
      REL_NS +
      '"></Relationships>';
  }
  const drawingRelationshipId = nextRelationshipId(sheetRelsXml);
  sheetRelsXml = addRelationship(
    sheetRelsXml,
    drawingRelationshipId,
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
    "/xl/drawings/drawing" + drawingNumber + ".xml",
  );

  sheetXml = withRelationshipNamespace(sheetXml);
  sheetXml = insertWorksheetDrawing(sheetXml, drawingRelationshipId);

  const chartRelationshipId = "rId1";
  const drawingRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="' +
    REL_NS +
    '"><Relationship Id="' +
    chartRelationshipId +
    '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="/xl/charts/chart' +
    chartNumber +
    '.xml"/></Relationships>';

  let nextContentTypes = addContentType(
    contentTypesXml,
    "/" + drawingPath,
    "application/vnd.openxmlformats-officedocument.drawing+xml",
  );
  nextContentTypes = addContentType(
    nextContentTypes,
    "/" + chartPath,
    "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
  );

  zip.file(sheetPath, sheetXml);
  zip.file(sheetRelsPath, sheetRelsXml);
  zip.file(drawingPath, drawingXml(chartRelationshipId));
  zip.file(
    "xl/drawings/_rels/drawing" + drawingNumber + ".xml.rels",
    drawingRels,
  );
  zip.file(chartPath, growthChartXml(report));
  zip.file("[Content_Types].xml", nextContentTypes);

  return zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
