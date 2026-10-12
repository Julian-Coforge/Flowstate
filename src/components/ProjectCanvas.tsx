"use client";

import { FormEvent, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  useEdgesState,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import ColorPicker, { ColorDot } from "@/components/ColorPicker";
import { api } from "@/lib/api";
import { inferHandles } from "@/lib/layout";
import { IMPORTANCE_LABEL, RECURRENCE_LABEL, STATUS_LABEL } from "@/lib/labels";
import { progress } from "@/lib/progress";
import { readTheme } from "@/lib/theme";
import type { ChecklistItem, FlowEdge, FlowNode, Importance, NodeStatus, Recurrence, TaskColor, Todo } from "@/lib/types";

type NodePatch = Partial<Pick<FlowNode, "title" | "description" | "importance" | "notes" | "status" | "x" | "y" | "dueDate">>;

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
  step?: FlowNode;
};

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

  const border =
    data.status === "done" ? "border-success" : data.status === "doing" ? "border-primary" : "border-base-300";

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
      {data.step?.dueDate ? <div className="mt-1 text-[11px] text-base-content/50">{data.step.dueDate}</div> : null}
    </div>
  );
}

const nodeTypes = { step: StepCard };

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

function toFlowEdge(edge: FlowEdge): Edge {
  return {
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
    type: "default",
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
  const { fitView } = useReactFlow();
  const [project, setProject] = useState<Bundle["project"] | null>(null);
  const [steps, setSteps] = useState<FlowNode[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskText, setTaskText] = useState("");
  const [taskDate, setTaskDate] = useState("");
  const [taskRepeat, setTaskRepeat] = useState<Recurrence>("none");
  const [taskColor, setTaskColor] = useState<TaskColor>("none");
  const [help, setHelp] = useState(false);
  const [colorMode, setColorMode] = useState<"light" | "dark">("light");
  const [aiOn, setAiOn] = useState(false);
  const [idea, setIdea] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"quick" | "thinking">("quick");
  const [generating, setGenerating] = useState(false);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const stepsRef = useRef(steps);
  const historyRef = useRef<{ past: HistoryAction[]; future: HistoryAction[] }>({ past: [], future: [] });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [tidying, setTidying] = useState(false);
  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
    stepsRef.current = steps;
  }, [nodes, edges, steps]);

  function record(action: HistoryAction) {
    historyRef.current.past = [...historyRef.current.past.slice(-49), action];
    historyRef.current.future = [];
    setCanUndo(true);
    setCanRedo(false);
  }

  useEffect(() => {
    setColorMode(readTheme());
    api<{ enabled: boolean }>("/api/ai/status")
      .then((data) => setAiOn(data.enabled))
      .catch(() => setAiOn(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<Bundle>(`/api/projects/${projectId}`)
      .then((data) => {
        if (cancelled) return;
        setProject(data.project);
        setSteps(data.nodes);
        setTodos(data.todos);
        setNodes(data.nodes.map((node) => toFlowNode(node, null, null)));
        setEdges(data.edges.map((edge) => toFlowEdge(edge)));
        setReady(true);
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
            linking: node.id === linkSource,
            expanded,
            step,
          },
        };
      }),
    );
  }, [steps, selectedId, linkSource, setNodes]);

  useEffect(() => {
    if (!ready || !selectedId) return;
    const frame = window.requestAnimationFrame(() => {
      void fitView({ nodes: [{ id: selectedId }], padding: 0.14, duration: 420, maxZoom: 1.75 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedId, ready, fitView]);

  const summary = useMemo(() => progress(steps), [steps]);

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
    setProject(data.project);
    setSteps(data.nodes);
    setTodos(data.todos);
    setNodes(data.nodes.map((node) => toFlowNode(node, keepSelected ? linkSource : null, keepSelected ? selectedId : null)));
    setEdges(data.edges.map(toFlowEdge));
  }

  async function addStep() {
    const position = {
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

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      void createLink(connection.source, connection.target, connection.sourceHandle, connection.targetHandle);
    },
    [createLink],
  );

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
  }

  async function deleteSelection() {
    const selectedNodes = nodesRef.current.filter((node) => node.selected).map((node) => node.id);
    const selectedEdges = edgesRef.current.filter((edge) => edge.selected);
    const removedNodes = new Set(selectedNodes);
    const edgesToDelete = selectedEdges.filter((edge) => !removedNodes.has(edge.source) && !removedNodes.has(edge.target));
    if (selectedNodes.length === 0 && edgesToDelete.length === 0) return;
    const removedNodeSet = new Set(selectedNodes);
    const snapshotNodes = stepsRef.current.filter((step) => removedNodeSet.has(step.id));
    const snapshotEdges = (edgesRef.current
      .filter((edge) => edge.selected || removedNodeSet.has(edge.source) || removedNodeSet.has(edge.target))
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
        const data = await api<Bundle>(`/api/projects/${projectId}`);
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
      const data = await api<Bundle>(`/api/projects/${projectId}/layout`, { method: "POST" });
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
      setTaskText("");
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
      if (done && todo.recurrence && todo.recurrence !== "none") {
        const data = await api<Bundle>(`/api/projects/${projectId}`);
        setTodos(data.todos);
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
      setSelectedId(null);
      setIdea("");
      setDocumentFile(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate a plan");
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
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the project");
    }
  }

  async function removeProject() {
    if (!confirm("Delete this project, its steps, and its tasks?")) return;
    try {
      await api(`/api/projects/${projectId}`, { method: "DELETE" });
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the project");
    }
  }

  if (missing) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <h1 className="text-3xl font-semibold">That project is not here.</h1>
        <Link href="/" className="btn btn-primary mt-6">
          Back to today
        </Link>
      </main>
    );
  }

  return (
    <CanvasApiContext.Provider value={canvasApi}>
      <div className="flex h-[calc(100svh-4rem)] flex-col">
        <div className="flex flex-wrap items-center gap-2 overflow-x-auto border-b border-base-300 bg-base-100 px-3 py-2">
          <div className="mr-auto min-w-0">
            <h1 className="flex items-center gap-2 truncate text-lg font-semibold">
              <span className="truncate">{project?.title ?? "Project"}</span>
              {project?.status === "archived" ? <span className="badge badge-ghost badge-sm">Archived</span> : null}
            </h1>
            <p className="text-xs text-base-content/60">
              {summary.percent}% · {summary.done} / {summary.total} steps
              {linkMode ? (linkSource ? " · Tap the second step" : " · Tap the first step") : ""}
            </p>
          </div>
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
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void tidy()} disabled={tidying || steps.length === 0} title="Tidy the map">
            {tidying ? "Tidying…" : "Tidy map"}
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setHelp(true)} title="?">
            Shortcuts
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void archiveProject()}>
            {project?.status === "archived" ? "Restore" : "Archive"}
          </button>
          <button className="btn btn-ghost btn-sm text-error" type="button" onClick={() => void removeProject()}>
            Delete project
          </button>
        </div>
        {error ? (
          <p className="bg-error/10 px-3 py-2 text-sm text-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="relative min-h-[60vh] flex-1 lg:min-h-0">
            {ready ? (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={nodeTypes}
                connectionMode={ConnectionMode.Loose}
                connectionLineType={ConnectionLineType.Bezier}
                defaultEdgeOptions={{ type: "default", style: { strokeWidth: 2 } }}
                onNodeClick={(event, node) => {
                  const target = event.target as HTMLElement;
                  if (target.closest("[data-close-step], [data-step-editor]")) return;
                  onNodeClick(node.id);
                }}
                onPaneClick={() => {
                  setSelectedId(null);
                  setLinkMode(false);
                  setLinkSource(null);
                }}
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
            ) : (
              <p className="p-6 text-base-content/60">Loading the canvas…</p>
            )}
            {ready && steps.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center p-6">
                <div className="max-w-md rounded-lg border border-base-300 bg-base-100 p-4 shadow-sm">
                  <p className="text-base-content/70">Add a step to start the map, or generate a plan from an idea.</p>
                  {aiOn ? (
                    <form onSubmit={(event) => void generatePlan(event)} className="mt-3 grid gap-2">
                      <textarea
                        className="textarea w-full"
                        rows={3}
                        maxLength={500}
                        placeholder="e.g. Holiday starting next Monday, or weekly shopping from 12 November"
                        value={idea}
                        onChange={(event) => setIdea(event.target.value)}
                      />
                      <input
                        className="file-input file-input-bordered file-input-sm w-full"
                        type="file"
                        accept=".txt,.md,.markdown,.csv,.pdf,.docx,text/plain,application/pdf"
                        onChange={(event) => setDocumentFile(event.target.files?.[0] ?? null)}
                        aria-label="Upload a document for the plan"
                      />
                      {documentFile ? <p className="text-xs text-base-content/60">{documentFile.name}</p> : null}
                      <div className="flex gap-2">
                        <button type="button" className={`btn btn-sm ${mode === "quick" ? "btn-primary" : ""}`} onClick={() => setMode("quick")}>
                          Quick
                        </button>
                        <button type="button" className={`btn btn-sm ${mode === "thinking" ? "btn-primary" : ""}`} onClick={() => setMode("thinking")}>
                          Thinking
                        </button>
                        <button className="btn btn-primary btn-sm ml-auto" type="submit" disabled={generating}>
                          {generating ? "Planning…" : "Generate a plan"}
                        </button>
                      </div>
                    </form>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          <aside className="w-full max-lg:max-h-[36vh] overflow-y-auto border-t border-base-300 bg-base-100 p-4 lg:w-80 lg:border-t-0 lg:border-l">
            <h2 className="text-lg font-semibold">Project tasks</h2>
            {project?.description ? <p className="mt-1 text-sm text-base-content/70">{project.description}</p> : null}
            <form onSubmit={(event) => void addTask(event)} className="mt-3 grid gap-2">
              <input
                className="input w-full"
                placeholder="Add a task"
                value={taskText}
                onChange={(event) => setTaskText(event.target.value)}
                aria-label="Add a project task"
                required
              />
              <div className="flex gap-2">
                <input className="input w-full" type="date" value={taskDate} onChange={(event) => setTaskDate(event.target.value)} aria-label="Due date" />
                <select className="select w-full" value={taskRepeat} onChange={(event) => setTaskRepeat(event.target.value as Recurrence)} aria-label="Repeat">
                  {Object.entries(RECURRENCE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <ColorPicker value={taskColor} onChange={setTaskColor} />
              <button className="btn btn-primary btn-sm" type="submit">
                Add
              </button>
            </form>
            <ul className="mt-4 grid gap-2">
              {todos.length === 0 ? <li className="text-sm text-base-content/60">No tasks on this project yet.</li> : null}
              {todos.map((todo) => (
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
                    {todo.dueDate ? <span className="mt-0.5 block text-xs text-base-content/50">{todo.dueDate}</span> : null}
                  </span>
                </li>
              ))}
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

  async function toggleCheck(item: ChecklistItem) {
    const done = !item.done;
    patchChecklist(
      step.id,
      step.checklist.map((entry) => (entry.id === item.id ? { ...entry, done } : entry)),
    );
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
      <label className="mt-3 block text-sm">
        Due date
        <input
          className="input mt-1 w-full"
          type="date"
          value={step.dueDate ?? ""}
          onChange={(event) => void patchStep(step.id, { dueDate: event.target.value || null })}
        />
      </label>
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
        {step.checklist.map((item) => (
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
