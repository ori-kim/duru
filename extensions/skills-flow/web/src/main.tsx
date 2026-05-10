import { Collapsible } from "@base-ui/react/collapsible";
import {
  Background,
  Controls,
  Handle,
  type NodeProps,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import {
  ArrowDown,
  ArrowRight,
  ChevronRight,
  CircleDot,
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Panel } from "./components/ui/panel";
import { cn } from "./lib/utils";
import "@xyflow/react/dist/style.css";
import "./style.css";

type FlowNode = {
  id: string;
  type: string;
  name: string;
  link: string;
};

type FlowEdge = {
  id: string;
  from: string;
  to: string;
  type: string;
  name: string;
};

type FlowJson = {
  schemaVersion?: string;
  name?: string;
  entryNode?: string;
  nodes?: FlowNode[];
  edges?: FlowEdge[];
};

type ValidationIssue = {
  code: string;
  message: string;
  path?: string;
};

type SkillPackage = {
  id: string;
  name: string;
  dir: string;
  description: string;
  status: "valid" | "warning" | "invalid";
  valid: boolean;
  nodes: number;
  edges: number;
};

type WebPayload = {
  name: string;
  dir: string;
  rootDir: string;
  selectedId: string | null;
  packages: SkillPackage[];
  description: string;
  validation: {
    valid: boolean;
    status: "valid" | "warning" | "invalid";
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
  };
  flow: FlowJson | null;
  flowUi: FlowUiJson;
};

type Focus = { kind: "node"; id: string } | { kind: "edge"; id: string } | null;
type LayoutDirection = "horizontal" | "vertical";
type CanvasPosition = { x: number; y: number };
type FlowUiJson = {
  schemaVersion: "1";
  nodePositions: Record<string, Partial<Record<LayoutDirection, CanvasPosition>>>;
};

const palette = ["#2563eb", "#f97316", "#14b8a6", "#7c3aed", "#64748b", "#dc2626", "#0891b2"];
const colorByType = new Map<string, string>();
const emptyFlowUi: FlowUiJson = { schemaVersion: "1", nodePositions: {} };
const POSITION_SAVE_DELAY_MS = 300;

function colorFor(type = "step"): string {
  if (!colorByType.has(type)) colorByType.set(type, palette[colorByType.size % palette.length] ?? "#64748b");
  return colorByType.get(type) ?? "#64748b";
}

function initials(type = "ST"): string {
  return (
    type
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "ST"
  );
}

function statusVariant(status: SkillPackage["status"]) {
  if (status === "invalid") return "invalid";
  if (status === "warning") return "warning";
  return "valid";
}

function roundPosition(position: CanvasPosition): CanvasPosition {
  return {
    x: Math.round(position.x),
    y: Math.round(position.y),
  };
}

function draftKey(direction: LayoutDirection, id: string): string {
  return `${direction}:${id}`;
}
function positionFromFlowUi(
  flowUi: FlowUiJson | undefined,
  nodeId: string,
  direction: LayoutDirection,
  fallback: CanvasPosition,
): CanvasPosition {
  return flowUi?.nodePositions?.[nodeId]?.[direction] ?? fallback;
}

function withFlowUiPosition(
  payload: WebPayload | null,
  nodeId: string,
  direction: LayoutDirection,
  position: CanvasPosition,
): WebPayload | null {
  return withFlowUiPositions(payload, direction, { [nodeId]: position });
}

function withFlowUiPositions(
  payload: WebPayload | null,
  direction: LayoutDirection,
  positions: Record<string, CanvasPosition>,
): WebPayload | null {
  if (!payload) return payload;
  const currentFlowUi = payload.flowUi ?? emptyFlowUi;
  const nodePositions = { ...currentFlowUi.nodePositions };
  for (const [nodeId, position] of Object.entries(positions)) {
    const currentNode = nodePositions[nodeId] ?? {};
    nodePositions[nodeId] = {
      ...currentNode,
      [direction]: position,
    };
  }
  return {
    ...payload,
    flowUi: {
      schemaVersion: "1",
      nodePositions,
    },
  };
}

function flowUiPatchFromPositions(direction: LayoutDirection, positions: Record<string, CanvasPosition>) {
  return {
    nodePositions: Object.fromEntries(
      Object.entries(positions).map(([nodeId, position]) => [nodeId, { [direction]: position }]),
    ),
  };
}

function autoLayoutPositions(flow: FlowJson | null, direction: LayoutDirection): Record<string, CanvasPosition> {
  return Object.fromEntries(
    layout(flow, direction, undefined).nodes.map((node) => [node.id, roundPosition(node.position)]),
  );
}

function layout(flow: FlowJson | null, direction: LayoutDirection, flowUi: FlowUiJson | undefined) {
  const rawNodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  const rawEdges = Array.isArray(flow?.edges) ? flow.edges : [];
  const ids = new Set(rawNodes.map((node) => node.id));
  const incoming = new Map(rawNodes.map((node) => [node.id, 0]));
  const outgoing = new Map(rawNodes.map((node) => [node.id, [] as string[]]));

  for (const edge of rawEdges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const seeds =
    flow?.entryNode && ids.has(flow.entryNode)
      ? [flow.entryNode]
      : rawNodes.filter((node) => (incoming.get(node.id) || 0) === 0).map((node) => node.id);
  const queue = [...seeds];
  const level = new Map(queue.map((id) => [id, 0]));

  while (queue.length) {
    const id = queue.shift();
    if (!id) continue;
    const base = level.get(id) || 0;
    for (const next of outgoing.get(id) || []) {
      if (!level.has(next)) {
        level.set(next, base + 1);
        queue.push(next);
      }
    }
  }

  for (const node of rawNodes) {
    if (!level.has(node.id)) level.set(node.id, 0);
  }

  const buckets = new Map<number, string[]>();
  for (const node of rawNodes) {
    const l = level.get(node.id) || 0;
    if (!buckets.has(l)) buckets.set(l, []);
    buckets.get(l)?.push(node.id);
  }

  const nodes = rawNodes.map((node) => {
    const l = level.get(node.id) || 0;
    const bucket = buckets.get(l) || [];
    const index = bucket.indexOf(node.id);
    const offset = (index - (bucket.length - 1) / 2) * 112;
    const autoPosition =
      direction === "vertical" ? { x: 420 + offset, y: 120 + l * 165 } : { x: 80 + l * 280, y: 280 + offset };
    return {
      id: node.id,
      type: "skillNode",
      position: positionFromFlowUi(flowUi, node.id, direction, autoPosition),
      data: { node, direction },
    };
  });

  const edges = rawEdges
    .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
    .map((edge) => {
      const isRetry = edge.type.includes("retry") || edge.type.includes("loop");
      return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: edge.name,
        type: "smoothstep",
        animated: isRetry,
        data: edge,
        interactionWidth: 18,
        style: {
          stroke: isRetry ? "#f97316" : "#aab2c1",
          strokeWidth: 2,
          strokeDasharray: isRetry ? "6 4" : undefined,
        },
      };
    });

  return { nodes, edges };
}

function SkillNode({ data, selected }: NodeProps) {
  const { node, direction } = data as { node: FlowNode; direction: LayoutDirection };
  const color = colorFor(node.type);
  const isVertical = direction === "vertical";
  return (
    <div
      className={cn(
        "relative min-w-[190px] rounded-md border border-zinc-200 bg-white px-3 py-2.5 pl-11 shadow-sm transition",
        selected && "border-zinc-900 shadow-md",
      )}
    >
      <Handle
        className="!size-2 !border-2 !border-white !bg-slate-400"
        type="target"
        position={isVertical ? Position.Top : Position.Left}
      />
      <div
        className="absolute left-3 top-2.5 grid size-6 place-items-center rounded-md text-[10px] font-black text-white"
        style={{ backgroundColor: color }}
      >
        {initials(node.type)}
      </div>
      <div className="max-w-[190px] truncate text-[13px] font-black leading-tight text-zinc-900">
        {node.name || node.id}
      </div>
      <div className="mt-1 max-w-[190px] truncate text-[11px] font-bold text-slate-500">{node.type || "step"}</div>
      <Handle
        className="!size-2 !border-2 !border-white !bg-slate-400"
        type="source"
        position={isVertical ? Position.Bottom : Position.Right}
      />
    </div>
  );
}

function Sidebar({
  payload,
  query,
  focus,
  filteredNodes,
  collapsed,
  onQuery,
  onSelectPackage,
  onToggleNode,
  onToggleCollapse,
}: {
  payload: WebPayload;
  query: string;
  focus: Focus;
  filteredNodes: FlowNode[];
  collapsed: boolean;
  onQuery: (value: string) => void;
  onSelectPackage: (id: string) => void;
  onToggleNode: (id: string) => void;
  onToggleCollapse: () => void;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const packages = payload.packages.filter((item) => {
    if (!normalizedQuery) return true;
    if (item.id === payload.selectedId) return true;
    return [item.name, item.id, item.description].join(" ").toLowerCase().includes(normalizedQuery);
  });

  return (
    <aside
      className={cn("relative z-20 shrink-0 transition-[width] duration-200", collapsed ? "w-[56px]" : "w-[330px]")}
    >
      <Panel className="h-full overflow-hidden p-4">
        <div className={cn("flex h-full flex-col", collapsed && "items-center")}>
          <Button
            className={cn("mb-3", collapsed ? "self-center" : "self-end")}
            variant="ghost"
            size="icon"
            onClick={onToggleCollapse}
            aria-label="Toggle skills sidebar"
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
          {collapsed ? (
            <div className="grid size-9 place-items-center rounded-md border border-zinc-200 bg-zinc-50 text-xs font-black text-zinc-700">
              SF
            </div>
          ) : (
            <>
              <div className="px-2 pb-5">
                <div className="text-xs font-bold text-zinc-500">Agent Flow</div>
                <h1 className="mt-1 text-3xl font-black leading-none tracking-normal text-zinc-950">Skills</h1>
              </div>
              <div className="relative mb-4 px-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  className="pl-9"
                  value={query}
                  placeholder="Search skills or nodes"
                  onChange={(event) => onQuery(event.target.value)}
                />
              </div>
              <nav className="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
                {packages.length ? (
                  packages.map((item) => {
                    const active = item.id === payload.selectedId;
                    return (
                      <Collapsible.Root key={item.id} open={active}>
                        <Collapsible.Trigger
                          className={cn(
                            "grid w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-3 py-2.5 text-left transition-colors",
                            active ? "bg-zinc-100 text-zinc-950" : "text-zinc-800 hover:bg-zinc-50",
                          )}
                          onClick={() => onSelectPackage(item.id)}
                        >
                          <ChevronRight className={cn("size-4 text-slate-500 transition", active && "rotate-90")} />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-black">{item.name}</span>
                            <span className="mt-0.5 block truncate text-xs font-bold text-slate-500">
                              {item.description || item.id}
                            </span>
                          </span>
                          <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                        </Collapsible.Trigger>
                        <Collapsible.Panel className="ml-5 mt-2 border-l border-zinc-200 pl-3">
                          <div className="mb-2 flex items-center gap-3 text-[11px] font-bold text-zinc-500">
                            <span
                              className="inline-flex items-center gap-1.5"
                              title="Nodes"
                              aria-label={`${item.nodes} nodes`}
                            >
                              <CircleDot className="size-3.5" />
                              {item.nodes}
                            </span>
                            <span
                              className="inline-flex items-center gap-1.5"
                              title="Edges"
                              aria-label={`${item.edges} edges`}
                            >
                              <GitBranch className="size-3.5" />
                              {item.edges}
                            </span>
                          </div>
                          <div className="space-y-1">
                            {filteredNodes.length ? (
                              filteredNodes.map((node) => (
                                <Button
                                  key={node.id}
                                  className={cn(
                                    "h-auto w-full justify-start rounded-md px-2.5 py-2 text-left",
                                    focus?.kind === "node" && focus.id === node.id && "bg-zinc-100 text-zinc-950",
                                  )}
                                  variant={focus?.kind === "node" && focus.id === node.id ? "active" : "ghost"}
                                  onClick={() => onToggleNode(node.id)}
                                >
                                  <span
                                    className="h-8 w-1 shrink-0 rounded-full"
                                    style={{ backgroundColor: colorFor(node.type) }}
                                  />
                                  <span className="min-w-0">
                                    <span className="block truncate text-[13px] font-black">
                                      {node.name || node.id}
                                    </span>
                                    <span className="mt-0.5 block truncate text-[11px] font-bold text-slate-500">
                                      {node.type || "step"}
                                    </span>
                                  </span>
                                </Button>
                              ))
                            ) : (
                              <div className="px-2 py-3 text-sm font-bold text-slate-500">No nodes</div>
                            )}
                          </div>
                        </Collapsible.Panel>
                      </Collapsible.Root>
                    );
                  })
                ) : (
                  <div className="px-3 py-4 text-sm font-bold text-slate-500">No skills-flow packages</div>
                )}
              </nav>
            </>
          )}
        </div>
      </Panel>
    </aside>
  );
}

function Details({
  selectedNode,
  selectedEdge,
  linkText,
  linkLoading,
  onClose,
}: {
  selectedNode: FlowNode | null;
  selectedEdge: FlowEdge | null;
  linkText: string;
  linkLoading: boolean;
  onClose: () => void;
}) {
  return (
    <aside className="absolute bottom-3 right-3 top-3 z-30 w-[430px]">
      <Panel className="flex h-full flex-col overflow-hidden p-0">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-5">
          {selectedNode ? (
            <div className="min-w-0">
              <div className="text-xs font-black uppercase text-slate-500">{selectedNode.type || "node"}</div>
              <h2 className="mt-1 text-2xl font-black leading-tight tracking-normal text-zinc-950">
                {selectedNode.name || selectedNode.id}
              </h2>
              <div className="mt-2 truncate font-mono text-xs font-bold text-slate-500">{selectedNode.id}</div>
            </div>
          ) : selectedEdge ? (
            <div className="min-w-0">
              <div className="text-xs font-black uppercase text-slate-500">Edge</div>
              <h2 className="mt-1 text-2xl font-black leading-tight tracking-normal text-zinc-950">
                {selectedEdge.name || selectedEdge.id}
              </h2>
              <div className="mt-2 truncate font-mono text-xs font-bold text-slate-500">{selectedEdge.id}</div>
            </div>
          ) : null}
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close details">
            <X className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5">
          {selectedNode ? (
            <>
              <div className="grid gap-3">
                <MetaField label="Node id" value={selectedNode.id} />
                <MetaField label="Link" value={selectedNode.link} />
              </div>
              <section className="mt-5">
                <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Markdown</div>
                <pre className="max-h-[calc(100vh-285px)] min-h-[340px] overflow-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-4 font-mono text-[13px] font-semibold leading-7 text-zinc-900">
                  {linkLoading ? "Loading markdown..." : linkText || "No linked markdown loaded."}
                </pre>
              </section>
            </>
          ) : selectedEdge ? (
            <>
              <div className="grid gap-3">
                <MetaField label="Type" value={selectedEdge.type} />
                <MetaField label="From" value={selectedEdge.from} />
                <MetaField label="To" value={selectedEdge.to} />
              </div>
              <section className="mt-5 rounded-md border border-zinc-200 bg-zinc-50 p-4">
                <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Role</div>
                <p className="text-sm font-semibold leading-6 text-zinc-800">
                  This edge describes the <strong>{selectedEdge.type}</strong> transition from{" "}
                  <strong>{selectedEdge.from}</strong> to <strong>{selectedEdge.to}</strong>.
                </p>
              </section>
            </>
          ) : null}
        </div>
      </Panel>
    </aside>
  );
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-black uppercase tracking-wide text-slate-500">{label}</div>
      <code className="block truncate rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5 font-mono text-xs font-bold text-zinc-800">
        {value}
      </code>
    </div>
  );
}

function FlowCanvas({
  flowKey,
  nodes: initialNodes,
  edges: initialEdges,
  nodeTypes,
  onToggleNode,
  onToggleEdge,
  onClearFocus,
  onPersistNodePosition,
}: {
  flowKey: string;
  nodes: ReturnType<typeof layout>["nodes"];
  edges: ReturnType<typeof layout>["edges"];
  nodeTypes: Record<string, typeof SkillNode>;
  onToggleNode: (id: string) => void;
  onToggleEdge: (id: string) => void;
  onClearFocus: () => void;
  onPersistNodePosition: (id: string, position: CanvasPosition) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  return (
    <ReactFlow
      key={flowKey}
      className="h-full"
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      proOptions={{ hideAttribution: true }}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      minZoom={0.25}
      maxZoom={1.8}
      onlyRenderVisibleElements
      onNodesChange={onNodesChange}
      onNodeClick={(_event, node) => onToggleNode(node.id)}
      onNodeDragStop={(_event, node) => onPersistNodePosition(node.id, node.position)}
      onEdgeClick={(_event, edge) => onToggleEdge(edge.id)}
      onPaneClick={onClearFocus}
    >
      <Background gap={18} size={1} color="#cfd8e7" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

function App() {
  const [payload, setPayload] = useState<WebPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [focus, setFocus] = useState<Focus>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [direction, setDirection] = useState<LayoutDirection>("horizontal");
  const [query, setQuery] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const positionSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const positionSaveVersions = useRef<Record<string, number>>({});

  const loadFlow = useCallback((name?: string) => {
    setLoading(true);
    setLoadError(null);
    const queryString = name ? `?name=${encodeURIComponent(name)}` : "";
    fetch(`/api/flow${queryString}`)
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`GET /api/flow failed with ${resp.status}`);
        return resp.json() as Promise<WebPayload>;
      })
      .then((nextPayload) => {
        setPayload(nextPayload);
        setFocus(null);
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadFlow();
  }, [loadFlow]);

  const flow = payload?.flow || null;
  const flowUi = payload?.flowUi ?? emptyFlowUi;
  const graph = useMemo(() => layout(flow, direction, flowUi), [direction, flow, flowUi]);
  const nodeById = useMemo(() => new Map((flow?.nodes || []).map((node) => [node.id, node])), [flow]);
  const edgeById = useMemo(() => new Map((flow?.edges || []).map((edge) => [edge.id, edge])), [flow]);
  const selectedNode = focus?.kind === "node" ? nodeById.get(focus.id) || null : null;
  const selectedEdge = focus?.kind === "edge" ? edgeById.get(focus.id) || null : null;
  const filteredNodes = (flow?.nodes || []).filter((node) =>
    [node.id, node.name, node.type].join(" ").toLowerCase().includes(query.toLowerCase()),
  );
  const nodeTypes = useMemo(() => ({ skillNode: SkillNode }), []);
  const displayNodes = useMemo(
    () =>
      graph.nodes.map((node) => ({
        ...node,
        selected: focus?.kind === "node" && focus.id === node.id,
      })),
    [focus, graph.nodes],
  );
  const displayEdges = useMemo(
    () =>
      graph.edges.map((edge) => ({
        ...edge,
        selected: focus?.kind === "edge" && focus.id === edge.id,
        style: {
          ...edge.style,
          stroke: focus?.kind === "edge" && focus.id === edge.id ? "#2563eb" : edge.style.stroke,
          strokeWidth: focus?.kind === "edge" && focus.id === edge.id ? 3 : edge.style.strokeWidth,
        },
      })),
    [focus, graph.edges],
  );

  const toggleNodeFocus = useCallback((id: string) => {
    setFocus((current) => (current?.kind === "node" && current.id === id ? null : { kind: "node", id }));
  }, []);

  const toggleEdgeFocus = useCallback((id: string) => {
    setFocus((current) => (current?.kind === "edge" && current.id === id ? null : { kind: "edge", id }));
  }, []);

  const scheduleNodePositionSave = useCallback(
    (id: string, position: CanvasPosition) => {
      const selectedId = payload?.selectedId;
      if (!selectedId) return;

      const nextPosition = roundPosition(position);
      setPayload((current) =>
        current?.selectedId === selectedId ? withFlowUiPosition(current, id, direction, nextPosition) : current,
      );

      const timerKey = `${selectedId}:${draftKey(direction, id)}`;
      const currentTimer = positionSaveTimers.current[timerKey];
      if (currentTimer) clearTimeout(currentTimer);

      const saveVersion = (positionSaveVersions.current[timerKey] ?? 0) + 1;
      positionSaveVersions.current[timerKey] = saveVersion;

      positionSaveTimers.current[timerKey] = setTimeout(() => {
        delete positionSaveTimers.current[timerKey];
        fetch(`/api/flow-ui?name=${encodeURIComponent(selectedId)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            nodePositions: {
              [id]: {
                [direction]: nextPosition,
              },
            },
          }),
        })
          .then(async (resp) => {
            if (!resp.ok) throw new Error(`POST /api/flow-ui failed with ${resp.status}`);
            return resp.json() as Promise<{ flowUi: FlowUiJson }>;
          })
          .then(({ flowUi: nextFlowUi }) => {
            if (positionSaveVersions.current[timerKey] !== saveVersion) return;
            setPayload((current) =>
              current?.selectedId === selectedId ? { ...current, flowUi: nextFlowUi } : current,
            );
          })
          .catch((error: unknown) => {
            console.error(error);
          });
      }, POSITION_SAVE_DELAY_MS);
    },
    [direction, payload?.selectedId],
  );

  const rearrangeCurrentLayout = useCallback(() => {
    const selectedId = payload?.selectedId;
    if (!selectedId) return;

    const positions = autoLayoutPositions(flow, direction);
    if (!Object.keys(positions).length) return;

    for (const nodeId of Object.keys(positions)) {
      const timerKey = `${selectedId}:${draftKey(direction, nodeId)}`;
      const currentTimer = positionSaveTimers.current[timerKey];
      if (currentTimer) {
        clearTimeout(currentTimer);
        delete positionSaveTimers.current[timerKey];
      }
      positionSaveVersions.current[timerKey] = (positionSaveVersions.current[timerKey] ?? 0) + 1;
    }

    setPayload((current) =>
      current?.selectedId === selectedId ? withFlowUiPositions(current, direction, positions) : current,
    );

    fetch(`/api/flow-ui?name=${encodeURIComponent(selectedId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(flowUiPatchFromPositions(direction, positions)),
    })
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`POST /api/flow-ui failed with ${resp.status}`);
        return resp.json() as Promise<{ flowUi: FlowUiJson }>;
      })
      .then(({ flowUi: nextFlowUi }) => {
        setPayload((current) => (current?.selectedId === selectedId ? { ...current, flowUi: nextFlowUi } : current));
      })
      .catch((error: unknown) => {
        console.error(error);
      });
  }, [direction, flow, payload?.selectedId]);

  useEffect(() => {
    const timers = positionSaveTimers.current;
    return () => {
      for (const timer of Object.values(timers)) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!payload?.selectedId || !selectedNode?.link) {
      setLinkText("");
      setLinkLoading(false);
      return;
    }

    let cancelled = false;
    setLinkLoading(true);
    fetch(`/api/link?name=${encodeURIComponent(payload.selectedId)}&path=${encodeURIComponent(selectedNode.link)}`)
      .then((resp) => (resp.ok ? resp.text() : resp.json().then((body) => body.error || "Unable to load link")))
      .then((nextText) => {
        if (!cancelled) setLinkText(nextText);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLinkText(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLinkLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [payload?.selectedId, selectedNode?.link]);

  if (loadError) {
    return <div className="grid h-screen place-items-center text-sm font-black text-red-600">{loadError}</div>;
  }
  if (!payload)
    return <div className="grid h-screen place-items-center text-sm font-black text-slate-500">Loading flow...</div>;

  return (
    <div className="relative flex h-screen min-w-[1120px] gap-3 overflow-hidden bg-zinc-100 p-3 text-zinc-950">
      <Sidebar
        payload={payload}
        query={query}
        focus={focus}
        filteredNodes={filteredNodes}
        collapsed={!sidebarOpen}
        onQuery={setQuery}
        onSelectPackage={loadFlow}
        onToggleNode={toggleNodeFocus}
        onToggleCollapse={() => setSidebarOpen((value) => !value)}
      />
      <main className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="pointer-events-none absolute left-4 right-4 top-4 z-10 flex items-center justify-between gap-3">
          <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 shadow-sm">
            <span className="text-xs font-bold text-zinc-500">Skill DSL</span>
            <strong className="text-sm font-black text-zinc-950">{payload.name || "No flow"}</strong>
            <Badge variant={statusVariant(payload.validation.status)}>
              {loading ? "loading" : payload.validation.status}
            </Badge>
          </div>
          <div className="pointer-events-auto flex items-center gap-2">
            <Button
              className="shadow-sm"
              variant="soft"
              size="icon"
              onClick={rearrangeCurrentLayout}
              title="Rearrange current layout"
              aria-label="Rearrange current layout"
            >
              <RefreshCw className="size-4" />
            </Button>
            <div className="flex rounded-lg border border-zinc-200 bg-white p-1 shadow-sm">
              {(["horizontal", "vertical"] as const).map((value) => {
                const Icon = value === "horizontal" ? ArrowRight : ArrowDown;
                return (
                  <Button
                    key={value}
                    className="size-7"
                    size="icon"
                    variant={direction === value ? "active" : "ghost"}
                    onClick={() => setDirection(value)}
                    title={`${value[0].toUpperCase()}${value.slice(1)} layout`}
                    aria-label={`${value} layout`}
                  >
                    <Icon className="size-4" />
                  </Button>
                );
              })}
            </div>
            <div
              className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-black text-zinc-700 shadow-sm"
              aria-label={`${(flow?.nodes || []).length} nodes, ${(flow?.edges || []).length} edges`}
            >
              <span className="inline-flex items-center gap-1.5" title="Nodes">
                <CircleDot className="size-4 text-slate-500" />
                {(flow?.nodes || []).length}
              </span>
              <span className="inline-flex items-center gap-1.5" title="Edges">
                <GitBranch className="size-4 text-slate-500" />
                {(flow?.edges || []).length}
              </span>
            </div>
          </div>
        </div>
        {graph.nodes.length ? (
          <FlowCanvas
            key={`${payload.selectedId ?? "empty"}-${direction}`}
            flowKey={`${payload.selectedId ?? "empty"}-${direction}`}
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            onToggleNode={toggleNodeFocus}
            onToggleEdge={toggleEdgeFocus}
            onClearFocus={() => setFocus(null)}
            onPersistNodePosition={scheduleNodePositionSave}
          />
        ) : (
          <div className="absolute left-1/2 top-1/2 max-w-sm -translate-x-1/2 -translate-y-1/2 text-center text-sm font-black text-slate-500">
            This flow is empty. Add nodes to flow.json to render the graph.
          </div>
        )}
      </main>
      {focus ? (
        <Details
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          linkText={linkText}
          linkLoading={linkLoading}
          onClose={() => setFocus(null)}
        />
      ) : null}
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
