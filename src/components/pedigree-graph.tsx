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
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  Search,
  Users,
} from "lucide-react";
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
  expandable: boolean;
  expanded: boolean;
  childSummary: string | null;
};

type PedigreeNodeData = Record<string, unknown> & DisplayNode;
type PedigreeFlowNode = Node<PedigreeNodeData, "pedigree">;

type LineageEdge = {
  id: string;
  from: string;
  to: string;
  kind: "parent" | "member";
  parentTag: string | null;
  childTags: string[];
};

type PedigreeIndex = {
  byTag: Map<string, PedigreeRecord>;
  litters: Map<string, PedigreeRecord[]>;
  litterParents: Map<string, { damTag: string | null; sireTag: string | null }>;
  littersByParent: Map<string, Set<string>>;
  directChildrenByParent: Map<string, PedigreeRecord[]>;
  roots: PedigreeRecord[];
};

type VisibleGraph = {
  nodes: DisplayNode[];
  edges: LineageEdge[];
  tagToNode: Map<string, string>;
  visibleAnimalTags: Set<string>;
  visibleLitterKeys: Set<string>;
};

const NODE_W = 190;
const NODE_H = 62;
const LEFT_PAD = 220;
const LANE_GAP = 20;
const VERTICAL_STEP = 86;
const GENERATION_GAP = 54;

function litterKey(row: PedigreeRecord): string | null {
  if (row.damTag === null || row.birthDay === null) return null;
  return [row.damTag, row.sireTag ?? "unknown", row.birthDay, row.generation ?? 0].join("|");
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  const values = map.get(key);
  if (values) values.add(value);
  else map.set(key, new Set([value]));
}

function addToRowMap(
  map: Map<string, PedigreeRecord[]>,
  key: string,
  value: PedigreeRecord,
): void {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

function indexPedigree(records: readonly PedigreeRecord[]): PedigreeIndex {
  const byTag = new Map(records.map((row) => [row.tag, row]));
  const litters = new Map<string, PedigreeRecord[]>();
  const litterParents = new Map<string, { damTag: string | null; sireTag: string | null }>();
  const littersByParent = new Map<string, Set<string>>();
  const directChildrenByParent = new Map<string, PedigreeRecord[]>();

  for (const row of records) {
    const key = litterKey(row);
    if (key) {
      addToRowMap(litters, key, row);
      litterParents.set(key, { damTag: row.damTag, sireTag: row.sireTag });
      if (row.damTag) addToSetMap(littersByParent, row.damTag, key);
      if (row.sireTag) addToSetMap(littersByParent, row.sireTag, key);
      continue;
    }

    for (const parentTag of [row.damTag, row.sireTag]) {
      if (parentTag) addToRowMap(directChildrenByParent, parentTag, row);
    }
  }

  const roots = records.filter(
    (row) =>
      row.damTag === null &&
      row.sireTag === null &&
      row.kind !== "stud" &&
      (row.kind === "sow" || row.kind === "boar"),
  );

  // A malformed/imported pedigree can have no breeding root. In that case,
  // show the parentless animals rather than opening an empty canvas.
  if (roots.length === 0) {
    roots.push(
      ...records.filter(
        (row) => row.damTag === null && row.sireTag === null && row.kind !== "stud",
      ),
    );
  }

  return {
    byTag,
    litters,
    litterParents,
    littersByParent,
    directChildrenByParent,
    roots,
  };
}

function childSummary(index: PedigreeIndex, tag: string): string | null {
  const litterCount = index.littersByParent.get(tag)?.size ?? 0;
  const directCount = index.directChildrenByParent.get(tag)?.length ?? 0;
  if (litterCount === 0 && directCount === 0) return null;
  const parts: string[] = [];
  if (litterCount > 0) parts.push(litterCount + (litterCount === 1 ? " litter" : " litters"));
  if (directCount > 0) parts.push(directCount + (directCount === 1 ? " child" : " children"));
  return parts.join(" · ");
}

function animalDisplayNode(
  row: PedigreeRecord,
  index: PedigreeIndex,
  expandedAnimals: ReadonlySet<string>,
): DisplayNode {
  const summary = childSummary(index, row.tag);
  return {
    id: "animal:" + row.tag,
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
    litterKey: litterKey(row),
    expandable: summary !== null,
    expanded: expandedAnimals.has(row.tag),
    childSummary: summary,
  };
}

function litterDisplayNode(
  key: string,
  rows: readonly PedigreeRecord[],
  expandedLitters: ReadonlySet<string>,
): DisplayNode {
  const first = rows[0];
  return {
    id: "litter:" + key,
    label: "Litter · " + rows.length + (rows.length === 1 ? " pig" : " pigs"),
    subtitle: [first.damTag, first.sireTag].filter(Boolean).join(" × ") || "parentage unknown",
    generation: first.generation,
    kind: "litter",
    count: rows.length,
    members: rows.map((row) => row.tag),
    damTag: first.damTag,
    sireTag: first.sireTag,
    firstSeenDay: Math.min(...rows.map((row) => row.firstSeenDay)),
    litterKey: key,
    expandable: rows.length > 0,
    expanded: expandedLitters.has(key),
    childSummary: rows.length + (rows.length === 1 ? " pig" : " pigs"),
  };
}

/**
 * Progressive whole-run pedigree.
 *
 * Only root breeding stock is visible initially. Expanding an animal reveals
 * its litters; expanding a litter reveals its pigs. A pig that becomes a
 * breeder can then be expanded into the next generation. The complete pedigree
 * remains in memory, but React Flow only receives the part the user has opened.
 */
function visibleGraph(
  index: PedigreeIndex,
  expandedAnimals: ReadonlySet<string>,
  expandedLitters: ReadonlySet<string>,
): VisibleGraph {
  const visibleAnimalTags = new Set(index.roots.map((row) => row.tag));
  const visibleLitterKeys = new Set<string>();

  let changed = true;
  while (changed) {
    changed = false;

    for (const tag of [...visibleAnimalTags]) {
      if (!expandedAnimals.has(tag)) continue;

      for (const key of index.littersByParent.get(tag) ?? []) {
        if (!visibleLitterKeys.has(key)) {
          visibleLitterKeys.add(key);
          changed = true;
        }

        // A litter is the product of both parents. Once the litter is visible,
        // keep the co-parent visible too without opening any of its other
        // descendants.
        const parents = index.litterParents.get(key);
        for (const parentTag of [parents?.damTag, parents?.sireTag]) {
          if (parentTag && index.byTag.has(parentTag) && !visibleAnimalTags.has(parentTag)) {
            visibleAnimalTags.add(parentTag);
            changed = true;
          }
        }
      }

      for (const child of index.directChildrenByParent.get(tag) ?? []) {
        if (!visibleAnimalTags.has(child.tag)) {
          visibleAnimalTags.add(child.tag);
          changed = true;
        }
      }
    }

    for (const key of [...visibleLitterKeys]) {
      if (!expandedLitters.has(key)) continue;
      for (const member of index.litters.get(key) ?? []) {
        if (!visibleAnimalTags.has(member.tag)) {
          visibleAnimalTags.add(member.tag);
          changed = true;
        }
      }
    }
  }

  const nodes: DisplayNode[] = [];
  const tagToNode = new Map<string, string>();

  for (const tag of visibleAnimalTags) {
    const row = index.byTag.get(tag);
    if (!row) continue;
    const node = animalDisplayNode(row, index, expandedAnimals);
    nodes.push(node);
    tagToNode.set(tag, node.id);
  }

  for (const key of visibleLitterKeys) {
    const rows = index.litters.get(key);
    if (!rows?.length) continue;
    const node = litterDisplayNode(key, rows, expandedLitters);
    nodes.push(node);
    // When the litter is collapsed, its members resolve to the litter node.
    // Once expanded, the individual animal mapping below wins.
    for (const row of rows) {
      if (!tagToNode.has(row.tag)) tagToNode.set(row.tag, node.id);
    }
  }

  const edges: LineageEdge[] = [];
  const seen = new Set<string>();

  for (const key of visibleLitterKeys) {
    const litterId = "litter:" + key;
    const parents = index.litterParents.get(key);
    for (const parentTag of [parents?.damTag, parents?.sireTag]) {
      if (!parentTag) continue;
      const from = tagToNode.get(parentTag);
      if (!from) continue;
      const id = from + ">" + litterId;
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({
        id,
        from,
        to: litterId,
        kind: "parent",
        parentTag,
        childTags: index.litters.get(key)?.map((row) => row.tag) ?? [],
      });
    }

    if (expandedLitters.has(key)) {
      for (const member of index.litters.get(key) ?? []) {
        const to = "animal:" + member.tag;
        if (!visibleAnimalTags.has(member.tag)) continue;
        const id = litterId + ">" + to;
        if (seen.has(id)) continue;
        seen.add(id);
        edges.push({
          id,
          from: litterId,
          to,
          kind: "member",
          parentTag: null,
          childTags: [member.tag],
        });
      }
    }
  }

  for (const parentTag of visibleAnimalTags) {
    if (!expandedAnimals.has(parentTag)) continue;
    const from = "animal:" + parentTag;
    for (const child of index.directChildrenByParent.get(parentTag) ?? []) {
      if (!visibleAnimalTags.has(child.tag)) continue;
      const to = "animal:" + child.tag;
      const id = from + ">" + to;
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({
        id,
        from,
        to,
        kind: "parent",
        parentTag,
        childTags: [child.tag],
      });
    }
  }

  return {
    nodes,
    edges,
    tagToNode,
    visibleAnimalTags,
    visibleLitterKeys,
  };
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
 * left. Expanded litter members share their litter's date and therefore stack
 * vertically rather than pretending time elapsed between them.
 */
function flowNodes(
  nodes: readonly DisplayNode[],
  horizonDay: number,
  selectedTag: string | null,
  selectedLitterKey: string | null,
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
    rows.sort((a, b) => {
      const time = a.firstSeenDay - b.firstSeenDay;
      if (time !== 0) return time;
      const aLitter = a.kind === "litter" ? 0 : 1;
      const bLitter = b.kind === "litter" ? 0 : 1;
      if (aLitter !== bLitter) return aLitter - bLitter;
      return (a.litterKey ?? a.id).localeCompare(b.litterKey ?? b.id) || a.label.localeCompare(b.label);
    });

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
        selected:
          node.kind === "litter"
            ? node.litterKey === selectedLitterKey
            : selectedTag !== null && node.members.includes(selectedTag),
        data: node,
      });
    }

    y += Math.max(1, laneEnds.length) * VERTICAL_STEP + GENERATION_GAP;
  }

  return result;
}

function PedigreeNode({ data, selected }: NodeProps<PedigreeFlowNode>) {
  const generation = data.generation === null ? "External" : "Gen " + data.generation;
  const memberEdge = data.kind === "litter";

  return (
    <div
      className={[
        "w-[190px] rounded-xl border bg-surface px-3 py-2.5 shadow-sm transition",
        selected ? "border-brand ring-2 ring-brand/20" : "border-hairline",
        memberEdge ? "border-dashed" : "",
      ].join(" ")}
    >
      <Handle
        id="ancestry"
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-0 !bg-ink-faint"
      />
      {data.kind !== "litter" ? (
        <Handle
          id="litter-member"
          type="target"
          position={Position.Top}
          className="!h-2 !w-2 !border-0 !bg-ink-faint"
        />
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold text-ink">{data.label}</span>
        <span className="shrink-0 text-[10px] text-ink-faint">{generation}</span>
      </div>
      <div className="mt-1 truncate text-[10px] text-ink-muted">{data.subtitle}</div>

      {data.expandable ? (
        <div className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-brand">
          {data.expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span>{data.expanded ? "Hide " : "Show "}{data.childSummary}</span>
        </div>
      ) : null}

      <Handle
        id="descendants"
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-0 !bg-ink-faint"
      />
      {data.kind === "litter" ? (
        <Handle
          id="members"
          type="source"
          position={Position.Bottom}
          className="!h-2 !w-2 !border-0 !bg-ink-faint"
        />
      ) : null}
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

function descendantKeys(
  index: PedigreeIndex,
  animalTags: readonly string[],
): { animals: Set<string>; litters: Set<string> } {
  const animals = new Set<string>();
  const litters = new Set<string>();
  const queue = [...animalTags];

  while (queue.length > 0) {
    const tag = queue.shift()!;
    if (animals.has(tag)) continue;
    animals.add(tag);

    for (const key of index.littersByParent.get(tag) ?? []) {
      if (litters.has(key)) continue;
      litters.add(key);
      for (const child of index.litters.get(key) ?? []) queue.push(child.tag);
    }

    for (const child of index.directChildrenByParent.get(tag) ?? []) queue.push(child.tag);
  }

  return { animals, litters };
}

export function PedigreeGraph({ records, startDate, horizonDay }: Props) {
  const index = useMemo(() => indexPedigree(records), [records]);
  const [expandedAnimals, setExpandedAnimals] = useState<Set<string>>(() => new Set());
  const [expandedLitters, setExpandedLitters] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedLitterKey, setSelectedLitterKey] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const flow = useRef<ReactFlowInstance<PedigreeFlowNode, Edge> | null>(null);

  const graph = useMemo(
    () => visibleGraph(index, expandedAnimals, expandedLitters),
    [index, expandedAnimals, expandedLitters],
  );
  const nodes = useMemo(
    () => flowNodes(graph.nodes, horizonDay, selectedTag, selectedLitterKey),
    [graph.nodes, horizonDay, selectedTag, selectedLitterKey],
  );

  const childrenByTag = useMemo(() => {
    const map = new Map<string, PedigreeRecord[]>();
    for (const row of records) {
      for (const parent of [row.damTag, row.sireTag]) {
        if (!parent) continue;
        addToRowMap(map, parent, row);
      }
    }
    return map;
  }, [records]);

  const selectedNodeId =
    selectedLitterKey !== null
      ? "litter:" + selectedLitterKey
      : selectedTag
        ? graph.tagToNode.get(selectedTag) ?? null
        : null;
  const selectedRecord = selectedTag ? index.byTag.get(selectedTag) ?? null : null;
  const selectedLitter = selectedLitterKey ? index.litters.get(selectedLitterKey) ?? null : null;

  const related = useMemo(() => {
    const tags = new Set<string>();
    if (selectedTag) {
      tags.add(selectedTag);
      const row = index.byTag.get(selectedTag);
      if (row?.damTag) tags.add(row.damTag);
      if (row?.sireTag) tags.add(row.sireTag);
      for (const child of childrenByTag.get(selectedTag) ?? []) tags.add(child.tag);
    }
    if (selectedLitter) {
      for (const member of selectedLitter) tags.add(member.tag);
      if (selectedLitter[0]?.damTag) tags.add(selectedLitter[0].damTag);
      if (selectedLitter[0]?.sireTag) tags.add(selectedLitter[0].sireTag);
    }
    return tags;
  }, [selectedTag, selectedLitter, index.byTag, childrenByTag]);

  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => {
        const highlighted =
          edge.kind === "member"
            ? edge.childTags.some((tag) => related.has(tag))
            : edge.parentTag !== null &&
              related.has(edge.parentTag) &&
              edge.childTags.some((tag) => related.has(tag));

        return {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          sourceHandle: edge.kind === "member" ? "members" : "descendants",
          targetHandle: edge.kind === "member" ? "litter-member" : "ancestry",
          type: edge.kind === "member" ? "smoothstep" : "smoothstep",
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

  function collapseAnimal(tag: string): void {
    const descendants = descendantKeys(index, [tag]);
    setExpandedAnimals((current) => {
      const next = new Set(current);
      for (const descendant of descendants.animals) next.delete(descendant);
      return next;
    });
    setExpandedLitters((current) => {
      const next = new Set(current);
      for (const key of descendants.litters) next.delete(key);
      return next;
    });
  }

  function collapseLitter(key: string): void {
    const members = index.litters.get(key) ?? [];
    const descendants = descendantKeys(index, members.map((row) => row.tag));
    setExpandedLitters((current) => {
      const next = new Set(current);
      next.delete(key);
      for (const nested of descendants.litters) next.delete(nested);
      return next;
    });
    setExpandedAnimals((current) => {
      const next = new Set(current);
      for (const tag of descendants.animals) next.delete(tag);
      return next;
    });
  }

  function toggleAnimal(tag: string): void {
    if (expandedAnimals.has(tag)) {
      collapseAnimal(tag);
      return;
    }
    if (childSummary(index, tag) === null) return;
    setExpandedAnimals((current) => new Set(current).add(tag));
  }

  function toggleLitter(key: string): void {
    if (expandedLitters.has(key)) {
      collapseLitter(key);
      return;
    }
    setExpandedLitters((current) => new Set(current).add(key));
  }

  function revealAnimal(tag: string): void {
    const animals = new Set(expandedAnimals);
    const litters = new Set(expandedLitters);
    const visited = new Set<string>();

    function revealPath(currentTag: string): void {
      if (visited.has(currentTag)) return;
      visited.add(currentTag);
      const row = index.byTag.get(currentTag);
      if (!row) return;

      const key = litterKey(row);
      if (key) litters.add(key);

      for (const parentTag of [row.damTag, row.sireTag]) {
        if (!parentTag) continue;
        animals.add(parentTag);
        revealPath(parentTag);
      }
    }

    revealPath(tag);
    setExpandedAnimals(animals);
    setExpandedLitters(litters);
    setSelectedLitterKey(null);
    setSelectedTag(tag);
  }

  function findAnimal(): void {
    const needle = query.trim().toLowerCase();
    if (!needle) return;
    const row =
      records.find((item) => item.tag.toLowerCase() === needle) ??
      records.find((item) => item.tag.toLowerCase().includes(needle));
    if (row) revealAnimal(row.tag);
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
        <button
          type="button"
          onClick={() => {
            setExpandedAnimals(new Set());
            setExpandedLitters(new Set());
            setSelectedTag(null);
            setSelectedLitterKey(null);
            requestAnimationFrame(() => {
              void flow.current?.fitView({ padding: 0.16, duration: 300 });
            });
          }}
          className="rounded-lg border border-hairline px-3 py-2 text-xs font-medium text-ink-muted transition hover:bg-raised hover:text-ink"
        >
          Collapse all
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_290px]">
        <div className="relative min-h-[620px] overflow-hidden rounded-xl border border-hairline bg-plane">
          <TimelineOverlay startDate={startDate} horizonDay={horizonDay} viewport={viewport} />
          <div className="absolute left-3 top-[62px] z-20 rounded-lg border border-hairline bg-surface/90 px-2.5 py-1.5 text-[10px] text-ink-muted shadow-sm backdrop-blur">
            Horizontal distance = elapsed simulation time · click a node to expand
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
                setSelectedTag(null);
                setSelectedLitterKey(data.litterKey);
                toggleLitter(data.litterKey);
                return;
              }

              const tag = data.members[0] ?? null;
              setSelectedLitterKey(null);
              setSelectedTag(tag);
              if (tag) toggleAnimal(tag);
            }}
            nodesDraggable={false}
            nodesConnectable={false}
            fitView
            fitViewOptions={{ padding: 0.16, minZoom: 0.18, maxZoom: 1.1 }}
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
            {records.length.toLocaleString()} animals in simulation · {graph.nodes.length.toLocaleString()} nodes currently rendered · {generations} generations
          </div>
        </div>

        <aside className="rounded-xl border border-hairline bg-surface p-4">
          {selectedLitter ? (
            <>
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-brand-soft p-2 text-brand">
                  <GitBranch size={17} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-ink">
                    Litter · {selectedLitter.length} pigs
                  </h3>
                  <p className="text-xs text-ink-faint">
                    {selectedLitter[0]?.damTag ?? "Unknown dam"} × {selectedLitter[0]?.sireTag ?? "Unknown sire"}
                  </p>
                </div>
              </div>

              <dl className="mt-5 space-y-3 text-xs">
                <div>
                  <dt className="text-ink-faint">Born / entered</dt>
                  <dd className="mt-0.5 font-medium text-ink">
                    {format(addDays(start, Math.min(...selectedLitter.map((row) => row.firstSeenDay))), "dd MMM yyyy")}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Members</dt>
                  <dd className="mt-0.5 font-medium text-ink">{selectedLitter.length}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Breeders retained</dt>
                  <dd className="mt-0.5 font-medium text-ink">
                    {selectedLitter.filter((row) => row.kind === "sow" || row.kind === "boar").length}
                  </dd>
                </div>
              </dl>

              <button
                type="button"
                onClick={() => toggleLitter(selectedLitterKey!)}
                className="mt-5 w-full rounded-lg border border-hairline px-3 py-2 text-left text-xs font-medium text-ink-muted hover:bg-raised"
              >
                {expandedLitters.has(selectedLitterKey!) ? "Collapse litter" : "Show individual pigs"}
              </button>
            </>
          ) : selectedRecord ? (
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
                {childSummary(index, selectedRecord.tag) ? (
                  <button
                    type="button"
                    onClick={() => toggleAnimal(selectedRecord.tag)}
                    className="w-full rounded-lg border border-hairline px-3 py-2 text-left text-xs font-medium text-ink-muted hover:bg-raised"
                  >
                    {expandedAnimals.has(selectedRecord.tag)
                      ? "Collapse descendants"
                      : "Show " + childSummary(index, selectedRecord.tag)}
                  </button>
                ) : null}

                {selectedRecord.damTag && index.byTag.has(selectedRecord.damTag) ? (
                  <button
                    type="button"
                    onClick={() => revealAnimal(selectedRecord.damTag!)}
                    className="w-full rounded-lg border border-hairline px-3 py-2 text-left text-xs text-ink-muted hover:bg-raised"
                  >
                    Go to dam · {selectedRecord.damTag}
                  </button>
                ) : null}
                {selectedRecord.sireTag && index.byTag.has(selectedRecord.sireTag) ? (
                  <button
                    type="button"
                    onClick={() => revealAnimal(selectedRecord.sireTag!)}
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
              <p className="mt-3 text-sm font-medium text-ink">Open the pedigree progressively</p>
              <p className="mt-1 text-xs leading-5 text-ink-faint">
                Start with the founding breeders. Click one to show its litters, then a litter to show its pigs, and a retained breeder to continue into the next generation.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
