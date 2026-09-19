import type { PlannerConfig } from "./config";
import { planEventLog } from "./plan";
import { type FarmEvent } from "./sim";

/** A short word for each kind of line, so the log can be filtered on one column. */
const EVENT_LABELS: Record<FarmEvent["type"], string> = {
  farrowing: "Farrowing",
  weaning: "Weaning",
  selection: "Gilt selection",
  promotion: "Gilt promotion",
  sale: "Sale",
  death: "Death",
  cull: "Cull",
  purchase: "Purchase",
  funding: "Funding",
  market: "Market",
  service: "Service",
  return: "Return to heat",
  scan: "Pregnancy scan",
  "pregnancy-loss": "Pregnancy loss",
  inventory: "Inventory",
  health: "Health",
  processing: "Processing",
  capacity: "Capacity",
};

/**
 * One CSV field. A spreadsheet reads a bare comma as the next column and a bare
 * quote as the end of the field, so anything carrying either is quoted and its
 * own quotes doubled.
 */
function field(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The farm's own log of the run, as a spreadsheet can open it. One row per line
 * the farm wrote, in the order it wrote them.
 *
 * It is a log rather than a report: it is not rolled up, not reconciled against
 * the cashflow, and a day on which nothing worth writing happened has no row.
 * What it is good for is answering why the plan did something — which boar was
 * rotated when, what a service cost, when the lorry came.
 */
export function buildEventLogCsv(config: PlannerConfig): string {
  const rows = [
    ["Day", "Date", "Type", "Event"],
    ...planEventLog(config).map((event) => [
      event.day,
      event.date,
      EVENT_LABELS[event.type],
      event.message,
    ]),
  ];
  // Excel reads a file without the mark in the system codepage, which turns the
  // separators and dashes in these messages into mojibake.
  return "﻿" + rows.map((row) => row.map(field).join(",")).join("\r\n") + "\r\n";
}

/** A filename that says which plan the log came from. */
export function eventLogFilename(config: PlannerConfig): string {
  const slug = config.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "plan"}-event-log.csv`;
}
