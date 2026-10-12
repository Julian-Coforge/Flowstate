"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "@/lib/api";
import { IMPORTANCE_LABEL, STATUS_LABEL } from "@/lib/labels";
import { progress } from "@/lib/progress";
import type { ChecklistItem, FlowEdge, FlowNode, Importance, NodeStatus, Todo } from "@/lib/types";

type StepData = {
  title: string;
  status: NodeStatus;
  importance: Importance;
  linking?: boolean;
};

type StepNode = Node<StepData, "step">;

type Bundle = {
  project: { id: string; title: string; description: string };
  nodes: FlowNode[];
  edges: FlowEdge[];
  todos: Todo[];
  progress: { done: number; total: number; percent: number };
};

type NodePatch = Partial<Pick<FlowNode, "title" | "description" | "importance" | "notes" | "status" | "x" | "y">>;

function StepCard({ data }: NodeProps<StepNode>) {
  const border =
    data.status === "done" ? "border-success" : data.status === "doing" ? "border-primary" : "border-base-300";
  return (
    <div
      className={`w-44 rounded-md border-2 bg-white px-3 py-2 shadow-sm ${border} ${data.linking ? "ring-2 ring-primary ring-offset-2" : ""}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="text-sm font-semibold leading-snug">{data.title}</div>
      <div className="mt-1 text-[11px] uppercase tracking-wide text-base-content/50">{STATUS_LABEL[data.status]}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { step: StepCard };

function toFlowNode(step: FlowNode, linkingId: string | null): StepNode {
  return {
    id: step.id,
    type: "step",
    position: { x: step.x, y: step.y },
    data: {
      title: step.title,
      status: step.status,
      importance: step.importance,
      linking: step.id === linkingId,
    },
  };
}

function toFlowEdge(edge: FlowEdge): Edge {
  return { id: edge.id, source: edge.sourceNodeId, target: edge.targetNodeId };
}

export default function ProjectCanvas({ projectId }: { projectId: string }) {
  return (
    <ReactFlowProvider>
      <Canvas projectId={projectId} />
    </ReactFlowProvider>
  );
}

function Canvas({ projectId }: { projectId: string }) {
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
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  useEffect(() => {
    let cancelled = false;
    api<Bundle>(`/api/projects/${projectId}`)
      .then((data) => {
        if (cancelled) return;
        setProject(data.project);
        setSteps(data.nodes);
        setTodos(data.todos);
        setNodes(data.nodes.map((node) => toFlowNode(node, null)));
        setEdges(data.edges.map(toFlowEdge));
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
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, linking: node.id === linkSource } })));
  }, [linkSource, setNodes]);

  const summary = useMemo(() => progress(steps), [steps]);
  const selected = steps.find((step) => step.id === selectedId) ?? null;

  const patchStep = useCallback(
    async (id: string, patch: NodePatch) => {
      setSteps((current) => current.map((step) => (step.id === id ? { ...step, ...patch } : step)));
      setNodes((current) =>
        current.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  title: patch.title ?? node.data.title,
                  status: patch.status ?? node.data.status,
                  importance: patch.importance ?? node.data.importance,
                },
              }
            : node,
        ),
      );
      try {
        await api(`/api/nodes/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save the step");
      }
    },
    [setNodes],
  );

  async function addStep() {
    const position = {
      x: 80 + (steps.length % 4) * 210,
      y: 80 + Math.floor(steps.length / 4) * 140,
    };
    try {
      const created = await api<FlowNode>("/api/nodes", {
        method: "POST",
        body: JSON.stringify({ projectId, title: "New step", x: position.x, y: position.y }),
      });
      setSteps((current) => [...current, created]);
      setNodes((current) => current.concat(toFlowNode(created, linkSource)));
      setSelectedId(created.id);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add a step");
    }
  }

  async function createLink(source: string, target: string) {
    try {
      const edge = await api<FlowEdge>("/api/edges", {
        method: "POST",
        body: JSON.stringify({ projectId, sourceNodeId: source, targetNodeId: target }),
      });
      setEdges((current) => current.concat(toFlowEdge(edge)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link those steps");
    }
  }

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      void createLink(connection.source, connection.target);
    },
    [projectId],
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
    try {
      await Promise.all([
        ...selectedNodes.map((id) => api(`/api/nodes/${id}`, { method: "DELETE" })),
        ...edgesToDelete.map((edge) => api(`/api/edges/${edge.id}`, { method: "DELETE" })),
      ]);
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

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "n" || event.key === "N") {
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
        body: JSON.stringify({ text: taskText, projectId, dueDate: null }),
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
    } catch (err) {
      setTodos((current) => current.map((item) => (item.id === todo.id ? todo : item)));
      setError(err instanceof Error ? err.message : "Could not update the task");
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
    <div className="flex h-[calc(100svh-4rem)] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-base-300 bg-base-100 px-3 py-2">
        <div className="mr-auto min-w-0">
          <h1 className="truncate text-lg font-semibold">{project?.title ?? "Project"}</h1>
          <p className="text-xs text-base-content/60">
            {summary.percent}% · {summary.done} / {summary.total} steps
            {linkMode ? (linkSource ? " · Choose the second step" : " · Choose the first step") : ""}
          </p>
        </div>
        <button className="btn btn-primary btn-sm" type="button" onClick={() => void addStep()}>
          Add step
        </button>
        <button
          className={`btn btn-sm ${linkMode ? "btn-primary" : "btn-ghost"}`}
          type="button"
          onClick={() => {
            setLinkMode((current) => !current);
            setLinkSource(null);
          }}
        >
          Link
        </button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => void deleteSelection()}>
          Delete
        </button>
        <button className="btn btn-ghost btn-sm text-error" type="button" onClick={() => void removeProject()}>
          Delete project
        </button>
      </div>
      <p className="border-b border-base-300 bg-base-100 px-3 py-1 text-xs text-base-content/50">
        N new step · L link · Delete remove · Enter open · Esc close. Drag between the dots to link.
      </p>
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
              onNodeClick={(_, node) => onNodeClick(node.id)}
              onPaneClick={() => {
                setSelectedId(null);
                setLinkMode(false);
                setLinkSource(null);
              }}
              onNodeDragStop={(_, node) => {
                setSteps((current) =>
                  current.map((step) => (step.id === node.id ? { ...step, x: node.position.x, y: node.position.y } : step)),
                );
                void api(`/api/nodes/${node.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ x: node.position.x, y: node.position.y }),
                }).catch(() => setError("Could not save the new position"));
              }}
              fitView
              colorMode="light"
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
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-base-content/60">
              Add a step to start the map.
            </p>
          ) : null}
        </div>
        <aside className="w-full overflow-y-auto border-t border-base-300 bg-base-100 p-4 lg:w-80 lg:border-t-0 lg:border-l">
          {selected ? (
            <StepDetail
              step={selected}
              onClose={() => setSelectedId(null)}
              onPatch={(patch) => void patchStep(selected.id, patch)}
              onChecklist={(checklist) =>
                setSteps((current) => current.map((step) => (step.id === selected.id ? { ...step, checklist } : step)))
              }
              onError={setError}
            />
          ) : (
            <div>
              <h2 className="text-lg font-semibold">Project tasks</h2>
              {project?.description ? <p className="mt-1 text-sm text-base-content/70">{project.description}</p> : null}
              <form onSubmit={(event) => void addTask(event)} className="mt-3 flex gap-2">
                <input
                  className="input w-full"
                  placeholder="Add a task"
                  value={taskText}
                  onChange={(event) => setTaskText(event.target.value)}
                  aria-label="Add a project task"
                  required
                />
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
                    <span className={todo.done ? "text-base-content/50 line-through" : ""}>{todo.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function StepDetail({
  step,
  onClose,
  onPatch,
  onChecklist,
  onError,
}: {
  step: FlowNode;
  onClose: () => void;
  onPatch: (patch: NodePatch) => void;
  onChecklist: (items: ChecklistItem[]) => void;
  onError: (message: string | null) => void;
}) {
  const [title, setTitle] = useState(step.title);
  const [description, setDescription] = useState(step.description);
  const [notes, setNotes] = useState(step.notes);
  const [checkText, setCheckText] = useState("");
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTitle(step.title);
    setDescription(step.description);
    setNotes(step.notes);
    return () => {
      if (notesTimer.current) clearTimeout(notesTimer.current);
    };
    // Drafts reset only when a different step is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id]);

  async function addCheck(event: FormEvent) {
    event.preventDefault();
    try {
      const item = await api<ChecklistItem>("/api/checklist", {
        method: "POST",
        body: JSON.stringify({ nodeId: step.id, text: checkText }),
      });
      onChecklist([...step.checklist, item]);
      setCheckText("");
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not add the checklist item");
    }
  }

  async function toggleCheck(item: ChecklistItem) {
    const done = !item.done;
    onChecklist(step.checklist.map((entry) => (entry.id === item.id ? { ...entry, done } : entry)));
    try {
      await api(`/api/checklist/${item.id}`, { method: "PATCH", body: JSON.stringify({ done }) });
      onError(null);
    } catch (err) {
      onChecklist(step.checklist);
      onError(err instanceof Error ? err.message : "Could not update the checklist");
    }
  }

  return (
    <div>
      <button className="btn btn-ghost btn-xs mb-2 px-0" type="button" onClick={onClose}>
        Back to tasks
      </button>
      <label className="block text-sm">
        Title
        <input
          className="input mt-1 w-full"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            const next = title.trim();
            if (next && next !== step.title) onPatch({ title: next });
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
            if (description !== step.description) onPatch({ description });
          }}
        />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-sm">
          Status
          <select
            className="select mt-1 w-full"
            value={step.status}
            onChange={(event) => onPatch({ status: event.target.value as NodeStatus })}
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
            onChange={(event) => onPatch({ importance: event.target.value as Importance })}
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
        Notes
        <textarea
          className="textarea mt-1 w-full"
          rows={5}
          value={notes}
          onChange={(event) => {
            const next = event.target.value;
            setNotes(next);
            if (notesTimer.current) clearTimeout(notesTimer.current);
            notesTimer.current = setTimeout(() => onPatch({ notes: next }), 400);
          }}
        />
      </label>
      <h3 className="mt-4 text-sm font-semibold">Checklist</h3>
      <ul className="mt-2 grid gap-2">
        {step.checklist.map((item) => (
          <li key={item.id} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="checkbox checkbox-sm mt-0.5"
              checked={item.done}
              onChange={() => void toggleCheck(item)}
              aria-label={item.text}
            />
            <span className={item.done ? "text-base-content/50 line-through" : ""}>{item.text}</span>
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
