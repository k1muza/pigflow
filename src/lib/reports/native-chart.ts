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

function seriesCache(values: readonly number[]): string {
  const points = values
    .map(
      (value, index) =>
        '<c:pt idx="' +
        index +
        '"><c:v>' +
        (Number.isFinite(value) ? value : 0) +
        "</c:v></c:pt>",
    )
    .join("");
  return (
    '<c:numCache><c:formatCode>0.0</c:formatCode><c:ptCount val="' +
    values.length +
    '"/>' +
    points +
    "</c:numCache>"
  );
}

function numericReference(formula: string, values: readonly number[]): string {
  return (
    "<c:numRef><c:f>" +
    escapeXml(formula) +
    "</c:f>" +
    seriesCache(values) +
    "</c:numRef>"
  );
}

function richText(text: string, size = 1100, bold = false): string {
  return (
    "<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r>" +
    '<a:rPr lang="en-US" sz="' +
    size +
    '"' +
    (bold ? ' b="1"' : "") +
    "/><a:t>" +
    escapeXml(text) +
    "</a:t></a:r></a:p></c:rich></c:tx>"
  );
}

function chartSeries(options: {
  index: number;
  name: string;
  column: string;
  colour: string;
  marker: "circle" | "diamond" | "square" | "triangle";
  dashed?: boolean;
  ages: readonly number[];
  values: readonly number[];
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
  const dash = options.dashed ? '<a:prstDash val="dash"/>' : "";
  return (
    "<c:ser>" +
    '<c:idx val="' +
    options.index +
    '"/><c:order val="' +
    options.index +
    '"/>' +
    "<c:tx><c:v>" +
    escapeXml(options.name) +
    "</c:v></c:tx>" +
    '<c:spPr><a:ln w="28575"><a:solidFill><a:srgbClr val="' +
    options.colour +
    '"/></a:solidFill>' +
    dash +
    "</a:ln></c:spPr>" +
    "<c:marker><c:symbol val=\"" +
    options.marker +
    '\"/><c:size val="6"/><c:spPr><a:solidFill><a:srgbClr val="' +
    options.colour +
    '"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="' +
    options.colour +
    '"/></a:solidFill></a:ln></c:spPr></c:marker>' +
    "<c:cat>" +
    numericReference(categoryFormula, options.ages) +
    "</c:cat>" +
    "<c:val>" +
    numericReference(valueFormula, options.values) +
    "</c:val>" +
    '<c:smooth val="0"/>' +
    "</c:ser>"
  );
}

function growthChartXml(report: GrowthPerformanceReport): string {
  const points = report.checkpoints.filter((point) => point.sampleSize > 0);
  const ages = points.map((point) => point.ageDays);
  const firstRow = 7;
  const lastRow = firstRow + points.length - 1;
  const categoryAxisId = 48650112;
  const valueAxisId = 48672768;

  const series = [
    chartSeries({
      index: 0,
      name: "P10",
      column: "D",
      colour: COLORS.muted,
      marker: "circle",
      dashed: true,
      ages,
      values: points.map((point) => point.p10WeightKg),
      firstRow,
      lastRow,
    }),
    chartSeries({
      index: 1,
      name: "Median",
      column: "E",
      colour: COLORS.navy,
      marker: "diamond",
      ages,
      values: points.map((point) => point.medianWeightKg),
      firstRow,
      lastRow,
    }),
    chartSeries({
      index: 2,
      name: "Mean",
      column: "C",
      colour: COLORS.blue,
      marker: "square",
      ages,
      values: points.map((point) => point.meanWeightKg),
      firstRow,
      lastRow,
    }),
    chartSeries({
      index: 3,
      name: "P90",
      column: "F",
      colour: COLORS.green,
      marker: "triangle",
      dashed: true,
      ages,
      values: points.map((point) => point.p90WeightKg),
      firstRow,
      lastRow,
    }),
  ].join("");

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<c:chartSpace xmlns:c="' +
    CHART_NS +
    '" xmlns:a="' +
    DRAWING_MAIN_NS +
    '" xmlns:r="' +
    OFFICE_REL_NS +
    '">' +
    '<c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/>' +
    "<c:chart>" +
    richText("Observed growth curve", 1400, true) +
    '<c:autoTitleDeleted val="0"/>' +
    "<c:plotArea><c:layout/>" +
    '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>' +
    series +
    '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>' +
    '<c:axId val="' +
    categoryAxisId +
    '"/><c:axId val="' +
    valueAxisId +
    '"/></c:lineChart>' +
    '<c:catAx><c:axId val="' +
    categoryAxisId +
    '"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>' +
    richText("Age (days)", 1000, false) +
    '<c:numFmt formatCode="0" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' +
    '<c:crossAx val="' +
    valueAxisId +
    '"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>' +
    '<c:valAx><c:axId val="' +
    valueAxisId +
    '"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>' +
    '<c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="' +
    COLORS.line +
    '"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>' +
    richText("Liveweight (kg)", 1000, false) +
    '<c:numFmt formatCode="0.0" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' +
    '<c:crossAx val="' +
    categoryAxisId +
    '"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>' +
    "</c:plotArea>" +
    '<c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/></c:legend>' +
    '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/>' +
    "</c:chart>" +
    '<c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings>' +
    "</c:chartSpace>"
  );
}

function drawingXml(chartRelationshipId: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<xdr:wsDr xmlns:xdr="' +
    DRAWING_NS +
    '" xmlns:a="' +
    DRAWING_MAIN_NS +
    '">' +
    "<xdr:twoCellAnchor>" +
    "<xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>22</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>" +
    "<xdr:to><xdr:col>7</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>45</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>" +
    '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Observed growth curve"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/>' +
    '<a:graphic><a:graphicData uri="' +
    CHART_NS +
    '"><c:chart xmlns:c="' +
    CHART_NS +
    '" xmlns:r="' +
    OFFICE_REL_NS +
    '" r:id="' +
    escapeXml(chartRelationshipId) +
    '"/></a:graphicData></a:graphic>' +
    "</xdr:graphicFrame><xdr:clientData/>" +
    "</xdr:twoCellAnchor></xdr:wsDr>"
  );
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
    "../drawings/drawing" + drawingNumber + ".xml",
  );

  sheetXml = withRelationshipNamespace(sheetXml);
  sheetXml = sheetXml.replace(
    "</worksheet>",
    '<drawing r:id="' +
      drawingRelationshipId +
      '"/></worksheet>',
  );

  const chartRelationshipId = "rId1";
  const drawingRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="' +
    REL_NS +
    '"><Relationship Id="' +
    chartRelationshipId +
    '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart' +
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
