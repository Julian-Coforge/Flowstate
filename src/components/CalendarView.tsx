"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { RECURRENCE_LABEL } from "@/lib/labels";
import { formatMonth, todayISO } from "@/lib/tasks";
import type { Recurrence, Todo } from "@/lib/types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CalendarView() {
  const [today] = useState(() => todayISO());
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selected, setSelected] = useState(() => todayISO());
  const [todos, setTodos] = useState<Todo[]>([]);
  const [text, setText] = useState("");
  const [repeat, setRepeat] = useState<Recurrence>("none");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ todos: Todo[] }>("/api/todos")
      .then((data) => setTodos(data.todos))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load tasks"));
  }, []);

  const cells = useMemo(() => monthCells(cursor.year, cursor.month), [cursor]);
  const byDay = useMemo(() => {
    const map = new Map<string, Todo[]>();
    for (const todo of todos) {
      if (!todo.dueDate) continue;
      const list = map.get(todo.dueDate) ?? [];
      list.push(todo);
      map.set(todo.dueDate, list);
    }
    return map;
  }, [todos]);
  const selectedTasks = byDay.get(selected) ?? [];

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
        body: JSON.stringify({ text, dueDate: selected, recurrence: repeat }),
      });
      setTodos((current) => [todo, ...current]);
      setText("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the task");
    }
  }

  async function toggle(todo: Todo) {
    const done = !todo.done;
    setTodos((current) => current.map((item) => (item.id === todo.id ? { ...item, done } : item)));
    try {
      await api(`/api/todos/${todo.id}`, { method: "PATCH", body: JSON.stringify({ done }) });
      if (done && todo.recurrence && todo.recurrence !== "none") {
        const data = await api<{ todos: Todo[] }>("/api/todos");
        setTodos(data.todos);
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
            const items = byDay.get(cell.iso) ?? [];
            const isToday = cell.iso === today;
            const isSelected = cell.iso === selected;
            const overdue = cell.iso < today && items.some((item) => !item.done);
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
                <span className="mt-1 block truncate text-xs text-base-content/70">
                  {items.length ? `${items.length} task${items.length === 1 ? "" : "s"}` : ""}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <section className="mt-6 rounded-lg border border-base-300 bg-base-100 p-4">
        <h2 className="text-lg font-semibold">{selected}</h2>
        <form onSubmit={(event) => void addTask(event)} className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
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
        </form>
        <ul className="mt-4 grid gap-2">
          {selectedTasks.length === 0 ? <li className="text-sm text-base-content/60">Nothing due this day.</li> : null}
          {selectedTasks.map((todo) => (
            <li key={todo.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="checkbox checkbox-sm mt-0.5"
                checked={todo.done}
                onChange={() => void toggle(todo)}
                aria-label={todo.text}
              />
              <span className={todo.done ? "text-base-content/50 line-through" : ""}>
                {todo.text}
                {todo.recurrence && todo.recurrence !== "none" ? (
                  <span className="ml-1 text-xs text-primary">repeat</span>
                ) : null}
                {todo.projectTitle ? <span className="mt-0.5 block text-xs text-base-content/50">{todo.projectTitle}</span> : null}
              </span>
            </li>
          ))}
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
