"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ColorPicker, { ColorDot } from "@/components/ColorPicker";
import { api } from "@/lib/api";
import { RECURRENCE_LABEL, TASK_COLORS } from "@/lib/labels";
import { formatMonth, todayISO } from "@/lib/tasks";
import type { CalendarStep, ProjectSummary, Recurrence, TaskColor, Todo } from "@/lib/types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type DayItem =
  | { kind: "task"; id: string; text: string; dueDate: string; done: boolean; color: TaskColor; projectId: string | null; projectTitle: string | null; recurrence: Recurrence }
  | { kind: "step"; id: string; text: string; dueDate: string; done: boolean; color: "none"; projectId: string; projectTitle: string | null };

export default function CalendarView() {
  const [today] = useState(() => todayISO());
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selected, setSelected] = useState(() => todayISO());
  const [todos, setTodos] = useState<Todo[]>([]);
  const [steps, setSteps] = useState<CalendarStep[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [colorFilter, setColorFilter] = useState<TaskColor | "all">("all");
  const [text, setText] = useState("");
  const [repeat, setRepeat] = useState<Recurrence>("none");
  const [color, setColor] = useState<TaskColor>("none");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<{ todos: Todo[]; steps: CalendarStep[] }>("/api/calendar"),
      api<{ projects: ProjectSummary[] }>("/api/projects"),
    ])
      .then(([calendar, projectData]) => {
        setTodos(calendar.todos);
        setSteps(calendar.steps);
        setProjects(projectData.projects);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load the calendar"));
  }, []);

  const items = useMemo(() => {
    const list: DayItem[] = [];
    for (const todo of todos) {
      if (!todo.dueDate) continue;
      if (projectFilter && todo.projectId !== projectFilter) continue;
      if (colorFilter !== "all" && todo.color !== colorFilter) continue;
      list.push({
        kind: "task",
        id: todo.id,
        text: todo.text,
        dueDate: todo.dueDate,
        done: todo.done,
        color: todo.color,
        projectId: todo.projectId,
        projectTitle: todo.projectTitle,
        recurrence: todo.recurrence,
      });
    }
    if (colorFilter === "all") {
      for (const step of steps) {
        if (!step.dueDate) continue;
        if (projectFilter && step.projectId !== projectFilter) continue;
        list.push({
          kind: "step",
          id: step.id,
          text: step.title,
          dueDate: step.dueDate,
          done: step.status === "done",
          color: "none",
          projectId: step.projectId,
          projectTitle: step.projectTitle,
        });
      }
    }
    return list;
  }, [todos, steps, projectFilter, colorFilter]);

  const cells = useMemo(() => monthCells(cursor.year, cursor.month), [cursor]);
  const byDay = useMemo(() => {
    const map = new Map<string, DayItem[]>();
    for (const item of items) {
      const list = map.get(item.dueDate) ?? [];
      list.push(item);
      map.set(item.dueDate, list);
    }
    return map;
  }, [items]);
  const selectedItems = byDay.get(selected) ?? [];

  function shift(delta: number) {
    setCursor((current) => {
      const date = new Date(current.year, current.month + delta, 1);
      return { year: date.getFullYear(), month: date.getMonth() };
    });
  }

  async function addTask(event: FormEvent) {
    event.preventDefault();
    try {
      const todo = await api<Todo>("/api/todos", {
        method: "POST",
        body: JSON.stringify({ text, dueDate: selected, recurrence: repeat, color, projectId: projectFilter || null }),
      });
      setTodos((current) => [todo, ...current]);
      setText("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the task");
    }
  }

  async function toggle(todoId: string) {
    const todo = todos.find((item) => item.id === todoId);
    if (!todo) return;
    const done = !todo.done;
    setTodos((current) => current.map((item) => (item.id === todo.id ? { ...item, done } : item)));
    try {
      await api(`/api/todos/${todo.id}`, { method: "PATCH", body: JSON.stringify({ done }) });
      if (done && todo.recurrence && todo.recurrence !== "none") {
        const data = await api<{ todos: Todo[]; steps: CalendarStep[] }>("/api/calendar");
        setTodos(data.todos);
        setSteps(data.steps);
      }
    } catch (err) {
      setTodos((current) => current.map((item) => (item.id === todo.id ? todo : item)));
      setError(err instanceof Error ? err.message : "Could not update the task");
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <p className="text-sm font-medium uppercase tracking-[0.14em] text-primary">Calendar</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">{formatMonth(cursor.year, cursor.month)}</h1>
        <div className="flex gap-2">
          <button className="btn btn-sm" type="button" onClick={() => shift(-1)}>
            Previous
          </button>
          <button className="btn btn-sm" type="button" onClick={() => shift(1)}>
            Next
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <select className="select select-sm" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} aria-label="Filter by project">
          <option value="">All projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Filter by colour">
          <button
            type="button"
            className={`btn btn-xs ${colorFilter === "all" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setColorFilter("all")}
          >
            All colours
          </button>
          {(Object.keys(TASK_COLORS) as TaskColor[]).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={colorFilter === value}
              title={TASK_COLORS[value].label}
              onClick={() => setColorFilter(value)}
              className={`h-5 w-5 rounded-full border ${TASK_COLORS[value].swatch} ${colorFilter === value ? "ring-2 ring-primary ring-offset-2 ring-offset-base-100" : "border-base-300"}`}
            />
          ))}
        </div>
      </div>

      {error ? (
        <p className="mt-4 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-lg border border-base-300 bg-base-100">
        <div className="grid grid-cols-7 border-b border-base-300 text-xs uppercase tracking-wide text-base-content/50">
          {WEEKDAYS.map((day) => (
            <div key={day} className="px-2 py-2">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell, index) => {
            if (!cell.iso) return <div key={`empty-${index}`} className="min-h-20 border-t border-base-200 bg-base-200/40" />;
            const dayItems = byDay.get(cell.iso) ?? [];
            const isToday = cell.iso === today;
            const isSelected = cell.iso === selected;
            const overdue = cell.iso < today && dayItems.some((item) => !item.done);
            return (
              <button
                key={cell.iso}
                type="button"
                onClick={() => setSelected(cell.iso!)}
                className={`min-h-20 border-t border-base-200 p-2 text-left ${isSelected ? "bg-primary/10" : "hover:bg-base-200"} ${overdue ? "text-warning" : ""}`}
              >
                <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-sm ${isToday ? "bg-primary text-primary-content" : ""}`}>
                  {cell.day}
                </span>
                <span className="mt-1 flex flex-wrap gap-0.5">
                  {dayItems.slice(0, 6).map((item) =>
                    item.kind === "step" ? (
                      <span key={`step-${item.id}`} className="h-1.5 w-1.5 rotate-45 bg-primary" title={item.text} />
                    ) : item.color && item.color !== "none" ? (
                      <span key={item.id} className={`h-1.5 w-1.5 rounded-full ${TASK_COLORS[item.color].swatch}`} />
                    ) : (
                      <span key={item.id} className="h-1.5 w-1.5 rounded-full bg-base-content/30" />
                    ),
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <section className="mt-6 rounded-lg border border-base-300 bg-base-100 p-4">
        <h2 className="text-lg font-semibold">{selected}</h2>
        <form onSubmit={(event) => void addTask(event)} className="mt-3 grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <input
            className="input w-full"
            placeholder="Add a task for this day"
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label="Add a task for this day"
            required
          />
          <select className="select" value={repeat} onChange={(event) => setRepeat(event.target.value as Recurrence)} aria-label="Repeat">
            {Object.entries(RECURRENCE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" type="submit">
            Add
          </button>
          <div className="mt-1 mb-0.5 sm:col-span-3">
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </form>
        <ul className="mt-4 grid gap-2">
          {selectedItems.length === 0 ? <li className="text-sm text-base-content/60">Nothing due this day.</li> : null}
          {selectedItems.map((item) =>
            item.kind === "step" ? (
              <li key={`step-${item.id}`} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rotate-45 bg-primary" aria-hidden />
                <span className={item.done ? "text-base-content/50 line-through" : ""}>
                  {item.text}
                  <span className="ml-1 text-xs text-primary">step</span>
                  {item.projectTitle ? (
                    <Link href={`/projects/${item.projectId}`} className="mt-0.5 block text-xs text-base-content/50 underline">
                      {item.projectTitle}
                    </Link>
                  ) : null}
                </span>
              </li>
            ) : (
              <li key={item.id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm mt-0.5"
                  checked={item.done}
                  onChange={() => void toggle(item.id)}
                  aria-label={item.text}
                />
                <ColorDot color={item.color} />
                <span className={item.done ? "text-base-content/50 line-through" : ""}>
                  {item.text}
                  {item.recurrence !== "none" ? <span className="ml-1 text-xs text-primary">repeat</span> : null}
                  {item.projectTitle ? <span className="mt-0.5 block text-xs text-base-content/50">{item.projectTitle}</span> : null}
                </span>
              </li>
            ),
          )}
        </ul>
      </section>
    </main>
  );
}

function monthCells(year: number, month: number) {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: { iso: string | null; day: number | null }[] = [];
  for (let index = 0; index < startOffset; index += 1) cells.push({ iso: null, day: null });
  for (let day = 1; day <= days; day += 1) {
    const iso = todayISO(new Date(year, month, day));
    cells.push({ iso, day });
  }
  while (cells.length % 7 !== 0) cells.push({ iso: null, day: null });
  return cells;
}
