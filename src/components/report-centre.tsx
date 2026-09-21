"use client";

import { useMemo, useState } from "react";
import { Download, Eye, FileSpreadsheet, LoaderCircle, RefreshCcw } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { downloadFile, XLSX_MIME } from "@/lib/download";
import {
  REPORTS,
  reportFilename,
  reportingPeriod,
  type PreviewLine,
  type ReportDefinition,
  type ReportId,
} from "@/lib/reports";
import type { PlanSimulationResult } from "@/lib/simulation-result";

/**
 * The report centre: every document this plan can produce, in one place.
 *
 * Export buttons used to live wherever the figures they exported happened to be
 * drawn, which made "what can I send a lender?" a question you answered by
 * walking the app. So the documents are gathered here instead, and the pages go
 * back to being ways of looking at the plan.
 *
 * Every card is an entry in {@link REPORTS} and this component knows nothing
 * about any of them — not their lines, not their arithmetic, not even how many
 * there are. A fifth report is a fifth entry in the catalogue.
 *
 * Nothing on this page simulates anything. It is handed the finished run the
 * rest of the plan is already showing, so a figure in a downloaded document and
 * the same figure on the money page are the same figure rather than two answers
 * that ought to agree.
 */
export function Reports({
  simulation,
  /**
   * Whether the run on screen answers the inputs as they now stand. While it
   * does not, the downloads are held: a workbook is a thing people send, and it
   * should not quietly describe the edit before last.
   */
  current,
  updating,
}: {
  simulation: PlanSimulationResult;
  current: boolean;
  updating: boolean;
}) {
  const [busy, setBusy] = useState<ReportId | null>(null);
  const [previewing, setPreviewing] = useState<ReportDefinition | null>(null);
  const period = useMemo(() => reportingPeriod(simulation.config), [simulation.config]);

  async function download(report: ReportDefinition) {
    if (!current || busy) return;
    setBusy(report.id);
    try {
      const output = await report.build(simulation, new Date());
      downloadFile(output, reportFilename(simulation.config, report), XLSX_MIME);
    } catch (error) {
      console.error(error);
      window.alert(`${report.name} could not be generated. Please try again.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-ink">Reports</h2>
        <p className="mt-1.5 max-w-3xl text-sm leading-6 text-ink-muted">
          Planning documents generated from the plan currently simulated. Every report reads the
          same finished run as the Money, Simulator and Cashflow pages, so the figures cannot
          differ from what is on screen.
        </p>
      </div>

      {!current ? <Recalculating updating={updating} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {REPORTS.map((report) => (
          <ReportCard
            key={report.id}
            report={report}
            period={period}
            ready={current}
            busy={busy === report.id}
            onDownload={() => void download(report)}
            onPreview={() => setPreviewing(report)}
          />
        ))}
      </div>

      <PreviewDialog
        report={previewing}
        simulation={simulation}
        onClose={() => setPreviewing(null)}
      />
    </div>
  );
}

/**
 * Why the downloads are held. The same rule the cashflow export has always
 * used, said out loud here because this page is nothing but downloads.
 */
function Recalculating({ updating }: { updating: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-hairline bg-raised/50 p-4 text-sm">
      {updating ? (
        <LoaderCircle size={16} className="mt-0.5 shrink-0 animate-spin text-ink-faint" />
      ) : (
        <RefreshCcw size={16} className="mt-0.5 shrink-0 text-ink-faint" />
      )}
      <div>
        <p className="font-medium text-ink">
          {updating ? "The plan is still being recalculated." : "The plan has not finished running."}
        </p>
        <p className="mt-1 text-ink-muted">
          Downloads are held until the run finishes, so that a document you send describes the
          inputs as they now stand rather than the edit before last.
        </p>
      </div>
    </div>
  );
}

const FORMAT_LABELS: Record<ReportDefinition["format"], string> = {
  xlsx: "Excel workbook (.xlsx)",
};

function ReportCard({
  report,
  period,
  ready,
  busy,
  onDownload,
  onPreview,
}: {
  report: ReportDefinition;
  period: string;
  ready: boolean;
  busy: boolean;
  onDownload: () => void;
  onPreview: () => void;
}) {
  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="flex h-full flex-col">
        <div className="flex items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-muted">
            <FileSpreadsheet size={16} strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight text-ink">{report.name}</h3>
            <p className="mt-1.5 text-xs leading-5 text-ink-muted">{report.description}</p>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-hairline pt-3.5 text-xs">
          <div>
            <dt className="text-ink-faint">Reporting period</dt>
            <dd className="mt-0.5 font-medium text-ink">{period}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Format</dt>
            <dd className="mt-0.5 font-medium text-ink">{FORMAT_LABELS[report.format]}</dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" disabled={!ready || busy} onClick={onDownload}>
            <Download size={14} />
            {busy ? "Preparing…" : "Download Excel"}
          </Button>
          <Button size="sm" variant="outline" disabled={!ready} onClick={onPreview}>
            <Eye size={14} /> Preview
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * What the download contains, before downloading it.
 *
 * Built from the report's own line definitions rather than from a summary
 * written beside them, so a preview that looked right and a workbook that did
 * not is a thing that cannot happen. The summary columns are shown rather than
 * every month: sixty columns is a file, not a panel.
 */
function PreviewDialog({
  report,
  simulation,
  onClose,
}: {
  report: ReportDefinition | null;
  simulation: PlanSimulationResult;
  onClose: () => void;
}) {
  const preview = useMemo(
    () => (report ? report.preview(simulation) : null),
    [report, simulation],
  );
  return (
    <Dialog open={report !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="flex h-[calc(100dvh-4rem)] max-h-[860px] max-w-[min(1100px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-hairline px-5 py-4 pr-14">
          <DialogTitle>{report?.name ?? "Report"}</DialogTitle>
          <DialogDescription>{report?.description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto p-5">
          {preview ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {preview.facts.map((fact) => (
                  <Card key={fact.label} size="sm">
                    <CardContent>
                      <p className="text-xs font-medium text-ink-faint">{fact.label}</p>
                      <p className="mt-1.5 text-lg font-semibold tracking-tight tabular-nums text-ink">
                        {fact.value}
                      </p>
                      {fact.note ? (
                        <p className="mt-1 text-[11px] leading-4 text-ink-faint">{fact.note}</p>
                      ) : null}
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="mt-5 overflow-hidden rounded-lg border border-hairline">
                <table className="w-full border-collapse text-xs">
                  <thead className="border-b border-hairline bg-plane text-left text-ink-muted">
                    <tr>
                      <th className="px-3 py-2.5 font-medium">Line</th>
                      {preview.columns.map((column) => (
                        <th key={column} className="px-3 py-2.5 text-right font-medium">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.lines.map((line, index) => (
                      <PreviewRow key={line.label + index} line={line} columns={preview.columns.length} />
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="mt-3 text-[11px] leading-5 text-ink-faint">{preview.note}</p>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreviewRow({ line, columns }: { line: PreviewLine; columns: number }) {
  if (line.kind === "section") {
    return (
      <tr className="bg-raised/60">
        <td
          colSpan={columns + 1}
          className="px-3 py-2 text-[11px] font-semibold tracking-wide text-ink"
        >
          {line.label}
        </td>
      </tr>
    );
  }
  const emphasis =
    line.kind === "result"
      ? "font-semibold text-ink"
      : line.kind === "total" || line.kind === "subtotal"
        ? "font-medium text-ink"
        : line.kind === "memo"
          ? "italic text-ink-faint"
          : "text-ink-muted";
  return (
    <tr className={`border-b border-hairline last:border-0 ${emphasis}`}>
      <td className="px-3 py-2">{line.label}</td>
      {line.cells.map((cell, index) => (
        <td key={index} className="px-3 py-2 text-right tabular-nums">
          {cell}
        </td>
      ))}
    </tr>
  );
}
