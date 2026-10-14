"use client";

import { FormEvent, PointerEvent as ReactPointerEvent, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Background,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SmoothStepEdge,
  getSmoothStepPath,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStoreApi,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import CanvasWheel, { wheelActionAtPoint, type WheelAction } from "@/components/CanvasWheel";
import ColorPicker, { ColorDot } from "@/components/ColorPicker";
import DocumentUpload from "@/components/DocumentUpload";
import ProjectKanban from "@/components/ProjectKanban";
import { api } from "@/lib/api";
import {
  cachedGet,
  invalidateCached,
  invalidateLists,
  peekCached,
  projectBundlePath,
  putCached,
} from "@/lib/data-cache";
import { inferHandles } from "@/lib/layout";
import { IMPORTANCE_LABEL, RECURRENCE_LABEL, STATUS_LABEL } from "@/lib/labels";
import { useFormDraft } from "@/lib/form-drafts";
import { progress } from "@/lib/progress";
import { isOverdue, todayISO } from "@/lib/tasks";
import { readTheme, type Theme } from "@/lib/theme";
import type { ChecklistItem, FlowEdge, FlowNode, Importance, NodeStatus, Recurrence, TaskColor, Todo } from "@/lib/types";

type WheelState = {
  x: number;
  y: number;
  target: "pane" | "node" | "edge";
  nodeId?: string;
  edgeId?: string;
};

type PendingRightDrag = {
  sourceId: string;
  originX: number;
  originY: number;
};

type RightDragLink = {
  sourceId: string;
  targetId: string | null;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  sourcePosition: Position;
  targetPosition: Position;
};

const DRAG_LINK_THRESHOLD = 28;

function handleIdToPosition(handleId: string): Position {
  switch (handleId) {
    case "top":
      return Position.Top;
    case "right":
      return Position.Right;
    case "bottom":
      return Position.Bottom;
    case "left":
      return Position.Left;
    default:
      return Position.Right;
  }
}

function handleCenterOnScreen(nodeId: string, handleId: string): { x: number; y: number } | null {
  const handle = document.querySelector(
    `.react-flow__node[data-id="${CSS.escape(nodeId)}"] .react-flow__handle[data-handleid="${handleId}"]`,
  );
  if (!handle) return null;
  const rect = handle.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

type NodePatch = Partial<
  Pick<FlowNode, "title" | "description" | "importance" | "notes" | "status" | "x" | "y" | "dueDate" | "recurrence">
>;

type HistoryAction =
  | { type: "add-node"; node: FlowNode }
  | { type: "delete"; nodes: FlowNode[]; edges: FlowEdge[] }
  | { type: "move"; id: string; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: "add-edge"; edge: FlowEdge }
  | { type: "layout"; before: { id: string; x: number; y: number }[]; after: { id: string; x: number; y: number }[] };

type CanvasApi = {
  patchStep: (id: string, patch: NodePatch) => Promise<void>;
  patchChecklist: (id: string, checklist: ChecklistItem[]) => void;
  setError: (message: string | null) => void;
  closeStep: () => void;
};

const CanvasApiContext = createContext<CanvasApi | null>(null);

function useCanvasApi() {
  const value = useContext(CanvasApiContext);
  if (!value) throw new Error("Canvas API missing");
  return value;
}

type StepData = {
  title: string;
  status: NodeStatus;
  importance: Importance;
  linking?: boolean;
  expanded?: boolean;
  overdue?: boolean;
  atRisk?: boolean;
  step?: FlowNode;
};

type RefineInstruction = "more_detail" | "compress" | "add_testing";

type StepNode = Node<StepData, "step">;

type Bundle = {
  project: { id: string; title: string; description: string; status: string };
  nodes: FlowNode[];
  edges: FlowEdge[];
  todos: Todo[];
  progress: { done: number; total: number; percent: number };
};

function NodeHandles() {
  const handleClass = "!h-3.5 !w-3.5 !border-2 !border-base-100 !bg-primary";
  return (
    <>
      <Handle type="source" id="top" position={Position.Top} className={handleClass} />
      <Handle type="source" id="right" position={Position.Right} className={handleClass} />
      <Handle type="source" id="bottom" position={Position.Bottom} className={handleClass} />
      <Handle type="source" id="left" position={Position.Left} className={handleClass} />
    </>
  );
}

function StepCard({ data, id }: NodeProps<StepNode>) {
  const updateNodeInternals = useUpdateNodeInternals();
  const { closeStep } = useCanvasApi();

  useEffect(() => {
    updateNodeInternals(id);
  }, [data.expanded, id, updateNodeInternals]);

  const border = data.overdue
    ? "border-warning"
    : data.atRisk
      ? "border-warning/50"
      : data.status === "done"
        ? "border-success"
        : data.status === "doing"
          ? "border-primary"
          : "border-base-300";

  if (data.expanded && data.step) {
    return (
      <div
        className={`w-[26rem] rounded-xl border-2 bg-base-100 p-4 shadow-xl ${border}`}
        aria-label={data.title}
        data-id={id}
      >
        <NodeHandles />
        <div className="mb-2 flex cursor-grab items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wide text-base-content/50">Drag the header · Esc to close</p>
          <button className="btn btn-ghost btn-xs" type="button" data-close-step onClick={closeStep}>
            Close
          </button>
        </div>
        {data.overdue || data.atRisk ? (
          <p className={`mb-2 text-xs ${data.overdue ? "text-warning" : "text-warning/80"}`}>
            {data.overdue ? "Overdue" : "At risk — waiting on an overdue step"}
          </p>
        ) : null}
        <div className="nodrag nopan nowheel max-h-[28rem] overflow-y-auto" data-step-editor>
          <InlineEditor step={data.step} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`w-44 cursor-pointer rounded-md border-2 bg-base-100 px-3 py-2 shadow-sm ${border} ${data.linking ? "ring-2 ring-primary ring-offset-2" : ""}`}
      aria-label={data.title}
      data-id={id}
    >
      <NodeHandles />
      <div className="text-sm font-semibold leading-snug">{data.title}</div>
      <div className="mt-1 text-[11px] uppercase tracking-wide text-base-content/50">{STATUS_LABEL[data.status]}</div>
      {data.overdue ? <div className="mt-1 text-[11px] font-medium text-warning">Overdue</div> : null}
      {!data.overdue && data.atRisk ? <div className="mt-1 text-[11px] font-medium text-warning/80">At risk</div> : null}
      {data.step?.dueDate ? (
        <div className={`mt-1 text-[11px] ${data.overdue ? "text-warning" : "text-base-content/50"}`}>
          {data.step.dueDate}
          {data.step.recurrence && data.step.recurrence !== "none" ? ` · ${RECURRENCE_LABEL[data.step.recurrence]}` : ""}
        </div>
      ) : data.step?.recurrence && data.step.recurrence !== "none" ? (
        <div className="mt-1 text-[11px] text-primary">{RECURRENCE_LABEL[data.step.recurrence]}</div>
      ) : null}
    </div>
  );
}

const nodeTypes = { step: StepCard };
const edgeTypes = { flow: FlowLink };

function toFlowNode(step: FlowNode, linkingId: string | null, selectedId: string | null): StepNode {
  const expanded = step.id === selectedId;
  return {
    id: step.id,
    type: "step",
    position: { x: step.x, y: step.y },
    zIndex: expanded ? 1000 : 0,
    data: {
      title: step.title,
      status: step.status,
      importance: step.importance,
      linking: step.id === linkingId,
      expanded,
      step,
    },
    ariaLabel: step.title,
  };
}

const EDGE_CORNER = 36;
const EDGE_OFFSET = 28;

function FlowLink(props: EdgeProps) {
  return <SmoothStepEdge {...props} pathOptions={{ borderRadius: EDGE_CORNER, offset: EDGE_OFFSET }} />;
}

function toFlowEdge(edge: FlowEdge): Edge {
  return {
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
    type: "flow",
    style: { strokeWidth: 2 },
  };
}

export default function ProjectCanvas({ projectId }: { projectId: string }) {
  return (
    <ReactFlowProvider>
      <Canvas projectId={projectId} />
    </ReactFlowProvider>
  );
}

function Canvas({ projectId }: { projectId: string }) {
  const { fitView, screenToFlowPosition } = useReactFlow();
  const store = useStoreApi();
  const cachedBundle = peekCached<Bundle>(projectBundlePath(projectId));
  const [project, setProject] = useState<Bundle["project"] | null>(() => cachedBundle?.project ?? null);
  const [steps, setSteps] = useState<FlowNode[]>(() => cachedBundle?.nodes ?? []);
  const [todos, setTodos] = useState<Todo[]>(() => cachedBundle?.todos ?? []);
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNode>(
    cachedBundle?.nodes.map((node) => toFlowNode(node, null, null)) ?? [],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(cachedBundle?.edges.map(toFlowEdge) ?? []);
  const [ready, setReady] = useState(Boolean(cachedBundle));
  const [missing, setMissing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskDraft, setTaskDraft, clearTaskDraft] = useFormDraft<{
    taskText: string;
    taskDate: string;
    taskRepeat: Recurrence;
    taskColor: TaskColor;
  }>(`project:${projectId}:task`, {
    taskText: "",
    taskDate: "",
    taskRepeat: "none",
    taskColor: "none",
  });
  const { taskText, taskDate, taskRepeat, taskColor } = taskDraft;
  const [help, setHelp] = useState(false);
  const [colorMode, setColorMode] = useState<"light" | "dark">("light");
  const [aiOn, setAiOn] = useState(false);
  const [generateDraft, setGenerateDraft, clearGenerateDraft] = useFormDraft<{
    idea: string;
    documentFile: File | null;
    mode: "quick" | "thinking";
  }>(`project:${projectId}:generate`, {
    idea: "",
    documentFile: null,
    mode: "quick",
  });
  const { idea, documentFile, mode } = generateDraft;
  const [generating, setGenerating] = useState(false);
  const [view, setView] = useState<"map" | "board">("map");
  const [wheel, setWheel] = useState<WheelState | null>(null);
  const [hoveredWheelId, setHoveredWheelId] = useState<string | null>(null);
  const [wheelFocusId, setWheelFocusId] = useState<string | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const wheelRef = useRef<WheelState | null>(null);
  const wheelActionsRef = useRef<WheelAction[]>([]);
  const wheelFocusIdRef = useRef<string | null>(null);
  const buildWheelActionsRef = useRef<(current: WheelState) => WheelAction[]>(() => []);
  const pendingRightDragRef = useRef<PendingRightDrag | null>(null);
  const [rightDragLink, setRightDragLink] = useState<RightDragLink | null>(null);
  const rightDragLinkRef = useRef<RightDragLink | null>(null);
  const createLinkRef = useRef<(source: string, target: string) => void>(() => {});
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const stepsRef = useRef(steps);
  const historyRef = useRef<{ past: HistoryAction[]; future: HistoryAction[] }>({ past: [], future: [] });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [tidying, setTidying] = useState(false);
  const [toolsMinimized, setToolsMinimized] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [renamingProject, setRenamingProject] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
    stepsRef.current = steps;
  }, [nodes, edges, steps]);

  useEffect(() => {
    if (!projectMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (!projectMenuRef.current?.contains(event.target as HTMLElement)) setProjectMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProjectMenuOpen(false);
    };
    // Defer so the opening click does not immediately close the menu.
    const timer = window.setTimeout(() => window.addEventListener("pointerdown", close), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [projectMenuOpen]);

  function record(action: HistoryAction) {
    historyRef.current.past = [...historyRef.current.past.slice(-49), action];
    historyRef.current.future = [];
    setCanUndo(true);
    setCanRedo(false);
  }

  useEffect(() => {
    setColorMode(readTheme());
    cachedGet<{ enabled: boolean }>("/api/ai/status", { freshMs: 5 * 60_000 })
      .then((data) => setAiOn(data.enabled))
      .catch(() => setAiOn(false));
    function onTheme(event: Event) {
      const detail = (event as CustomEvent<Theme>).detail;
      if (detail === "light" || detail === "dark") setColorMode(detail);
      else setColorMode(readTheme());
    }
    window.addEventListener("flowstate-theme", onTheme);
    return () => window.removeEventListener("flowstate-theme", onTheme);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cached = peekCached<Bundle>(projectBundlePath(projectId));
    if (cached) {
      setProject(cached.project);
      setSteps(cached.nodes);
      setTodos(cached.todos);
      setNodes(cached.nodes.map((node) => toFlowNode(node, null, null)));
      setEdges(cached.edges.map(toFlowEdge));
      setReady(true);
      setMissing(false);
    } else {
      setReady(false);
    }
    cachedGet<Bundle>(projectBundlePath(projectId))
      .then((data) => {
        if (cancelled) return;
        setProject(data.project);
        setSteps(data.nodes);
        setTodos(data.todos);
        setNodes(data.nodes.map((node) => toFlowNode(node, null, null)));
        setEdges(data.edges.map(toFlowEdge));
        setReady(true);
        setMissing(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Could not open the project";
        if (message.toLowerCase().includes("not found")) setMissing(true);
        setError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, setEdges, setNodes]);

  useEffect(() => {
    const today = todayISO();
    const overdueIds = new Set(
      steps.filter((step) => isOverdue({ status: step.status, dueDate: step.dueDate }, today)).map((step) => step.id),
    );
    const atRiskIds = new Set<string>();
    for (const edge of edges) {
      if (overdueIds.has(edge.source) && !overdueIds.has(edge.target)) {
        const target = steps.find((step) => step.id === edge.target);
        if (target && target.status !== "done") atRiskIds.add(edge.target);
      }
    }
    setNodes((current) =>
      current.map((node) => {
        const step = steps.find((item) => item.id === node.id);
        if (!step) return node;
        const expanded = node.id === selectedId;
        return {
          ...node,
          zIndex: expanded ? 1000 : 0,
          data: {
            ...node.data,
            title: step.title,
            status: step.status,
            importance: step.importance,
            linking:
              node.id === linkSource ||
              node.id === wheelFocusId ||
              node.id === rightDragLink?.sourceId ||
              node.id === rightDragLink?.targetId,
            expanded,
            overdue: overdueIds.has(node.id),
            atRisk: atRiskIds.has(node.id),
            step,
          },
        };
      }),
    );
  }, [steps, edges, selectedId, linkSource, wheelFocusId, rightDragLink, setNodes]);

  const previousSelectedId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!ready) return;
    const previous = previousSelectedId.current;
    previousSelectedId.current = selectedId;
    const frame = window.requestAnimationFrame(() => {
      if (selectedId) {
        void fitView({ nodes: [{ id: selectedId }], padding: 0.14, duration: 420, maxZoom: 1.75 });
      } else if (previous) {
        void fitView({ padding: 0.18, duration: 420, maxZoom: 1.15, minZoom: 0.35 });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedId, ready, fitView]);

  const summary = useMemo(() => progress(steps), [steps]);
  const overdueCount = useMemo(() => {
    const today = todayISO();
    return steps.filter((step) => isOverdue({ status: step.status, dueDate: step.dueDate }, today)).length;
  }, [steps]);

  const patchStep = useCallback(async (id: string, patch: NodePatch) => {
    setSteps((current) => current.map((step) => (step.id === id ? { ...step, ...patch } : step)));
    try {
      await api(`/api/nodes/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the step");
    }
  }, []);

  const patchChecklist = useCallback((id: string, checklist: ChecklistItem[]) => {
    setSteps((current) => current.map((step) => (step.id === id ? { ...step, checklist } : step)));
  }, []);

  const closeStep = useCallback(() => setSelectedId(null), []);

  const canvasApi = useMemo<CanvasApi>(
    () => ({ patchStep, patchChecklist, setError, closeStep }),
    [patchStep, patchChecklist, closeStep],
  );

  function applyBundle(data: Bundle, keepSelected = false) {
    putCached(projectBundlePath(projectId), data);
    setProject(data.project);
    setSteps(data.nodes);
    setTodos(data.todos);
    setNodes(data.nodes.map((node) => toFlowNode(node, keepSelected ? linkSource : null, keepSelected ? selectedId : null)));
    setEdges(data.edges.map(toFlowEdge));
  }

  async function addStep(at?: { x: number; y: number }) {
    const position = at ?? {
      x: 80 + (steps.length % 4) * 280,
      y: 80 + Math.floor(steps.length / 4) * 160,
    };
    try {
      const created = await api<FlowNode>("/api/nodes", {
        method: "POST",
        body: JSON.stringify({ projectId, title: "New step", x: position.x, y: position.y }),
      });
      record({ type: "add-node", node: created });
      setSteps((current) => [...current, created]);
      setNodes((current) => current.concat(toFlowNode(created, linkSource, created.id)));
      setSelectedId(created.id);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add a step");
    }
  }

  function clearHoldTimer() {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  function closeWheel() {
    clearHoldTimer();
    wheelRef.current = null;
    wheelActionsRef.current = [];
    wheelFocusIdRef.current = null;
    setHoveredWheelId(null);
    setWheelFocusId(null);
    setWheel(null);
  }

  function setWheelFocus(nodeId: string | null) {
    wheelFocusIdRef.current = nodeId;
    setWheelFocusId(nodeId);
  }

  function nodeIdAtPoint(clientX: number, clientY: number): string | null {
    const stack = document.elementsFromPoint(clientX, clientY);
    for (const el of stack) {
      const nodeEl = (el as Element).closest?.(".react-flow__node") as HTMLElement | null;
      if (nodeEl?.dataset.id) return nodeEl.dataset.id;
    }
    return null;
  }

  function buildRightDragLink(sourceId: string, clientX: number, clientY: number): RightDragLink | null {
    const sourceNode = nodesRef.current.find((node) => node.id === sourceId);
    if (!sourceNode) return null;
    const flowPoint = screenToFlowPosition({ x: clientX, y: clientY });
    let targetId = nodeIdAtPoint(clientX, clientY);
    if (targetId === sourceId) targetId = null;
    const targetNode = targetId ? nodesRef.current.find((node) => node.id === targetId) : null;
    const inferred = targetNode
      ? inferHandles(sourceNode.position, targetNode.position)
      : inferHandles(sourceNode.position, flowPoint);
    const from = handleCenterOnScreen(sourceId, inferred.sourceHandle);
    if (!from) return null;
    let toX = clientX;
    let toY = clientY;
    if (targetNode && targetId) {
      const toHandle = handleCenterOnScreen(targetId, inferred.targetHandle);
      if (toHandle) {
        toX = toHandle.x;
        toY = toHandle.y;
      }
    }
    return {
      sourceId,
      targetId,
      fromX: from.x,
      fromY: from.y,
      toX,
      toY,
      sourcePosition: handleIdToPosition(inferred.sourceHandle),
      targetPosition: handleIdToPosition(inferred.targetHandle),
    };
  }

  function clearRightDrag() {
    rightDragLinkRef.current = null;
    setRightDragLink(null);
    store.getState().cancelConnection();
  }

  function startRightDrag(sourceId: string, clientX: number, clientY: number) {
    clearHoldTimer();
    closeWheel();
    pendingRightDragRef.current = null;
    const link = buildRightDragLink(sourceId, clientX, clientY);
    if (!link) return;
    rightDragLinkRef.current = link;
    setRightDragLink(link);
  }

  const buildWheelActions = useCallback(
    (current: WheelState): WheelAction[] => {
      const focusedNodeId = () => wheelFocusIdRef.current ?? current.nodeId ?? null;

      if (current.target === "node" && current.nodeId) {
        return [
          {
            id: "add",
            label: "Add step",
            icon: "add",
            run: () => {
              const point = screenToFlowPosition({ x: current.x, y: current.y });
              void addStep({ x: point.x + 40, y: point.y + 40 });
            },
          },
          {
            id: "link",
            label: "Link",
            icon: "link",
            run: () => {
              const nodeId = focusedNodeId();
              setLinkMode(true);
              setLinkSource(nodeId);
            },
          },
          {
            id: "delete",
            label: "Delete",
            icon: "delete",
            danger: true,
            run: () => {
              const nodeId = focusedNodeId();
              if (nodeId) void deleteSelection({ nodeIds: [nodeId] });
            },
          },
          {
            id: "clear",
            label: "Clear selection",
            icon: "clear",
            run: () => {
              setSelectedId(null);
              setLinkMode(false);
              setLinkSource(null);
            },
          },
        ];
      }
      if (current.target === "edge" && current.edgeId) {
        const edgeId = current.edgeId;
        return [
          {
            id: "delete",
            label: "Delete link",
            icon: "delete",
            danger: true,
            run: () => {
              void deleteSelection({ edgeIds: [edgeId] });
            },
          },
          {
            id: "add",
            label: "Add step",
            icon: "add",
            run: () => {
              const point = screenToFlowPosition({ x: current.x, y: current.y });
              void addStep(point);
            },
          },
          {
            id: "clear",
            label: "Clear selection",
            icon: "clear",
            run: () => {
              setSelectedId(null);
              setLinkMode(false);
              setLinkSource(null);
            },
          },
        ];
      }
      return [
        {
          id: "add",
          label: "Add step",
          icon: "add",
          run: () => {
            const point = screenToFlowPosition({ x: current.x, y: current.y });
            void addStep(point);
          },
        },
        {
          id: "link",
          label: "Link",
          icon: "link",
          run: () => {
            const nodeId = focusedNodeId();
            setLinkMode(true);
            setLinkSource(nodeId);
          },
        },
        {
          id: "tidy",
          label: "Tidy map",
          icon: "tidy",
          disabled: steps.length === 0 || tidying,
          run: () => void tidy(),
        },
        {
          id: "undo",
          label: "Undo",
          icon: "undo",
          disabled: !canUndo,
          run: () => void undo(),
        },
        {
          id: "delete",
          label: "Delete",
          icon: "delete",
          danger: true,
          disabled:
            !focusedNodeId() &&
            !nodes.some((node) => node.selected) &&
            !edges.some((edge) => edge.selected),
          run: () => {
            const nodeId = focusedNodeId();
            if (nodeId) void deleteSelection({ nodeIds: [nodeId] });
            else void deleteSelection();
          },
        },
      ];
    },
    [screenToFlowPosition, steps.length, tidying, canUndo, nodes, edges],
  );

  buildWheelActionsRef.current = buildWheelActions;

  function openWheel(state: WheelState) {
    clearHoldTimer();
    const focusId = state.target === "node" ? state.nodeId ?? null : null;
    setWheelFocus(focusId);
    const actions = buildWheelActions(state);
    wheelRef.current = state;
    wheelActionsRef.current = actions;
    setHoveredWheelId(null);
    setWheel(state);
  }

  function retargetWheelToNode(nodeId: string) {
    const current = wheelRef.current;
    if (!current || current.target === "edge") return;
    setWheelFocus(nodeId);
    if (current.target === "node" && current.nodeId === nodeId) return;
    const next: WheelState = { x: current.x, y: current.y, target: "node", nodeId };
    const actions = buildWheelActionsRef.current(next);
    wheelRef.current = next;
    wheelActionsRef.current = actions;
    setWheel(next);
  }

  const wheelActions = wheel ? buildWheelActions(wheel) : [];
  if (wheel) {
    wheelActionsRef.current = wheelActions;
    wheelRef.current = wheel;
  }

  function onCanvasPointerDown(event: ReactPointerEvent) {
    if (event.button !== 2) return;
    event.preventDefault();
    const x = event.clientX;
    const y = event.clientY;
    const target = event.target as HTMLElement;
    const nodeEl = target.closest(".react-flow__node") as HTMLElement | null;
    const edgeEl = target.closest(".react-flow__edge") as HTMLElement | null;
    clearHoldTimer();
    pendingRightDragRef.current = nodeEl?.dataset.id
      ? { sourceId: nodeEl.dataset.id, originX: x, originY: y }
      : null;
    holdTimerRef.current = window.setTimeout(() => {
      if (rightDragLinkRef.current) return;
      if (nodeEl?.dataset.id) {
        openWheel({ x, y, target: "node", nodeId: nodeEl.dataset.id });
      } else if (edgeEl?.dataset.id) {
        openWheel({ x, y, target: "edge", edgeId: edgeEl.dataset.id });
      } else {
        openWheel({ x, y, target: "pane" });
      }
    }, 160);
  }

  const createLink = useCallback(
    async (source: string, target: string, sourceHandle?: string | null, targetHandle?: string | null) => {
      const sourceNode = nodesRef.current.find((node) => node.id === source);
      const targetNode = nodesRef.current.find((node) => node.id === target);
      const inferred =
        sourceNode && targetNode ? inferHandles(sourceNode.position, targetNode.position) : { sourceHandle: "right", targetHandle: "left" };
      const fromHandle = sourceHandle || inferred.sourceHandle;
      const toHandle = targetHandle || inferred.targetHandle;
      try {
        const edge = await api<FlowEdge>("/api/edges", {
          method: "POST",
          body: JSON.stringify({
            projectId,
            sourceNodeId: source,
            targetNodeId: target,
            sourceHandle: fromHandle,
            targetHandle: toHandle,
          }),
        });
        record({ type: "add-edge", edge });
        setEdges((current) => current.concat(toFlowEdge(edge)));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not link those steps");
      }
    },
    [projectId, setEdges],
  );

  createLinkRef.current = (source, target) => {
    void createLink(source, target);
  };

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const rightHeld = (event.buttons & 2) !== 0;

      if (rightDragLinkRef.current && !rightHeld) {
        clearRightDrag();
        return;
      }

      const pending = pendingRightDragRef.current;
      if (pending && rightHeld) {
        const dist = Math.hypot(event.clientX - pending.originX, event.clientY - pending.originY);
        if (dist >= DRAG_LINK_THRESHOLD) {
          startRightDrag(pending.sourceId, event.clientX, event.clientY);
          return;
        }
      }

      const drag = rightDragLinkRef.current;
      if (drag && rightHeld) {
        const next = buildRightDragLink(drag.sourceId, event.clientX, event.clientY);
        if (next) {
          rightDragLinkRef.current = next;
          setRightDragLink(next);
        }
        return;
      }

      const current = wheelRef.current;
      if (!current) return;
      const actionId = wheelActionAtPoint(current.x, current.y, event.clientX, event.clientY, wheelActionsRef.current);
      setHoveredWheelId(actionId);
      if (!actionId && current.target !== "edge") {
        const nodeId = nodeIdAtPoint(event.clientX, event.clientY);
        if (nodeId) retargetWheelToNode(nodeId);
      }
    }

    function finishRightClick(event: PointerEvent) {
      if (event.button !== 2 && event.type !== "pointercancel") return;
      clearHoldTimer();

      const drag = rightDragLinkRef.current;
      if (drag) {
        if (drag.targetId) createLinkRef.current(drag.sourceId, drag.targetId);
        clearRightDrag();
        pendingRightDragRef.current = null;
        closeWheel();
        return;
      }

      pendingRightDragRef.current = null;
      const current = wheelRef.current;
      if (!current) return;
      const actionId = wheelActionAtPoint(current.x, current.y, event.clientX, event.clientY, wheelActionsRef.current);
      const action = wheelActionsRef.current.find((item) => item.id === actionId);
      if (action && !action.disabled) action.run();
      closeWheel();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finishRightClick);
    window.addEventListener("pointercancel", finishRightClick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finishRightClick);
      window.removeEventListener("pointercancel", finishRightClick);
      clearRightDrag();
    };
  }, [screenToFlowPosition, store]);

  useEffect(() => {
    return () => {
      store.getState().cancelConnection();
    };
  }, [store]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      void createLink(connection.source, connection.target, connection.sourceHandle, connection.targetHandle);
    },
    [createLink],
  );

  function clearFlowSelection() {
    setNodes((current) => current.map((node) => (node.selected ? { ...node, selected: false } : node)));
    setEdges((current) => current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)));
  }

  function onNodeClick(id: string) {
    if (!linkMode) {
      setSelectedId(id);
      return;
    }
    if (!linkSource) {
      setLinkSource(id);
      return;
    }
    if (linkSource === id) {
      setLinkSource(null);
      return;
    }
    void createLink(linkSource, id);
    setLinkSource(null);
    setLinkMode(false);
    // Linking clicks select the target in React Flow — clear so a follow-up edge delete
    // doesn't also remove that node.
    clearFlowSelection();
  }

  async function deleteSelection(forced?: { nodeIds?: string[]; edgeIds?: string[] }) {
    // When callers force specific ids, only delete those — never mix in the current RF selection.
    const selectedNodes = forced
      ? (forced.nodeIds ?? [])
      : nodesRef.current.filter((node) => node.selected).map((node) => node.id);
    const selectedEdges = forced
      ? forced.edgeIds
        ? edgesRef.current.filter((edge) => forced.edgeIds!.includes(edge.id))
        : []
      : edgesRef.current.filter((edge) => edge.selected);
    const removedNodes = new Set(selectedNodes);
    const edgesToDelete = selectedEdges.filter((edge) => !removedNodes.has(edge.source) && !removedNodes.has(edge.target));
    if (selectedNodes.length === 0 && edgesToDelete.length === 0) return;
    const removedNodeSet = new Set(selectedNodes);
    const snapshotNodes = stepsRef.current.filter((step) => removedNodeSet.has(step.id));
    const edgeIdsToSnapshot = new Set([
      ...edgesToDelete.map((edge) => edge.id),
      ...edgesRef.current
        .filter((edge) => removedNodeSet.has(edge.source) || removedNodeSet.has(edge.target))
        .map((edge) => edge.id),
    ]);
    const snapshotEdges = (edgesRef.current
      .filter((edge) => edgeIdsToSnapshot.has(edge.id))
      .map((edge) => ({
        id: edge.id,
        projectId,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
      })) as FlowEdge[]);
    try {
      await Promise.all([
        ...selectedNodes.map((id) => api(`/api/nodes/${id}`, { method: "DELETE" })),
        ...edgesToDelete.map((edge) => api(`/api/edges/${edge.id}`, { method: "DELETE" })),
      ]);
      record({ type: "delete", nodes: snapshotNodes, edges: snapshotEdges });
      const removedEdges = new Set([
        ...edgesToDelete.map((edge) => edge.id),
        ...edgesRef.current
          .filter((edge) => removedNodes.has(edge.source) || removedNodes.has(edge.target))
          .map((edge) => edge.id),
      ]);
      setNodes((current) => current.filter((node) => !removedNodes.has(node.id)));
      setEdges((current) => current.filter((edge) => !removedEdges.has(edge.id)));
      setSteps((current) => current.filter((step) => !removedNodes.has(step.id)));
      if (selectedId && removedNodes.has(selectedId)) setSelectedId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  async function restoreNodes(nodesToRestore: FlowNode[]) {
    for (const node of nodesToRestore) {
      await api<FlowNode>("/api/nodes", {
        method: "POST",
        body: JSON.stringify({
          id: node.id,
          projectId,
          title: node.title,
          x: node.x,
          y: node.y,
          description: node.description,
          importance: node.importance,
          notes: node.notes,
          status: node.status,
          dueDate: node.dueDate,
          recurrence: node.recurrence ?? "none",
        }),
      });
      for (const item of node.checklist) {
        await api("/api/checklist", { method: "POST", body: JSON.stringify({ nodeId: node.id, text: item.text }) });
      }
    }
  }

  async function restoreEdges(edgesToRestore: FlowEdge[]) {
    for (const edge of edgesToRestore) {
      await api("/api/edges", {
        method: "POST",
        body: JSON.stringify({
          id: edge.id,
          projectId,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
        }),
      });
    }
  }

  async function undo() {
    const action = historyRef.current.past.pop();
    if (!action) return;
    try {
      if (action.type === "add-node") {
        await api(`/api/nodes/${action.node.id}`, { method: "DELETE" });
        setSteps((current) => current.filter((step) => step.id !== action.node.id));
        setNodes((current) => current.filter((node) => node.id !== action.node.id));
        setEdges((current) => current.filter((edge) => edge.source !== action.node.id && edge.target !== action.node.id));
        if (selectedId === action.node.id) setSelectedId(null);
      } else if (action.type === "add-edge") {
        await api(`/api/edges/${action.edge.id}`, { method: "DELETE" });
        setEdges((current) => current.filter((edge) => edge.id !== action.edge.id));
      } else if (action.type === "move") {
        await api(`/api/nodes/${action.id}`, { method: "PATCH", body: JSON.stringify(action.from) });
        setSteps((current) => current.map((step) => (step.id === action.id ? { ...step, ...action.from } : step)));
        setNodes((current) => current.map((node) => (node.id === action.id ? { ...node, position: action.from } : node)));
      } else if (action.type === "delete") {
        await restoreNodes(action.nodes);
        await restoreEdges(action.edges);
        const data = await cachedGet<Bundle>(projectBundlePath(projectId), { force: true });
        applyBundle(data, true);
      } else if (action.type === "layout") {
        await api("/api/nodes/positions", { method: "POST", body: JSON.stringify({ positions: action.before }) });
        setSteps((current) =>
          current.map((step) => {
            const pos = action.before.find((item) => item.id === step.id);
            return pos ? { ...step, x: pos.x, y: pos.y } : step;
          }),
        );
        setNodes((current) =>
          current.map((node) => {
            const pos = action.before.find((item) => item.id === node.id);
            return pos ? { ...node, position: { x: pos.x, y: pos.y } } : node;
          }),
        );
      }
      historyRef.current.future.push(action);
      setCanUndo(historyRef.current.past.length > 0);
      setCanRedo(true);
      setError(null);
    } catch (err) {
      historyRef.current.past.push(action);
      setError(err instanceof Error ? err.message : "Could not undo");
    }
  }

  async function redo() {
    const action = historyRef.current.future.pop();
    if (!action) return;
    try {
      if (action.type === "add-node") {
        await restoreNodes([action.node]);
        setSteps((current) => [...current, action.node]);
        setNodes((current) => current.concat(toFlowNode(action.node, linkSource, selectedId)));
      } else if (action.type === "add-edge") {
        await restoreEdges([action.edge]);
        setEdges((current) => current.concat(toFlowEdge(action.edge)));
      } else if (action.type === "move") {
        await api(`/api/nodes/${action.id}`, { method: "PATCH", body: JSON.stringify(action.to) });
        setSteps((current) => current.map((step) => (step.id === action.id ? { ...step, ...action.to } : step)));
        setNodes((current) => current.map((node) => (node.id === action.id ? { ...node, position: action.to } : node)));
      } else if (action.type === "delete") {
        await Promise.all([
          ...action.nodes.map((node) => api(`/api/nodes/${node.id}`, { method: "DELETE" })),
          ...action.edges.map((edge) => api(`/api/edges/${edge.id}`, { method: "DELETE" })),
        ]);
        const removed = new Set(action.nodes.map((node) => node.id));
        setSteps((current) => current.filter((step) => !removed.has(step.id)));
        setNodes((current) => current.filter((node) => !removed.has(node.id)));
        setEdges((current) => current.filter((edge) => !action.edges.some((item) => item.id === edge.id)));
      } else if (action.type === "layout") {
        await api("/api/nodes/positions", { method: "POST", body: JSON.stringify({ positions: action.after }) });
        setSteps((current) =>
          current.map((step) => {
            const pos = action.after.find((item) => item.id === step.id);
            return pos ? { ...step, x: pos.x, y: pos.y } : step;
          }),
        );
        setNodes((current) =>
          current.map((node) => {
            const pos = action.after.find((item) => item.id === node.id);
            return pos ? { ...node, position: { x: pos.x, y: pos.y } } : node;
          }),
        );
      }
      historyRef.current.past.push(action);
      setCanUndo(true);
      setCanRedo(historyRef.current.future.length > 0);
      setError(null);
    } catch (err) {
      historyRef.current.future.push(action);
      setError(err instanceof Error ? err.message : "Could not redo");
    }
  }

  async function tidy() {
    setTidying(true);
    const before = stepsRef.current.map((step) => ({ id: step.id, x: step.x, y: step.y }));
    try {
      const data = await api<Bundle>(`${projectBundlePath(projectId)}/layout`, { method: "POST" });
      const after = data.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y }));
      record({ type: "layout", before, after });
      applyBundle(data, true);
      setError(null);
      window.requestAnimationFrame(() => {
        void fitView({ padding: 0.18, duration: 400, maxZoom: 1.15 });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not tidy the map");
    } finally {
      setTidying(false);
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        if (typing) return;
        event.preventDefault();
        if (event.shiftKey) void redo();
        else void undo();
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "?" || (event.shiftKey && event.key === "/")) {
        event.preventDefault();
        setHelp((current) => !current);
      } else if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        void addStep();
      } else if (event.key === "l" || event.key === "L") {
        event.preventDefault();
        setLinkMode((current) => !current);
        setLinkSource(null);
      } else if (event.key === "Escape") {
        setSelectedId(null);
        setLinkMode(false);
        setLinkSource(null);
        setHelp(false);
      } else if (event.key === "Enter") {
        const selectedNode = nodesRef.current.find((node) => node.selected);
        if (selectedNode) setSelectedId(selectedNode.id);
      } else if ((event.key === "Delete" || event.key === "Backspace") && !selectedId) {
        event.preventDefault();
        void deleteSelection();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function addTask(event: FormEvent) {
    event.preventDefault();
    try {
      const todo = await api<Todo>("/api/todos", {
        method: "POST",
        body: JSON.stringify({
          text: taskText,
          projectId,
          dueDate: taskDate || null,
          recurrence: taskRepeat,
          color: taskColor,
        }),
      });
      setTodos((current) => [todo, ...current]);
      clearTaskDraft();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the task");
    }
  }

  async function toggleTodo(todo: Todo) {
    const done = !todo.done;
    setTodos((current) => current.map((item) => (item.id === todo.id ? { ...item, done } : item)));
    try {
      await api(`/api/todos/${todo.id}`, { method: "PATCH", body: JSON.stringify({ done }) });
      invalidateLists();
      if (done && todo.recurrence && todo.recurrence !== "none") {
        const data = await cachedGet<Bundle>(projectBundlePath(projectId), { force: true });
        applyBundle(data, true);
      }
    } catch (err) {
      setTodos((current) => current.map((item) => (item.id === todo.id ? todo : item)));
      setError(err instanceof Error ? err.message : "Could not update the task");
    }
  }

  async function generatePlan(event: FormEvent) {
    event.preventDefault();
    if (!idea.trim() && !documentFile) {
      setError("Add an idea or upload a document");
      return;
    }
    setGenerating(true);
    try {
      const form = new FormData();
      form.append(
        "idea",
        idea.trim() ||
          "Build a detailed work plan from this assignment brief. Break every major requirement into its own step, including setup, features, testing, and submission.",
      );
      form.append("mode", mode);
      if (documentFile) form.append("document", documentFile);
      const data = await api<Bundle>(`/api/projects/${projectId}/generate`, {
        method: "POST",
        body: form,
      });
      applyBundle(data);
      invalidateLists();
      invalidateCached(projectBundlePath(projectId));
      putCached(projectBundlePath(projectId), data);
      setSelectedId(null);
      historyRef.current = { past: [], future: [] };
      setCanUndo(false);
      setCanRedo(false);
      clearGenerateDraft();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate a plan");
    } finally {
      setGenerating(false);
    }
  }

  async function refinePlan(instruction: RefineInstruction) {
    const labels: Record<RefineInstruction, string> = {
      more_detail: "Add more detail",
      compress: "Compress the plan",
      add_testing: "Add testing",
    };
    if (
      !confirm(
        `${labels[instruction]}? This replaces the current map and project tasks with a refined plan.`,
      )
    ) {
      return;
    }
    setGenerating(true);
    try {
      const data = await api<Bundle>(`/api/projects/${projectId}/refine`, {
        method: "POST",
        body: JSON.stringify({ instruction, mode }),
      });
      applyBundle(data);
      invalidateLists();
      invalidateCached(projectBundlePath(projectId));
      putCached(projectBundlePath(projectId), data);
      setSelectedId(null);
      historyRef.current = { past: [], future: [] };
      setCanUndo(false);
      setCanRedo(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refine the plan");
    } finally {
      setGenerating(false);
    }
  }

  async function archiveProject() {
    const next = project?.status === "archived" ? "active" : "archived";
    try {
      const updated = await api<{ status: string }>(`/api/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      setProject((current) => (current ? { ...current, status: updated.status } : current));
      invalidateLists();
      invalidateCached(projectBundlePath(projectId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the project");
    }
  }

  async function renameProject(event: FormEvent) {
    event.preventDefault();
    const title = projectNameDraft.trim();
    if (!title) {
      setError("Give the project a name");
      return;
    }
    if (title === project?.title) {
      setProjectMenuOpen(false);
      return;
    }
    setRenamingProject(true);
    try {
      const updated = await api<{ title: string }>(`/api/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      setProject((current) => (current ? { ...current, title: updated.title } : current));
      invalidateLists();
      invalidateCached(projectBundlePath(projectId));
      setProjectMenuOpen(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename the project");
    } finally {
      setRenamingProject(false);
    }
  }

  async function removeProject() {
    if (!confirm("Delete this project, its steps, and its tasks?")) return;
    try {
      await api(`/api/projects/${projectId}`, { method: "DELETE" });
      invalidateLists();
      invalidateCached(projectBundlePath(projectId));
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the project");
    }
  }

  if (missing) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <h1 className="text-3xl font-semibold">That project is not here.</h1>
        <Link href="/" transitionTypes={["nav-back"]} className="btn btn-primary mt-6">
          Back to today
        </Link>
      </main>
    );
  }

  return (
    <CanvasApiContext.Provider value={canvasApi}>
      <div className="canvas-shell flex h-[calc(100svh-4rem)] flex-col">
        <div className="app-header relative z-40 flex flex-wrap items-stretch border-b border-base-300 bg-base-100/95 backdrop-blur-md lg:flex-nowrap">
          <div className="mr-auto flex min-w-0 flex-1 items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <h1 className="flex items-center gap-2 truncate text-lg font-semibold">
                <span className="truncate">{project?.title ?? "Project"}</span>
                {project?.status === "archived" ? <span className="badge badge-ghost badge-sm">Archived</span> : null}
              </h1>
              <p className="text-xs text-base-content/60">
                {summary.percent}% · {summary.done} / {summary.total} steps
                {overdueCount ? <span className="text-warning"> · {overdueCount} overdue</span> : null}
                {linkMode ? (linkSource ? " · Tap the second step" : " · Tap the first step") : ""}
              </p>
            </div>
            {view === "board" ? (
              <button className="btn btn-primary btn-sm h-8 min-h-0 shrink-0" type="button" onClick={() => void addStep()} title="N">
                Add step
              </button>
            ) : null}
          </div>
          <div className="flex w-full shrink-0 items-center gap-2 px-4 py-2 max-lg:ml-auto max-lg:w-auto lg:w-80">
            <div className="flex h-8 items-stretch gap-0.5 rounded-lg border border-base-300 bg-base-100 p-0.5" role="tablist" aria-label="Project view">
              <button
                type="button"
                role="tab"
                aria-selected={view === "map"}
                className={`btn btn-sm h-full min-h-0 ${view === "map" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setView("map")}
              >
                Map
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "board"}
                className={`btn btn-sm h-full min-h-0 ${view === "board" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => {
                  setView("board");
                  setLinkMode(false);
                  setLinkSource(null);
                  setWheel(null);
                }}
              >
                Board
              </button>
            </div>
            <div className="relative ml-auto" ref={projectMenuRef}>
              <button
                type="button"
                className="btn btn-ghost btn-sm h-8 min-h-0 gap-1.5"
                aria-expanded={projectMenuOpen}
                aria-haspopup="menu"
                onClick={(event) => {
                  event.stopPropagation();
                  setProjectNameDraft(project?.title ?? "");
                  setProjectMenuOpen((current) => !current);
                }}
              >
                Project settings
                <svg
                  viewBox="0 0 24 24"
                  className={`h-3.5 w-3.5 shrink-0 opacity-60 transition-transform duration-200 ${projectMenuOpen ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden
                >
                  <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {projectMenuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-[calc(100%+0.4rem)] z-50 w-64 overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-xl"
                >
                  <form className="border-b border-base-300/80 p-3" onSubmit={(event) => void renameProject(event)}>
                    <label className="block text-[0.65rem] font-medium uppercase tracking-[0.12em] text-base-content/50">
                      Project name
                      <input
                        className="input input-sm mt-1.5 w-full"
                        value={projectNameDraft}
                        onChange={(event) => setProjectNameDraft(event.target.value)}
                        maxLength={120}
                        required
                        autoFocus
                      />
                    </label>
                    <button className="btn btn-primary btn-sm mt-2 w-full" type="submit" disabled={renamingProject}>
                      {renamingProject ? "Saving…" : "Save name"}
                    </button>
                  </form>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center px-3.5 py-2.5 text-left text-sm hover:bg-base-200"
                    onClick={() => {
                      setProjectMenuOpen(false);
                      void archiveProject();
                    }}
                  >
                    {project?.status === "archived" ? "Restore project" : "Archive project"}
                  </button>
                  <div className="mx-2 border-t border-base-300/80" />
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center px-3.5 py-2.5 text-left text-sm text-error hover:bg-error/10"
                    onClick={() => {
                      setProjectMenuOpen(false);
                      void removeProject();
                    }}
                  >
                    Delete project
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {error ? (
          <p className="bg-error/10 px-3 py-2 text-sm text-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div
            className="relative min-h-[60vh] flex-1 lg:min-h-0"
            onPointerDown={view === "map" ? onCanvasPointerDown : undefined}
            onContextMenu={view === "map" ? (event) => event.preventDefault() : undefined}
          >
            {view === "board" ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="min-h-0 flex-1">
                  <ProjectKanban
                    steps={steps}
                    edges={edges.map((edge) => ({
                      sourceNodeId: String(edge.source),
                      targetNodeId: String(edge.target),
                    }))}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onStatusChange={(id, status) => void patchStep(id, { status })}
                  />
                </div>
                {selectedId && steps.some((step) => step.id === selectedId) ? (
                  <div className="max-h-[42%] overflow-y-auto border-t border-base-300 bg-base-100 p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs uppercase tracking-wide text-base-content/50">Step details</p>
                      <button className="btn btn-ghost btn-xs" type="button" onClick={() => setSelectedId(null)}>
                        Close
                      </button>
                    </div>
                    <InlineEditor step={steps.find((step) => step.id === selectedId)!} />
                  </div>
                ) : null}
              </div>
            ) : null}
            {view === "map" && ready ? (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={nodeTypes}
                connectionMode={ConnectionMode.Loose}
                connectionLineType={ConnectionLineType.SmoothStep}
                nodesConnectable
                edgeTypes={edgeTypes}
                defaultEdgeOptions={{ type: "flow", style: { strokeWidth: 2 } }}
                onNodeClick={(event, node) => {
                  if (event.button !== 0) return;
                  const target = event.target as HTMLElement;
                  if (target.closest("[data-close-step], [data-step-editor]")) return;
                  onNodeClick(node.id);
                }}
                onPaneClick={() => {
                  setSelectedId(null);
                  setLinkMode(false);
                  setLinkSource(null);
                  closeWheel();
                }}
                onPaneContextMenu={(event) => event.preventDefault()}
                onNodeContextMenu={(event) => event.preventDefault()}
                onEdgeContextMenu={(event) => event.preventDefault()}
                onNodeDragStop={(_, node) => {
                  const previous = stepsRef.current.find((step) => step.id === node.id);
                  setSteps((current) =>
                    current.map((step) => (step.id === node.id ? { ...step, x: node.position.x, y: node.position.y } : step)),
                  );
                  if (previous && (previous.x !== node.position.x || previous.y !== node.position.y)) {
                    record({ type: "move", id: node.id, from: { x: previous.x, y: previous.y }, to: { x: node.position.x, y: node.position.y } });
                  }
                  void api(`/api/nodes/${node.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ x: node.position.x, y: node.position.y }),
                  }).catch(() => setError("Could not save the new position"));
                }}
                fitView
                fitViewOptions={{ padding: 0.18, maxZoom: 1.15, minZoom: 0.35 }}
                minZoom={0.35}
                maxZoom={1.8}
                onInit={(instance) => {
                  void instance.fitView({ padding: 0.18, maxZoom: 1.15, minZoom: 0.35 });
                }}
                colorMode={colorMode}
                deleteKeyCode={null}
              >
                <Background />
                <Controls />
                <MiniMap />
              </ReactFlow>
            ) : null}
            {view === "map" && !ready ? <p className="p-6 text-base-content/60">Loading the canvas…</p> : null}
            {view === "map" && rightDragLink ? (
              <svg className="pointer-events-none fixed inset-0 z-[4]" aria-hidden>
                <path
                  d={
                    getSmoothStepPath({
                      sourceX: rightDragLink.fromX,
                      sourceY: rightDragLink.fromY,
                      sourcePosition: rightDragLink.sourcePosition,
                      targetX: rightDragLink.toX,
                      targetY: rightDragLink.toY,
                      targetPosition: rightDragLink.targetPosition,
                      borderRadius: EDGE_CORNER,
                      offset: EDGE_OFFSET,
                    })[0]
                  }
                  fill="none"
                  className="react-flow__connection-path"
                  strokeWidth={2}
                />
              </svg>
            ) : null}
            {view === "map" && wheel ? (
              <CanvasWheel
                x={wheel.x}
                y={wheel.y}
                actions={wheelActions}
                hoveredId={hoveredWheelId}
                onClose={closeWheel}
              />
            ) : null}
            {view === "map" ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-3">
                <div
                  className={`pointer-events-auto flex max-w-full items-center overflow-hidden rounded-2xl border border-base-300 bg-base-100/95 shadow-lg backdrop-blur-md transition-[padding] duration-300 ease-out ${
                    toolsMinimized ? "gap-0 p-1" : "gap-1 p-1.5"
                  }`}
                  role="toolbar"
                  aria-label="Map tools"
                >
                  <div
                    className={`grid min-w-0 transition-[grid-template-columns] duration-300 ease-out ${
                      toolsMinimized ? "grid-cols-[0fr]" : "grid-cols-[1fr]"
                    }`}
                  >
                    <div className="min-w-0 overflow-hidden">
                      <div
                        className={`flex max-w-[min(100vw-5.5rem,42rem)] items-center gap-1 overflow-x-auto whitespace-nowrap transition-[opacity,transform] duration-300 ease-out ${
                          toolsMinimized ? "pointer-events-none -translate-y-1 opacity-0" : "translate-y-0 opacity-100"
                        }`}
                      >
                        <button className="btn btn-primary btn-sm" type="button" onClick={() => void addStep()} title="N">
                          Add step
                        </button>
                        <button
                          className={`btn btn-sm ${linkMode ? "btn-primary" : "btn-ghost"}`}
                          type="button"
                          title="L"
                          onClick={() => {
                            setLinkMode((current) => !current);
                            setLinkSource(null);
                          }}
                        >
                          Link
                        </button>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => void deleteSelection()} title="Delete">
                          Delete
                        </button>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => void undo()} disabled={!canUndo} title="⌘Z">
                          Undo
                        </button>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => void redo()} disabled={!canRedo} title="⇧⌘Z">
                          Redo
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => void tidy()}
                          disabled={tidying || steps.length === 0}
                          title="Tidy the map"
                        >
                          {tidying ? "Tidying…" : "Tidy map"}
                        </button>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => setHelp(true)} title="?">
                          Shortcuts
                        </button>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm shrink-0"
                    aria-expanded={!toolsMinimized}
                    aria-label={toolsMinimized ? "Show map tools" : "Hide map tools"}
                    title={toolsMinimized ? "Show tools" : "Hide tools"}
                    onClick={() => setToolsMinimized((current) => !current)}
                  >
                    {toolsMinimized ? (
                      <span className="inline-flex items-center gap-1.5">
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                          <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
                        </svg>
                        Tools
                      </span>
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            ) : null}
            {view === "map" && ready && steps.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center p-6">
                <div className="max-w-md rounded-lg border border-base-300 bg-base-100 p-4 shadow-sm">
                  <p className="text-base-content/70">Add a step to start the map, or generate a plan from an idea.</p>
                  {aiOn ? (
                    <form onSubmit={(event) => void generatePlan(event)} className="mt-3 grid gap-2.5">
                      <textarea
                        className="textarea w-full"
                        rows={3}
                        maxLength={500}
                        placeholder="e.g. Holiday starting next Monday, or weekly shopping from 12 November"
                        value={idea}
                        onChange={(event) => setGenerateDraft({ idea: event.target.value })}
                      />
                      <div className="flex items-end gap-2">
                        <div className="flex shrink-0 flex-col gap-1">
                          <button
                            type="button"
                            className={`btn btn-xs ${mode === "quick" ? "btn-primary" : "btn-ghost"}`}
                            onClick={() => setGenerateDraft({ mode: "quick" })}
                          >
                            Quick
                          </button>
                          <button
                            type="button"
                            className={`btn btn-xs ${mode === "thinking" ? "btn-primary" : "btn-ghost"}`}
                            onClick={() => setGenerateDraft({ mode: "thinking" })}
                          >
                            Thinking
                          </button>
                        </div>
                        <DocumentUpload
                          className="min-w-0 flex-1"
                          file={documentFile}
                          onChange={(file) => setGenerateDraft({ documentFile: file })}
                        />
                      </div>
                      <button className="btn btn-primary btn-sm" type="submit" disabled={generating}>
                        {generating ? "Planning…" : "Generate a plan"}
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          <aside className="panel w-full max-lg:max-h-[36vh] overflow-y-auto border-t border-base-300 bg-base-100 p-4 lg:w-80 lg:border-t-0 lg:border-l">
            {aiOn && steps.length > 0 ? (
              <section className="mb-5 rounded-lg border border-base-300 bg-base-200/40 p-3">
                <h2 className="text-sm font-semibold">Refine plan</h2>
                <p className="mt-1 text-xs text-base-content/60">
                  Rework the map with AI. Replaces the current steps and project tasks.
                </p>
                <div className="mt-2 flex gap-1.5">
                  <button
                    type="button"
                    className={`btn btn-xs ${mode === "quick" ? "btn-primary" : "btn-ghost border border-base-300 bg-base-100"}`}
                    disabled={generating}
                    onClick={() => setGenerateDraft({ mode: "quick" })}
                  >
                    Quick
                  </button>
                  <button
                    type="button"
                    className={`btn btn-xs ${mode === "thinking" ? "btn-primary" : "btn-ghost border border-base-300 bg-base-100"}`}
                    disabled={generating}
                    onClick={() => setGenerateDraft({ mode: "thinking" })}
                  >
                    Thinking
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    className="btn btn-ghost btn-xs border border-base-300 bg-base-100"
                    type="button"
                    disabled={generating}
                    onClick={() => void refinePlan("more_detail")}
                  >
                    More detail
                  </button>
                  <button
                    className="btn btn-ghost btn-xs border border-base-300 bg-base-100"
                    type="button"
                    disabled={generating}
                    onClick={() => void refinePlan("compress")}
                  >
                    Compress
                  </button>
                  <button
                    className="btn btn-ghost btn-xs border border-base-300 bg-base-100"
                    type="button"
                    disabled={generating}
                    onClick={() => void refinePlan("add_testing")}
                  >
                    Add testing
                  </button>
                </div>
                {generating ? <p className="mt-2 text-xs text-base-content/60">Working on the plan…</p> : null}
              </section>
            ) : null}
            <h2 className="text-lg font-semibold">Project tasks</h2>
            {project?.description ? <p className="mt-1 text-sm text-base-content/70">{project.description}</p> : null}
            <form onSubmit={(event) => void addTask(event)} className="mt-3 grid gap-2.5">
              <input
                className="input w-full"
                placeholder="Add a task"
                value={taskText}
                onChange={(event) => setTaskDraft({ taskText: event.target.value })}
                aria-label="Add a project task"
                required
              />
              <div className="flex gap-2">
                <input
                  className="input w-full"
                  type="date"
                  value={taskDate}
                  onChange={(event) => setTaskDraft({ taskDate: event.target.value })}
                  aria-label="Due date"
                />
                <select
                  className="select w-full"
                  value={taskRepeat}
                  onChange={(event) => setTaskDraft({ taskRepeat: event.target.value as Recurrence })}
                  aria-label="Repeat"
                >
                  {Object.entries(RECURRENCE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-2 mb-1">
                <ColorPicker value={taskColor} onChange={(taskColor) => setTaskDraft({ taskColor })} />
              </div>
              <button className="btn btn-primary btn-sm" type="submit">
                Add
              </button>
            </form>
            <ul className="mt-4 grid gap-2">
              {todos.length === 0 ? <li className="text-sm text-base-content/60">No tasks on this project yet.</li> : null}
              {todos.map((todo) => {
                const overdue = isOverdue({ done: todo.done, dueDate: todo.dueDate }, todayISO());
                return (
                  <li key={todo.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm mt-0.5"
                      checked={todo.done}
                      onChange={() => void toggleTodo(todo)}
                      aria-label={todo.text}
                    />
                    <ColorDot color={todo.color} />
                    <span className={todo.done ? "text-base-content/50 line-through" : ""}>
                      {todo.text}
                      {todo.recurrence && todo.recurrence !== "none" ? <span className="ml-1 text-xs text-primary">repeat</span> : null}
                      {todo.dueDate ? (
                        <span className={`mt-0.5 block text-xs ${overdue ? "text-warning" : "text-base-content/50"}`}>
                          {todo.dueDate}
                          {overdue ? " · Overdue" : ""}
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </aside>
        </div>
        {help ? (
          <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setHelp(false)}>
            <div className="w-full max-w-sm rounded-lg bg-base-100 p-4" onClick={(event) => event.stopPropagation()}>
              <h2 className="text-lg font-semibold">Canvas shortcuts</h2>
              <ul className="mt-3 grid gap-1 text-sm">
                <li>Click a step to open it on the canvas</li>
                <li>N — new step</li>
                <li>L — link mode (or drag between the dots)</li>
                <li>⌘Z / Ctrl+Z — undo</li>
                <li>⇧⌘Z — redo</li>
                <li>Delete / Backspace — remove selected step or link</li>
                <li>Hold right-click — action wheel; hover a step to target it for link/delete</li>
                <li>Right-click drag from one step onto another — same link line as the dots; release to connect</li>
                <li>Esc — close the open step</li>
                <li>? — this list</li>
              </ul>
              <button className="btn btn-primary btn-sm mt-4" type="button" onClick={() => setHelp(false)}>
                Close
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </CanvasApiContext.Provider>
  );
}

function InlineEditor({ step }: { step: FlowNode }) {
  const { patchStep, patchChecklist, setError } = useCanvasApi();
  const [title, setTitle] = useState(step.title);
  const [description, setDescription] = useState(step.description);
  const [notes, setNotes] = useState(step.notes);
  const [checkText, setCheckText] = useState("");
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTitle(step.title);
    setDescription(step.description);
    setNotes(step.notes);
  }, [step.id, step.title, step.description, step.notes]);

  useEffect(() => {
    return () => {
      if (notesTimer.current) clearTimeout(notesTimer.current);
    };
  }, []);

  async function addCheck(event: FormEvent) {
    event.preventDefault();
    try {
      const item = await api<ChecklistItem>("/api/checklist", {
        method: "POST",
        body: JSON.stringify({ nodeId: step.id, text: checkText }),
      });
      patchChecklist(step.id, [...step.checklist, item]);
      setCheckText("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the checklist item");
    }
  }

  function sortChecklist(items: ChecklistItem[]) {
    return [...items].sort((left, right) => Number(left.done) - Number(right.done));
  }

  async function toggleCheck(item: ChecklistItem) {
    const done = !item.done;
    const next = sortChecklist(step.checklist.map((entry) => (entry.id === item.id ? { ...entry, done } : entry)));
    patchChecklist(step.id, next);
    try {
      await api(`/api/checklist/${item.id}`, { method: "PATCH", body: JSON.stringify({ done }) });
      setError(null);
    } catch (err) {
      patchChecklist(step.id, step.checklist);
      setError(err instanceof Error ? err.message : "Could not update the checklist");
    }
  }

  async function removeCheck(item: ChecklistItem) {
    patchChecklist(
      step.id,
      step.checklist.filter((entry) => entry.id !== item.id),
    );
    try {
      await api(`/api/checklist/${item.id}`, { method: "DELETE" });
      setError(null);
    } catch (err) {
      patchChecklist(step.id, step.checklist);
      setError(err instanceof Error ? err.message : "Could not remove the checklist item");
    }
  }

  return (
    <div>
      <label className="block text-sm">
        Title
        <input
          className="input mt-1 w-full"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            const next = title.trim();
            if (next && next !== step.title) void patchStep(step.id, { title: next });
            else setTitle(step.title);
          }}
        />
      </label>
      <label className="mt-3 block text-sm">
        Description
        <textarea
          className="textarea mt-1 w-full"
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => {
            if (description !== step.description) void patchStep(step.id, { description });
          }}
        />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-sm">
          Status
          <select
            className="select mt-1 w-full"
            value={step.status}
            onChange={(event) => void patchStep(step.id, { status: event.target.value as NodeStatus })}
          >
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Importance
          <select
            className="select mt-1 w-full"
            value={step.importance}
            onChange={(event) => void patchStep(step.id, { importance: event.target.value as Importance })}
          >
            {Object.entries(IMPORTANCE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-sm">
          Due date
          <input
            className="input mt-1 w-full"
            type="date"
            value={step.dueDate ?? ""}
            onChange={(event) => void patchStep(step.id, { dueDate: event.target.value || null })}
          />
        </label>
        <label className="text-sm">
          Repeat
          <select
            className="select mt-1 w-full"
            value={step.recurrence ?? "none"}
            onChange={(event) => void patchStep(step.id, { recurrence: event.target.value as FlowNode["recurrence"] })}
          >
            {Object.entries(RECURRENCE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="mt-3 block text-sm">
        Notes
        <textarea
          className="textarea mt-1 w-full"
          rows={4}
          value={notes}
          onChange={(event) => {
            const next = event.target.value;
            setNotes(next);
            if (notesTimer.current) clearTimeout(notesTimer.current);
            notesTimer.current = setTimeout(() => void patchStep(step.id, { notes: next }), 400);
          }}
        />
      </label>
      <h3 className="mt-4 text-sm font-semibold">Checklist</h3>
      <ul className="mt-2 grid gap-2">
        {sortChecklist(step.checklist).map((item) => (
          <li key={item.id} className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="checkbox checkbox-sm mt-0.5" checked={item.done} onChange={() => void toggleCheck(item)} aria-label={item.text} />
            <span className={`flex-1 ${item.done ? "text-base-content/50 line-through" : ""}`}>{item.text}</span>
            <button className="btn btn-ghost btn-xs" type="button" onClick={() => void removeCheck(item)} aria-label={`Remove ${item.text}`}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={(event) => void addCheck(event)} className="mt-2 flex gap-2">
        <input
          className="input w-full"
          placeholder="Add a checklist item"
          value={checkText}
          onChange={(event) => setCheckText(event.target.value)}
          aria-label="Add a checklist item"
          required
        />
        <button className="btn btn-sm" type="submit">
          Add
        </button>
      </form>
    </div>
  );
}
