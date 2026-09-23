"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  GitBranch,
  Maximize2,
  Search,
  Users,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import type { PedigreeRecord } from "@/lib/pedigree";

type Props = {
  records: readonly PedigreeRecord[];
};

type DisplayNode = {
  id: string;
  label: string;
  subtitle: string;
  generation: number | null;
  kind: PedigreeRecord["kind"] | "litter";
  count: number;
  members: string[];
  damTag: string | null;
  sireTag: string | null;
  birthDay: number | null;
};

type Positioned = DisplayNode & { x: number; y: number };

type Edge = {
  id: string;
  from: string;
  to: string;
  parentTag: string;
  childTags: string[];
};

const NODE_W = 180;
const NODE_H = 48;
const X_GAP = 270;
const Y_GAP = 68;
const PAD = 64;

function litterKey(row: PedigreeRecord): string | null {
  if (row.damTag === null || row.birthDay === null) return null;
  return [row.damTag, row.sireTag ?? "unknown", row.birthDay, row.generation ?? 0].join("|");
}

function compactGraph(
  records: readonly PedigreeRecord[],
  collapseLitters: boolean,
  expanded: ReadonlySet<string>,
): {
  nodes: DisplayNode[];
  edges: Edge[];
  tagToNode: Map<string, string>;
} {
  const parentTags = new Set<string>();
  for (const row of records) {
    if (row.damTag) parentTags.add(row.damTag);
    if (row.sireTag) parentTags.add(row.sireTag);
  }

  const nodes: DisplayNode[] = [];
  const tagToNode = new Map<string, string>();
  const grouped = new Map<string, PedigreeRecord[]>();

  for (const row of records) {
    const key = litterKey(row);
    const canCollapse =
      collapseLitters &&
      key !== null &&
      !expanded.has(key) &&
      row.kind === "pig" &&
      !parentTags.has(row.tag);

    if (canCollapse) {
      const rows = grouped.get(key);
      if (rows) rows.push(row);
      else grouped.set(key, [row]);
      continue;
    }

    const id = "animal:" + row.tag;
    nodes.push({
      id,
      label: row.tag,
      subtitle:
        row.kind === "stud"
          ? "AI stud"
          : row.kind === "sow"
            ? "breeding sow"
            : row.kind === "boar"
              ? "boar"
              : row.origin === "purchased"
                ? "bought in"
                : "pig",
      generation: row.generation,
      kind: row.kind,
      count: 1,
      members: [row.tag],
      damTag: row.damTag,
      sireTag: row.sireTag,
      birthDay: row.birthDay,
    });
    tagToNode.set(row.tag, id);
  }

  for (const [key, rows] of grouped) {
    const first = rows[0];
    const id = "litter:" + key;
    nodes.push({
      id,
      label: rows.length + (rows.length === 1 ? " pig" : " pigs"),
      subtitle: first.damTag ? "litter of " + first.damTag : "litter",
      generation: first.generation,
      kind: "litter",
      count: rows.length,
      members: rows.map((row) => row.tag),
      damTag: first.damTag,
      sireTag: first.sireTag,
      birthDay: first.birthDay,
    });
    for (const row of rows) tagToNode.set(row.tag, id);
  }

  const edgeSeen = new Set<string>();
  const edges: Edge[] = [];
  for (const row of records) {
    const to = tagToNode.get(row.tag);
    if (!to) continue;
    for (const parentTag of [row.damTag, row.sireTag]) {
      if (!parentTag) continue;
      const from = tagToNode.get(parentTag);
      if (!from || from === to) continue;
      const id = from + ">" + to;
      if (edgeSeen.has(id)) continue;
      edgeSeen.add(id);
      const childTags = nodes.find((node) => node.id === to)?.members ?? [row.tag];
      edges.push({ id, from, to, parentTag, childTags });
    }
  }

  return { nodes, edges, tagToNode };
}

function layout(nodes: readonly DisplayNode[]): {
  positioned: Positioned[];
  width: number;
  height: number;
} {
  const generations = new Map<number, DisplayNode[]>();
  for (const node of nodes) {
    const generation = node.generation ?? -1;
    const rows = generations.get(generation);
    if (rows) rows.push(node);
    else generations.set(generation, [node]);
  }

  const columns = [...generations.keys()].sort((a, b) => a - b);
  const positioned: Positioned[] = [];
  let tallest = 1;

  for (const [column, generation] of columns.entries()) {
    const rows = generations.get(generation) ?? [];
    rows.sort(
      (a, b) =>
        (a.birthDay ?? Number.MIN_SAFE_INTEGER) - (b.birthDay ?? Number.MIN_SAFE_INTEGER) ||
        a.label.localeCompare(b.label),
    );
    tallest = Math.max(tallest, rows.length);
    for (const [row, node] of rows.entries()) {
      positioned.push({
        ...node,
        x: PAD + column * X_GAP,
        y: PAD + 42 + row * Y_GAP,
      });
    }
  }

  return {
    positioned,
    width: Math.max(720, PAD * 2 + Math.max(1, columns.length) * X_GAP),
    height: Math.max(520, PAD * 2 + 42 + tallest * Y_GAP),
  };
}

function nodeTone(node: DisplayNode, selected: boolean): string {
  if (selected) return "fill-brand-soft stroke-brand";
  if (node.kind === "sow") return "fill-surface stroke-brand/60";
  if (node.kind === "boar" || node.kind === "stud") return "fill-raised stroke-ink-faint";
  if (node.kind === "litter") return "fill-plane stroke-hairline";
  return "fill-surface stroke-hairline";
}

export function PedigreeGraph({ records }: Props) {
  const [collapseLitters, setCollapseLitters] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ x: number; y: number; viewX: number; viewY: number } | null>(null);

  const graph = useMemo(
    () => compactGraph(records, collapseLitters, expanded),
    [records, collapseLitters, expanded],
  );
  const drawing = useMemo(() => layout(graph.nodes), [graph.nodes]);
  const positions = useMemo(
    () => new Map(drawing.positioned.map((node) => [node.id, node])),
    [drawing.positioned],
  );

  const [view, setView] = useState(() => ({ x: 0, y: 0, width: 1200, height: 700 }));

  const byTag = useMemo(() => new Map(records.map((row) => [row.tag, row])), [records]);
  const childrenByTag = useMemo(() => {
    const map = new Map<string, PedigreeRecord[]>();
    for (const row of records) {
      for (const parent of [row.damTag, row.sireTag]) {
        if (!parent) continue;
        const children = map.get(parent);
        if (children) children.push(row);
        else map.set(parent, [row]);
      }
    }
    return map;
  }, [records]);

  const selectedNodeId = selectedTag ? graph.tagToNode.get(selectedTag) ?? null : null;
  const selectedNode = selectedNodeId ? positions.get(selectedNodeId) ?? null : null;
  const selectedRecord = selectedTag ? byTag.get(selectedTag) ?? null : null;

  const related = useMemo(() => {
    const tags = new Set<string>();
    if (!selectedTag) return tags;
    tags.add(selectedTag);
    const row = byTag.get(selectedTag);
    if (row?.damTag) tags.add(row.damTag);
    if (row?.sireTag) tags.add(row.sireTag);
    for (const child of childrenByTag.get(selectedTag) ?? []) tags.add(child.tag);
    return tags;
  }, [selectedTag, byTag, childrenByTag]);

  function fitAll() {
    setView({ x: 0, y: 0, width: drawing.width, height: drawing.height });
  }

  function zoom(factor: number) {
    setView((current) => {
      const width = Math.max(260, Math.min(drawing.width * 2, current.width * factor));
      const height = Math.max(180, Math.min(drawing.height * 2, current.height * factor));
      return {
        x: current.x + (current.width - width) / 2,
        y: current.y + (current.height - height) / 2,
        width,
        height,
      };
    });
  }

  function focusNode(node: Positioned) {
    const width = Math.min(900, drawing.width);
    const height = Math.min(560, drawing.height);
    setView({
      x: Math.max(0, node.x + NODE_W / 2 - width / 2),
      y: Math.max(0, node.y + NODE_H / 2 - height / 2),
      width,
      height,
    });
  }

  useEffect(() => {
    if (selectedNode) focusNode(selectedNode);
    // The node position is the dependency; including the whole drawing/view here
    // would make panning snap back to the selected animal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.id]);

  function findAnimal() {
    const needle = query.trim().toLowerCase();
    if (!needle) return;
    const row =
      records.find((item) => item.tag.toLowerCase() === needle) ??
      records.find((item) => item.tag.toLowerCase().includes(needle));
    if (!row) return;
    const key = litterKey(row);
    if (collapseLitters && key) {
      setExpanded((current) => {
        const next = new Set(current);
        next.add(key);
        return next;
      });
    }
    setSelectedTag(row.tag);
  }

  function onWheel(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const px = view.x + ((event.clientX - rect.left) / rect.width) * view.width;
    const py = view.y + ((event.clientY - rect.top) / rect.height) * view.height;
    const factor = event.deltaY > 0 ? 1.14 : 0.88;
    const width = Math.max(240, Math.min(drawing.width * 2, view.width * factor));
    const height = Math.max(170, Math.min(drawing.height * 2, view.height * factor));
    const rx = (px - view.x) / view.width;
    const ry = (py - view.y) / view.height;
    setView({
      x: px - rx * width,
      y: py - ry * height,
      width,
      height,
    });
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if ((event.target as Element).closest("[data-pedigree-node]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const start = drag.current;
    if (!start) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setView((current) => ({
      ...current,
      x: start.viewX - ((event.clientX - start.x) / rect.width) * current.width,
      y: start.viewY - ((event.clientY - start.y) / rect.height) * current.height,
    }));
  }

  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const generations = [...new Set(records.map((row) => row.generation).filter((g) => g !== null))]
    .sort((a, b) => (a ?? 0) - (b ?? 0));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface p-3">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-hairline bg-plane px-3 py-2">
          <Search size={14} className="shrink-0 text-ink-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") findAnimal();
            }}
            placeholder="Find SOW-003, PIG-00142…"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <button
            type="button"
            onClick={findAnimal}
            className="text-xs font-medium text-brand hover:underline"
          >
            Find
          </button>
        </div>

        <button
          type="button"
          onClick={() => zoom(0.8)}
          title="Zoom in"
          className="rounded-lg border border-hairline p-2 text-ink-muted hover:bg-raised"
        >
          <ZoomIn size={15} />
        </button>
        <button
          type="button"
          onClick={() => zoom(1.25)}
          title="Zoom out"
          className="rounded-lg border border-hairline p-2 text-ink-muted hover:bg-raised"
        >
          <ZoomOut size={15} />
        </button>
        <button
          type="button"
          onClick={fitAll}
          title="Fit whole simulation"
          className="rounded-lg border border-hairline p-2 text-ink-muted hover:bg-raised"
        >
          <Maximize2 size={15} />
        </button>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-hairline px-3 py-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={collapseLitters}
            onChange={(event) => setCollapseLitters(event.target.checked)}
          />
          Collapse non-breeding littermates
        </label>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="overflow-hidden rounded-xl border border-hairline bg-plane">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-surface px-4 py-2.5 text-xs text-ink-muted">
            <span>
              {records.length.toLocaleString()} animals · {graph.nodes.length.toLocaleString()} visible nodes
            </span>
            <span>
              {generations.length} generations · drag to pan · wheel to zoom
            </span>
          </div>
          <svg
            ref={svgRef}
            viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
            className="h-[68vh] min-h-[520px] w-full touch-none select-none"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {drawing.positioned.map((node) => (
              <text
                key={"generation:" + node.id}
                x={node.x}
                y={PAD - 12}
                className="fill-ink-faint text-[11px]"
              />
            ))}

            {graph.edges.map((edge) => {
              const from = positions.get(edge.from);
              const to = positions.get(edge.to);
              if (!from || !to) return null;
              const highlighted =
                related.has(edge.parentTag) &&
                edge.childTags.some((tag) => related.has(tag));
              const x1 = from.x + NODE_W;
              const y1 = from.y + NODE_H / 2;
              const x2 = to.x;
              const y2 = to.y + NODE_H / 2;
              const bend = x1 + (x2 - x1) / 2;
              return (
                <path
                  key={edge.id}
                  d={`M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  className={highlighted ? "stroke-brand" : "stroke-hairline"}
                  strokeWidth={highlighted ? 2 : 1}
                  opacity={highlighted ? 0.95 : 0.55}
                />
              );
            })}

            {drawing.positioned.map((node) => {
              const selected = node.id === selectedNodeId;
              return (
                <g
                  key={node.id}
                  data-pedigree-node
                  transform={`translate(${node.x} ${node.y})`}
                  className="cursor-pointer"
                  onClick={() => {
                    if (node.kind === "litter") {
                      const member = byTag.get(node.members[0]);
                      const key = member ? litterKey(member) : null;
                      if (key) {
                        setExpanded((current) => {
                          const next = new Set(current);
                          next.add(key);
                          return next;
                        });
                        setSelectedTag(node.members[0]);
                      }
                    } else {
                      setSelectedTag(node.members[0]);
                    }
                  }}
                >
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={9}
                    className={nodeTone(node, selected)}
                    strokeWidth={selected ? 2 : 1}
                  />
                  <text x={12} y={20} className="fill-ink text-[12px] font-semibold">
                    {node.label.length > 22 ? node.label.slice(0, 21) + "…" : node.label}
                  </text>
                  <text x={12} y={36} className="fill-ink-faint text-[10px]">
                    {node.subtitle.length > 28 ? node.subtitle.slice(0, 27) + "…" : node.subtitle}
                  </text>
                </g>
              );
            })}

            {[...new Set(drawing.positioned.map((node) => node.generation ?? -1))].map((generation) => {
              const first = drawing.positioned.find((node) => (node.generation ?? -1) === generation);
              if (!first) return null;
              return (
                <text
                  key={"heading:" + generation}
                  x={first.x}
                  y={PAD}
                  className="fill-ink-muted text-[12px] font-semibold"
                >
                  {generation < 0 ? "External sires" : "Generation " + generation}
                </text>
              );
            })}
          </svg>
        </div>

        <aside className="rounded-xl border border-hairline bg-surface p-4">
          {selectedRecord ? (
            <>
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-brand-soft p-2 text-brand">
                  <GitBranch size={17} />
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-ink">{selectedRecord.tag}</h3>
                  <p className="text-xs text-ink-faint">
                    {selectedRecord.kind} · {selectedRecord.sex}
                  </p>
                </div>
              </div>

              <dl className="mt-5 space-y-3 text-xs">
                <div>
                  <dt className="text-ink-faint">Generation</dt>
                  <dd className="mt-0.5 font-medium text-ink">
                    {selectedRecord.generation === null ? "External" : selectedRecord.generation}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Dam</dt>
                  <dd className="mt-0.5 font-medium text-ink">{selectedRecord.damTag ?? "Unknown / founding"}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Sire</dt>
                  <dd className="mt-0.5 font-medium text-ink">{selectedRecord.sireTag ?? "Unknown / founding"}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Origin</dt>
                  <dd className="mt-0.5 font-medium text-ink">{selectedRecord.origin}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Direct offspring</dt>
                  <dd className="mt-0.5 font-medium text-ink">
                    {(childrenByTag.get(selectedRecord.tag) ?? []).length.toLocaleString()}
                  </dd>
                </div>
              </dl>

              <div className="mt-5 space-y-2">
                {selectedRecord.damTag && byTag.has(selectedRecord.damTag) ? (
                  <button
                    type="button"
                    onClick={() => setSelectedTag(selectedRecord.damTag)}
                    className="w-full rounded-lg border border-hairline px-3 py-2 text-left text-xs text-ink-muted hover:bg-raised"
                  >
                    Go to dam · {selectedRecord.damTag}
                  </button>
                ) : null}
                {selectedRecord.sireTag && byTag.has(selectedRecord.sireTag) ? (
                  <button
                    type="button"
                    onClick={() => setSelectedTag(selectedRecord.sireTag)}
                    className="w-full rounded-lg border border-hairline px-3 py-2 text-left text-xs text-ink-muted hover:bg-raised"
                  >
                    Go to sire · {selectedRecord.sireTag}
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <div className="py-8 text-center">
              <Users size={22} className="mx-auto text-ink-faint" />
              <p className="mt-3 text-sm font-medium text-ink">Select an animal</p>
              <p className="mt-1 text-xs leading-5 text-ink-faint">
                Click a pig, sow, boar or litter to inspect its direct ancestry and offspring.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
