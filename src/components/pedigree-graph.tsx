"use client";

import { addDays, format, parseISO } from "date-fns";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import { GitBranch, Search, Users } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { PedigreeRecord } from "@/lib/pedigree";

type Props = {
  records: readonly PedigreeRecord[];
  startDate: string;
  horizonDay: number;
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
  firstSeenDay: number;
  litterKey: string | null;
};

type PedigreeNodeData = Record<string, unknown> & DisplayNode;
type PedigreeFlowNode = Node<PedigreeNodeData, "pedigree">;

type LineageEdge = {
  id: string;
  from: string;
  to: string;
  parentTag: string;
  childTags: string[];
};

const NODE_W = 190;
const NODE_H = 58;
const LEFT_PAD = 220;
const LANE_GAP = 20;
const VERTICAL_STEP = 82;
const GENERATION_GAP = 52;

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
  edges: LineageEdge[];
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
      firstSeenDay: row.firstSeenDay,
      litterKey: key,
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
      firstSeenDay: Math.min(...rows.map((row) => row.firstSeenDay)),
      litterKey: key,
    });
    for (const row of rows) tagToNode.set(row.tag, id);
  }

  const seen = new Set<string>();
  const edges: LineageEdge[] = [];
  for (const row of records) {
    const to = tagToNode.get(row.tag);
    if (!to) continue;
    for (const parentTag of [row.damTag, row.sireTag]) {
      if (!parentTag) continue;
      const from = tagToNode.get(parentTag);
      if (!from || from === to) continue;
      const id = from + ">" + to;
      if (seen.has(id)) continue;
      seen.add(id);
      const childTags = nodes.find((node) => node.id === to)?.members ?? [row.tag];
      edges.push({ id, from, to, parentTag, childTags });
    }
  }

  return { nodes, edges, tagToNode };
}

function pixelsPerDay(horizonDay: number): number {
  if (horizonDay <= 365) return 3.2;
  if (horizonDay <= 3 * 365) return 2.3;
  if (horizonDay <= 6 * 365) return 1.75;
  return 1.35;
}

function timeX(day: number, scale: number, horizonDay: number): number {
  return LEFT_PAD + Math.min(Math.max(day, 0), horizonDay) * scale;
}

/**
 * X is chronology and may never be changed by dragging. Y is only packing:
 * nodes in one generation reuse a lane once the previous node is far enough
 * left, keeping a five-year simulation much shorter than "one litter per row".
 */
function flowNodes(
  nodes: readonly DisplayNode[],
  horizonDay: number,
  selectedTag: string | null,
): PedigreeFlowNode[] {
  const scale = pixelsPerDay(horizonDay);
  const groups = new Map<number, DisplayNode[]>();
  for (const node of nodes) {
    const generation = node.generation ?? -1;
    const rows = groups.get(generation);
    if (rows) rows.push(node);
    else groups.set(generation, [node]);
  }

  let y = 88;
  const result: PedigreeFlowNode[] = [];
  for (const generation of [...groups.keys()].sort((a, b) => a - b)) {
    const rows = groups.get(generation) ?? [];
    rows.sort(
      (a, b) =>
        a.firstSeenDay - b.firstSeenDay ||
        a.label.localeCompare(b.label),
    );

    const laneEnds: number[] = [];
    for (const node of rows) {
      const x = timeX(node.firstSeenDay, scale, horizonDay);
      let lane = laneEnds.findIndex((end) => x >= end + LANE_GAP);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(x + NODE_W);
      } else {
        laneEnds[lane] = x + NODE_W;
      }

      result.push({
        id: node.id,
        type: "pedigree",
        position: { x, y: y + lane * VERTICAL_STEP },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        draggable: false,
        selectable: true,
        selected: selectedTag !== null && node.members.includes(selectedTag),
        data: node,
      });
    }

    y += Math.max(1, laneEnds.length) * VERTICAL_STEP + GENERATION_GAP;
  }

  return result;
}

function PedigreeNode({ data, selected }: NodeProps<PedigreeFlowNode>) {
  const generation = data.generation === null ? "External" : "Gen " + data.generation;
  return (
    <div
      className={[
        "w-[190px] rounded-xl border bg-surface px-3 py-2.5 shadow-sm transition",
        selected ? "border-brand ring-2 ring-brand/20" : "border-hairline",
        data.kind === "litter" ? "border-dashed" : "",
      ].join(" ")}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-0 !bg-ink-faint"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold text-ink">{data.label}</span>
        <span className="shrink-0 text-[10px] text-ink-faint">{generation}</span>
      </div>
      <div className="mt-1 truncate text-[10px] text-ink-muted">{data.subtitle}</div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-0 !bg-ink-faint"
      />
    </div>
  );
}

const NODE_TYPES = { pedigree: PedigreeNode };

function TimelineOverlay({
  startDate,
  horizonDay,
  viewport,
}: {
  startDate: string;
  horizonDay: number;
  viewport: Viewport;
}) {
  const start = parseISO(startDate);
  const scale = pixelsPerDay(horizonDay);
  const step =
    horizonDay <= 365 ? 30 :
      horizonDay <= 3 * 365 ? 90 :
        182;
  const ticks: number[] = [];
  for (let day = 0; day <= horizonDay; day += step) ticks.push(day);
  if (ticks.at(-1) !== horizonDay) ticks.push(horizonDay);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-14 border-b border-hairline bg-surface/90 backdrop-blur-sm">
        {ticks.map((day) => {
          const left = timeX(day, scale, horizonDay) * viewport.zoom + viewport.x;
          return (
            <div
              key={day}
              className="absolute top-0 h-full border-l border-rule/60"
              style={{ transform: `translateX(${left}px)` }}
            >
              <div className="pl-2 pt-2 text-[10px] font-medium text-ink-muted">
                {format(addDays(start, day), "MMM yyyy")}
              </div>
              <div className="pl-2 pt-0.5 text-[9px] text-ink-faint">
                {day === 0 ? "Start" : "+" + Math.round(day / 30.4375) + " mo"}
              </div>
            </div>
          );
        })}
      </div>
      {ticks.map((day) => {
        const left = timeX(day, scale, horizonDay) * viewport.zoom + viewport.x;
        return (
          <div
            key={"grid:" + day}
            className="absolute bottom-0 top-14 border-l border-hairline/55"
            style={{ transform: `translateX(${left}px)` }}
          />
        );
      })}
    </div>
  );
}

export function PedigreeGraph({ records, startDate, horizonDay }: Props) {
  const [collapseLitters, setCollapseLitters] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const flow = useRef<ReactFlowInstance<PedigreeFlowNode, Edge> | null>(null);

  const graph = useMemo(
    () => compactGraph(records, collapseLitters, expanded),
    [records, collapseLitters, expanded],
  );
  const nodes = useMemo(
    () => flowNodes(graph.nodes, horizonDay, selectedTag),
    [graph.nodes, horizonDay, selectedTag],
  );

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

  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => {
        const highlighted =
          related.has(edge.parentTag) &&
          edge.childTags.some((tag) => related.has(tag));
        return {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          type: "smoothstep",
          animated: highlighted,
          style: {
            stroke: highlighted ? "var(--color-brand)" : "var(--color-rule)",
            strokeWidth: highlighted ? 2 : 1,
            opacity: highlighted ? 0.95 : 0.62,
          },
        };
      }),
    [graph.edges, related],
  );

  useEffect(() => {
    if (!selectedNodeId || !flow.current) return;
    const node = flow.current.getNode(selectedNodeId);
    if (!node) return;
    void flow.current.setCenter(
      node.position.x + NODE_W / 2,
      node.position.y + NODE_H / 2,
      { zoom: 1.15, duration: 350 },
    );
  }, [selectedNodeId, nodes]);

  function findAnimal() {
    const needle = query.trim().toLowerCase();
    if (!needle) return;
    const row =
      records.find((item) => item.tag.toLowerCase() === needle) ??
      records.find((item) => item.tag.toLowerCase().includes(needle));
    if (!row) return;
    const key = litterKey(row);
    if (collapseLitters && key) {
      setExpanded((current) => new Set(current).add(key));
    }
    setSelectedTag(row.tag);
  }

  const start = parseISO(startDate);
  const generations = new Set(
    records.map((row) => row.generation).filter((generation) => generation !== null),
  ).size;

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
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-hairline px-3 py-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={collapseLitters}
            onChange={(event) => setCollapseLitters(event.target.checked)}
          />
          Collapse non-breeding littermates
        </label>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_290px]">
        <div className="relative min-h-[620px] overflow-hidden rounded-xl border border-hairline bg-plane">
          <TimelineOverlay startDate={startDate} horizonDay={horizonDay} viewport={viewport} />
          <div className="absolute left-3 top-[62px] z-20 rounded-lg border border-hairline bg-surface/90 px-2.5 py-1.5 text-[10px] text-ink-muted shadow-sm backdrop-blur">
            Horizontal distance = elapsed simulation time
          </div>
          <ReactFlow<PedigreeFlowNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onInit={(instance) => {
              flow.current = instance;
            }}
            onMove={(_, next) => setViewport(next)}
            onNodeClick={(_, node) => {
              const data = node.data;
              if (data.kind === "litter" && data.litterKey) {
                setExpanded((current) => new Set(current).add(data.litterKey!));
              }
              setSelectedTag(data.members[0] ?? null);
            }}
            nodesDraggable={false}
            nodesConnectable={false}
            fitView
            fitViewOptions={{ padding: 0.12, minZoom: 0.12, maxZoom: 1.1 }}
            minZoom={0.08}
            maxZoom={2.2}
            className="h-[72vh] min-h-[620px]"
          >
            <Background gap={28} size={1} color="var(--color-hairline)" />
            <MiniMap
              pannable
              zoomable
              nodeColor={() => "var(--color-brand-soft)"}
              maskColor="color-mix(in srgb, var(--color-plane) 78%, transparent)"
            />
            <Controls />
          </ReactFlow>
          <div className="pointer-events-none absolute bottom-3 left-3 z-20 rounded-lg border border-hairline bg-surface/90 px-3 py-2 text-[10px] text-ink-muted shadow-sm backdrop-blur">
            {records.length.toLocaleString()} animals · {graph.nodes.length.toLocaleString()} visible nodes · {generations} generations
          </div>
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
                  <dt className="text-ink-faint">Entered this simulation</dt>
                  <dd className="mt-0.5 font-medium text-ink">
                    {format(addDays(start, selectedRecord.firstSeenDay), "dd MMM yyyy")}
                    {" · "}
                    {selectedRecord.firstSeenDay === 0
                      ? "at start"
                      : Math.round(selectedRecord.firstSeenDay / 30.4375) + " months in"}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Generation</dt>
                  <dd className="mt-0.5 font-medium text-ink">
                    {selectedRecord.generation === null ? "External" : selectedRecord.generation}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Dam</dt>
                  <dd className="mt-0.5 font-medium text-ink">
                    {selectedRecord.damTag ?? "Unknown / founding"}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Sire</dt>
                  <dd className="mt-0.5 font-medium text-ink">
                    {selectedRecord.sireTag ?? "Unknown / founding"}
                  </dd>
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
                Click a pig, sow, boar or litter. The horizontal ruler shows when it entered the simulated farm.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
