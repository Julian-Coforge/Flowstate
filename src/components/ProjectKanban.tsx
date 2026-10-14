"use client";

import { DragEvent, useMemo, useState } from "react";
import { IMPORTANCE_LABEL, RECURRENCE_LABEL, STATUS_LABEL } from "@/lib/labels";
import { isOverdue, todayISO } from "@/lib/tasks";
import type { FlowNode, NodeStatus } from "@/lib/types";

type KanbanColumnId = "todo" | "doing" | "done" | "overdue";

type Link = { sourceNodeId: string; targetNodeId: string };

type Props = {
  steps: FlowNode[];
  edges: Link[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onStatusChange: (id: string, status: NodeStatus) => void;
};

const COLUMNS: { id: KanbanColumnId; label: string }[] = [
  { id: "todo", label: STATUS_LABEL.todo },
  { id: "doing", label: STATUS_LABEL.doing },
  { id: "done", label: STATUS_LABEL.done },
  { id: "overdue", label: "Overdue" },
];

function columnForStep(step: FlowNode, today: string, overdueIds: Set<string>): KanbanColumnId {
  if (step.status === "done") return "done";
  if (overdueIds.has(step.id)) return "overdue";
  if (step.status === "doing") return "doing";
  return "todo";
}

export default function ProjectKanban({ steps, edges, selectedId, onSelect, onStatusChange }: Props) {
  const today = useMemo(() => todayISO(), []);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<KanbanColumnId | null>(null);

  const { overdueIds, atRiskIds } = useMemo(() => {
    const overdue = new Set(
      steps.filter((step) => isOverdue({ status: step.status, dueDate: step.dueDate }, today)).map((step) => step.id),
    );
    const atRisk = new Set<string>();
    const byId = new Map(steps.map((step) => [step.id, step]));
    for (const edge of edges) {
      if (overdue.has(edge.sourceNodeId) && !overdue.has(edge.targetNodeId)) {
        const target = byId.get(edge.targetNodeId);
        if (target && target.status !== "done") atRisk.add(edge.targetNodeId);
      }
    }
    return { overdueIds: overdue, atRiskIds: atRisk };
  }, [steps, edges, today]);

  const buckets = useMemo(() => {
    const map: Record<KanbanColumnId, FlowNode[]> = { todo: [], doing: [], done: [], overdue: [] };
    for (const step of steps) {
      map[columnForStep(step, today, overdueIds)].push(step);
    }
    return map;
  }, [steps, today, overdueIds]);

  function onDragStart(event: DragEvent, id: string) {
    event.dataTransfer.setData("text/step-id", id);
    event.dataTransfer.effectAllowed = "move";
    setDraggingId(id);
  }

  function onDragEnd() {
    setDraggingId(null);
    setDropTarget(null);
  }

  function onDrop(column: KanbanColumnId) {
    const id = draggingId;
    setDraggingId(null);
    setDropTarget(null);
    if (!id) return;
    const step = steps.find((item) => item.id === id);
    if (!step) return;

    if (column === "overdue") return;
    if (column === step.status) return;
    if (column === "todo" || column === "doing" || column === "done") {
      onStatusChange(id, column);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3">
      <p className="text-xs text-base-content/60">Drag a step between columns to change its status. Overdue is based on due dates.</p>
      <div className="grid min-h-0 flex-1 gap-3 overflow-x-auto md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((column) => {
          const items = buckets[column.id];
          const active = dropTarget === column.id;
          return (
            <section
              key={column.id}
              className={`flex min-h-0 min-w-[14rem] flex-col rounded-lg border bg-base-200/40 ${
                column.id === "overdue" ? "border-warning/40" : "border-base-300"
              } ${active ? "ring-2 ring-primary/40" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                if (column.id !== "overdue") setDropTarget(column.id);
              }}
              onDragLeave={() => setDropTarget((current) => (current === column.id ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                onDrop(column.id);
              }}
            >
              <header className="flex items-center justify-between gap-2 border-b border-base-300 px-3 py-2">
                <h2 className={`text-sm font-semibold ${column.id === "overdue" ? "text-warning" : ""}`}>{column.label}</h2>
                <span className="badge badge-ghost badge-sm">{items.length}</span>
              </header>
              <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
                {items.length === 0 ? (
                  <li className="px-1 py-6 text-center text-xs text-base-content/45">Nothing here</li>
                ) : null}
                {items.map((step) => {
                  const overdue = overdueIds.has(step.id);
                  const atRisk = atRiskIds.has(step.id);
                  // In progress + at risk → at-risk colour only (not the usual doing accent).
                  const tone =
                    overdue || column.id === "overdue"
                      ? "border-warning bg-warning/5"
                      : atRisk
                        ? "border-warning/60 bg-warning/5"
                        : step.status === "done"
                          ? "border-success/50 bg-base-100"
                          : step.status === "doing" && !atRisk
                            ? "border-primary/40 bg-base-100"
                            : "border-base-300 bg-base-100";
                  const selected = selectedId === step.id;
                  const checks = step.checklist ?? [];
                  const checksDone = checks.filter((item) => item.done).length;
                  return (
                    <li key={step.id}>
                      <button
                        type="button"
                        draggable
                        onDragStart={(event) => onDragStart(event, step.id)}
                        onDragEnd={onDragEnd}
                        onClick={() => onSelect(selected ? null : step.id)}
                        className={`w-full rounded-md border-2 p-2.5 text-left shadow-sm transition ${tone} ${
                          selected ? "ring-2 ring-primary ring-offset-1 ring-offset-base-100" : "hover:bg-base-200/60"
                        } ${draggingId === step.id ? "opacity-60" : ""}`}
                      >
                        <div className="text-sm font-semibold leading-snug">{step.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-base-content/55">
                          <span>{IMPORTANCE_LABEL[step.importance]}</span>
                          {step.dueDate ? (
                            <span className={overdue ? "font-medium text-warning" : ""}>{step.dueDate}</span>
                          ) : null}
                          {step.recurrence && step.recurrence !== "none" ? (
                            <span className="text-primary">{RECURRENCE_LABEL[step.recurrence]}</span>
                          ) : null}
                        </div>
                        {overdue ? <div className="mt-1 text-[11px] font-medium text-warning">Overdue</div> : null}
                        {!overdue && atRisk ? (
                          <div className="mt-1 text-[11px] font-medium text-warning/80">At risk</div>
                        ) : null}
                        {checks.length > 0 ? (
                          <div className="mt-1.5 text-[11px] text-base-content/50">
                            Checklist {checksDone}/{checks.length}
                          </div>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
