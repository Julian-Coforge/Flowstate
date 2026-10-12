"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { RECURRENCE_LABEL } from "@/lib/labels";
import { addDays, formatLong, isOnTodayList, isUpcoming, todayISO } from "@/lib/tasks";
import type { ProjectSummary, Recurrence, Todo } from "@/lib/types";

export default function Dashboard() {
  const [today] = useState(() => todayISO());
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [idea, setIdea] = useState("");
  const [mode, setMode] = useState<"quick" | "thinking">("quick");
  const [aiOn, setAiOn] = useState(false);
  const [creating, setCreating] = useState(false);
  const [taskText, setTaskText] = useState("");
  const [taskDate, setTaskDate] = useState(() => todayISO());
  const [taskProject, setTaskProject] = useState("");
  const [taskRepeat, setTaskRepeat] = useState<Recurrence>("none");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ enabled: boolean }>("/api/ai/status")
      .then((data) => setAiOn(data.enabled))
      .catch(() => setAiOn(false));
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      api<{ projects: ProjectSummary[] }>(`/api/projects?q=${encodeURIComponent(query)}`)
        .then((data) => {
          setProjects(data.projects);
          setError(null);
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load projects"))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    api<{ todos: Todo[] }>("/api/todos")
      .then((data) => setTodos(data.todos))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load tasks"));
  }, []);

  const todayTasks = useMemo(
    () => (today ? todos.filter((todo) => isOnTodayList(todo, today)) : []),
    [todos, today],
  );
  const upcoming = useMemo(
    () => (today ? todos.filter((todo) => isUpcoming(todo, today, addDays(today, 7))) : []),
    [todos, today],
  );

  async function createProject(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const project = await api<ProjectSummary>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ title, description }),
      });
      if (aiOn && idea.trim()) {
        await api(`/api/projects/${project.id}/generate`, {
          method: "POST",
          body: JSON.stringify({ idea: idea.trim(), mode }),
        });
      }
      window.location.href = `/projects/${project.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the project");
      setCreating(false);
    }
  }

  async function addTask(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const todo = await api<Todo>("/api/todos", {
        method: "POST",
        body: JSON.stringify({
          text: taskText,
          dueDate: taskDate || null,
          projectId: taskProject || null,
          recurrence: taskRepeat,
        }),
      });
      setTodos((current) => [todo, ...current]);
      if (todo.projectId && !todo.done) {
        setProjects((current) =>
          current.map((project) =>
            project.id === todo.projectId ? { ...project, openTasks: project.openTasks + 1 } : project,
          ),
        );
      }
      setTaskText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the task");
    }
  }

  async function toggle(todo: Todo) {
    const done = !todo.done;
    setTodos((current) => current.map((item) => (item.id === todo.id ? { ...item, done } : item)));
    if (todo.projectId) {
      setProjects((current) =>
        current.map((project) =>
          project.id === todo.projectId ? { ...project, openTasks: Math.max(0, project.openTasks + (done ? -1 : 1)) } : project,
        ),
      );
    }
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
    <main className="mx-auto grid w-full min-w-0 max-w-6xl gap-8 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0">
        <p className="text-sm font-medium uppercase tracking-[0.14em] text-primary">Today</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">{today ? formatLong(today) : "Today"}</h1>

        <form onSubmit={(event) => void createProject(event)} className="mt-6 grid gap-2">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <input
              className="input w-full min-w-0"
              placeholder="New project name"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label="New project name"
              required
            />
            <input
              className="input w-full min-w-0"
              placeholder="What's it for? (optional)"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              aria-label="Project description"
            />
            <button className="btn btn-primary" type="submit" disabled={creating}>
              {creating ? "Creating…" : "Create project"}
            </button>
          </div>
          {aiOn ? (
            <div className="rounded-lg border border-base-300 bg-base-100 p-3">
              <label className="block text-sm">
                Generate a plan (optional)
                <textarea
                  className="textarea mt-1 w-full"
                  rows={2}
                  maxLength={500}
                  placeholder="Describe the project in a few sentences"
                  value={idea}
                  onChange={(event) => setIdea(event.target.value)}
                  aria-label="Generate a plan from this idea"
                />
              </label>
              <div className="mt-2 flex gap-2">
                <button type="button" className={`btn btn-sm ${mode === "quick" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("quick")}>
                  Quick
                </button>
                <button type="button" className={`btn btn-sm ${mode === "thinking" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("thinking")}>
                  Thinking
                </button>
              </div>
            </div>
          ) : null}
        </form>

        <label className="mt-6 block text-sm">
          Search projects
          <input
            className="input mt-1 w-full"
            placeholder="Search by name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        {error ? (
          <p className="mt-4 text-sm text-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {loading ? <p className="text-base-content/60">Loading projects…</p> : null}
          {!loading && projects.length === 0 ? (
            <p className="text-base-content/70">
              {query ? "No projects match that search." : "No projects yet. Name one above and open its canvas."}
            </p>
          ) : null}
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="rounded-lg border border-base-300 bg-base-100 p-4 transition hover:border-primary"
            >
              <h2 className="text-lg font-semibold">{project.title}</h2>
              {project.description ? <p className="mt-1 line-clamp-2 text-sm text-base-content/70">{project.description}</p> : null}
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-base-200">
                <div className="h-full bg-primary" style={{ width: `${project.progress.percent}%` }} />
              </div>
              <p className="mt-2 text-sm text-base-content/70">
                {project.progress.percent}% · {project.progress.done} / {project.progress.total} steps
                {project.openTasks ? ` · ${project.openTasks} open tasks` : ""}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <aside className="rounded-lg border border-base-300 bg-base-100 p-4">
        <h2 className="text-lg font-semibold">Today</h2>
        <form onSubmit={(event) => void addTask(event)} className="mt-3 grid gap-2">
          <input
            className="input w-full"
            placeholder="Add a task"
            value={taskText}
            onChange={(event) => setTaskText(event.target.value)}
            aria-label="Add a task"
            required
          />
          <div className="flex gap-2">
            <input className="input w-full" type="date" value={taskDate} onChange={(event) => setTaskDate(event.target.value)} aria-label="Due date" />
            <select className="select w-full" value={taskProject} onChange={(event) => setTaskProject(event.target.value)} aria-label="Project">
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </div>
          <select className="select w-full" value={taskRepeat} onChange={(event) => setTaskRepeat(event.target.value as Recurrence)} aria-label="Repeat">
            {Object.entries(RECURRENCE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" type="submit">
            Add task
          </button>
        </form>

        <ul className="mt-4 grid gap-2">
          {todayTasks.length === 0 ? <li className="text-sm text-base-content/60">Nothing on today&apos;s list.</li> : null}
          {todayTasks.map((todo) => (
            <TaskRow key={todo.id} todo={todo} today={today} onToggle={toggle} />
          ))}
        </ul>

        <h3 className="mt-6 text-sm font-semibold uppercase tracking-[0.12em] text-base-content/60">Coming up</h3>
        <ul className="mt-2 grid gap-2">
          {upcoming.length === 0 ? <li className="text-sm text-base-content/60">Nothing due in the next week.</li> : null}
          {upcoming.map((todo) => (
            <TaskRow key={todo.id} todo={todo} today={today} onToggle={toggle} />
          ))}
        </ul>
      </aside>
    </main>
  );
}

function TaskRow({
  todo,
  today,
  onToggle,
}: {
  todo: Todo;
  today: string | null;
  onToggle: (todo: Todo) => void;
}) {
  const overdue = Boolean(today && todo.dueDate && todo.dueDate < today && !todo.done);
  return (
    <li className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="checkbox checkbox-sm mt-0.5"
        checked={todo.done}
        onChange={() => onToggle(todo)}
        aria-label={todo.done ? `Mark ${todo.text} not done` : `Mark ${todo.text} done`}
      />
      <span className={todo.done ? "text-base-content/50 line-through" : ""}>
        {todo.text}
        {todo.recurrence && todo.recurrence !== "none" ? (
          <span className="ml-1 inline-block text-xs text-primary" title={RECURRENCE_LABEL[todo.recurrence]}>
            repeat
          </span>
        ) : null}
        {todo.projectTitle ? <span className="mt-0.5 block text-xs text-base-content/50">{todo.projectTitle}</span> : null}
        {overdue ? <span className="mt-0.5 block text-xs text-warning">Overdue</span> : null}
      </span>
    </li>
  );
}
