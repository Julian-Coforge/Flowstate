"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import ColorPicker, { ColorDot } from "@/components/ColorPicker";
import DocumentUpload from "@/components/DocumentUpload";
import {
  CALENDAR_PATH,
  cachedGet,
  invalidateLists,
  peekCached,
  prefetchProject,
  projectsListPath,
} from "@/lib/data-cache";
import { RECURRENCE_LABEL } from "@/lib/labels";
import { addDays, formatLong, isOnTodayList, isUpcoming, todayISO } from "@/lib/tasks";
import type { CalendarStep, ProjectSummary, Recurrence, TaskColor, Todo } from "@/lib/types";

type CalendarPayload = { todos: Todo[]; steps: CalendarStep[] };
type ProjectsPayload = { projects: ProjectSummary[] };

export default function Dashboard() {
  const [today] = useState(() => todayISO());
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<"active" | "archived">("active");
  const initialProjects = peekCached<ProjectsPayload>(projectsListPath("", "active"))?.projects;
  const initialCalendar = peekCached<CalendarPayload>(CALENDAR_PATH);
  const [projects, setProjects] = useState<ProjectSummary[]>(() => initialProjects ?? []);
  const [todos, setTodos] = useState<Todo[]>(() => initialCalendar?.todos ?? []);
  const [steps, setSteps] = useState<CalendarStep[]>(() => initialCalendar?.steps ?? []);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeProjects, setActiveProjects] = useState<ProjectSummary[]>(() => initialProjects ?? []);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [idea, setIdea] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"quick" | "thinking">("quick");
  const [aiOn, setAiOn] = useState(false);
  const [creating, setCreating] = useState(false);
  const [taskText, setTaskText] = useState("");
  const [taskDate, setTaskDate] = useState(() => todayISO());
  const [taskProject, setTaskProject] = useState("");
  const [taskRepeat, setTaskRepeat] = useState<Recurrence>("none");
  const [taskColor, setTaskColor] = useState<TaskColor>("none");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !initialProjects);

  useEffect(() => {
    cachedGet<{ enabled: boolean }>("/api/ai/status", { freshMs: 5 * 60_000 })
      .then((data) => setAiOn(data.enabled))
      .catch(() => setAiOn(false));
  }, []);

  useEffect(() => {
    const path = projectsListPath(query, projectFilter);
    const cached = peekCached<ProjectsPayload>(path);
    if (cached) {
      setProjects(cached.projects);
      if (projectFilter === "active") setActiveProjects(cached.projects);
      setLoading(false);
    } else if (!query) {
      setLoading(true);
    }

    const handle = setTimeout(() => {
      cachedGet<ProjectsPayload>(path)
        .then((data) => {
          setProjects(data.projects);
          if (projectFilter === "active") setActiveProjects(data.projects);
          setError(null);
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load projects"))
        .finally(() => setLoading(false));
    }, query ? 200 : 0);
    return () => clearTimeout(handle);
  }, [query, projectFilter]);

  useEffect(() => {
    if (projectFilter === "active") return;
    const path = projectsListPath("", "active");
    const cached = peekCached<ProjectsPayload>(path);
    if (cached) setActiveProjects(cached.projects);
    cachedGet<ProjectsPayload>(path)
      .then((data) => setActiveProjects(data.projects))
      .catch(() => undefined);
  }, [projectFilter]);

  useEffect(() => {
    const cached = peekCached<CalendarPayload>(CALENDAR_PATH);
    if (cached) {
      setTodos(cached.todos);
      setSteps(cached.steps);
    }
    cachedGet<CalendarPayload>(CALENDAR_PATH)
      .then((data) => {
        setTodos(data.todos);
        setSteps(data.steps);
      })
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
  const todaySteps = useMemo(
    () =>
      today
        ? steps.filter((step) => isOnTodayList({ done: step.status === "done", dueDate: step.dueDate }, today))
        : [],
    [steps, today],
  );
  const upcomingSteps = useMemo(
    () =>
      today
        ? steps.filter((step) => isUpcoming({ done: step.status === "done", dueDate: step.dueDate }, today, addDays(today, 7)))
        : [],
    [steps, today],
  );

  async function duplicate(projectId: string) {
    setDuplicating(projectId);
    try {
      const copy = await api<ProjectSummary>(`/api/projects/${projectId}/duplicate`, { method: "POST" });
      invalidateLists();
      if (projectFilter === "active") {
        setProjects((current) => [copy, ...current]);
        setActiveProjects((current) => [copy, ...current]);
      } else {
        setActiveProjects((current) => [copy, ...current]);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not duplicate the project");
    } finally {
      setDuplicating(null);
    }
  }

  async function setProjectStatus(project: ProjectSummary, status: "active" | "archived") {
    setBusyId(project.id);
    try {
      await api<ProjectSummary>(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      invalidateLists();
      setProjects((current) => current.filter((item) => item.id !== project.id));
      if (status === "active") {
        setActiveProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
      } else {
        setActiveProjects((current) => current.filter((item) => item.id !== project.id));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the project");
    } finally {
      setBusyId(null);
    }
  }

  async function removeProject(project: ProjectSummary) {
    if (!confirm(`Delete “${project.title}”? This removes its steps and tasks.`)) return;
    setBusyId(project.id);
    try {
      await api(`/api/projects/${project.id}`, { method: "DELETE" });
      invalidateLists();
      setProjects((current) => current.filter((item) => item.id !== project.id));
      setActiveProjects((current) => current.filter((item) => item.id !== project.id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the project");
    } finally {
      setBusyId(null);
    }
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const project = await api<ProjectSummary>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ title, description }),
      });
      if (aiOn && (idea.trim() || documentFile)) {
        const form = new FormData();
        form.append(
          "idea",
          idea.trim() ||
            "Build a detailed work plan from this assignment brief. Break every major requirement into its own step, including setup, features, testing, and submission.",
        );
        form.append("mode", mode);
        if (documentFile) form.append("document", documentFile);
        await api(`/api/projects/${project.id}/generate`, { method: "POST", body: form });
      }
      invalidateLists();
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
          color: taskColor,
        }),
      });
      setTodos((current) => [todo, ...current]);
      invalidateLists();
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
      invalidateLists();
      if (done && todo.recurrence && todo.recurrence !== "none") {
        const data = await cachedGet<CalendarPayload>(CALENDAR_PATH, { force: true });
        setTodos(data.todos);
        setSteps(data.steps);
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

        <form onSubmit={(event) => void createProject(event)} className="mt-6 grid gap-3">
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
              placeholder="What's it for?"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              aria-label="Project description"
            />
            <button className="btn btn-primary" type="submit" disabled={creating}>
              {creating ? "Creating…" : "Create project"}
            </button>
          </div>
          {aiOn ? (
            <div className="rounded-lg border border-base-300 bg-base-100 p-4 shadow-sm">
              <label className="block text-sm font-medium">
                Generate a plan
                <textarea
                  className="textarea mt-1.5 w-full"
                  rows={2}
                  maxLength={500}
                  placeholder="e.g. Holiday starting next Monday, or weekly shopping from 12 November"
                  value={idea}
                  onChange={(event) => setIdea(event.target.value)}
                  aria-label="Generate a plan from this idea"
                />
              </label>
              <DocumentUpload file={documentFile} onChange={setDocumentFile} />
              <div className="mt-3 flex gap-2">
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

        <div className="mt-6 flex flex-wrap items-end gap-3">
          <label className="block min-w-[12rem] flex-1 text-sm">
            Search projects
            <input
              className="input mt-1 w-full"
              placeholder="Search by name"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className={`btn btn-sm ${projectFilter === "active" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setProjectFilter("active")}
            >
              Active
            </button>
            <button
              type="button"
              className={`btn btn-sm ${projectFilter === "archived" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setProjectFilter("archived")}
            >
              Archived
            </button>
          </div>
        </div>

        {error ? (
          <p className="mt-4 text-sm text-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 grid gap-3 overflow-visible sm:grid-cols-2">
          {loading ? <p className="text-base-content/60">Loading projects…</p> : null}
          {!loading && projects.length === 0 ? (
            <p className="text-base-content/70">
              {query
                ? "No projects match that search."
                : projectFilter === "archived"
                  ? "No archived projects."
                  : "No projects yet. Name one above and open its canvas."}
            </p>
          ) : null}
          {projects.map((project) => (
            <article key={project.id} className="project-card group relative rounded-lg border border-base-300 bg-base-100">
              <Link
                href={`/projects/${project.id}`}
                transitionTypes={["nav-forward"]}
                className="block p-4 pb-5"
                onMouseEnter={() => prefetchProject(project.id)}
                onFocus={() => prefetchProject(project.id)}
              >
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">{project.title}</h2>
                  {project.status === "archived" ? (
                    <span className="badge badge-ghost badge-sm">Archived</span>
                  ) : null}
                </div>
                {project.description ? <p className="mt-1 line-clamp-2 text-sm text-base-content/70">{project.description}</p> : null}
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-base-200">
                  <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${project.progress.percent}%` }} />
                </div>
                <p className="mt-2 text-sm text-base-content/70">
                  {project.progress.percent}% · {project.progress.done} / {project.progress.total} steps
                  {project.openTasks ? ` · ${project.openTasks} open tasks` : ""}
                </p>
              </Link>
              <div className="project-card-actions pointer-events-none absolute inset-x-0 bottom-0 flex translate-y-1 items-center justify-center gap-1.5 bg-gradient-to-t from-base-100 via-base-100/95 to-transparent px-3 pb-3 pt-8 opacity-0 transition duration-200 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100">
                <button
                  className="btn btn-ghost btn-xs border border-base-300 bg-base-100"
                  type="button"
                  disabled={duplicating === project.id || busyId === project.id}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void duplicate(project.id);
                  }}
                >
                  {duplicating === project.id ? "Copying…" : "Duplicate"}
                </button>
                <button
                  className="btn btn-ghost btn-xs border border-base-300 bg-base-100"
                  type="button"
                  disabled={busyId === project.id}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void setProjectStatus(project, project.status === "archived" ? "active" : "archived");
                  }}
                >
                  {project.status === "archived" ? "Restore" : "Archive"}
                </button>
                <button
                  className="btn btn-ghost btn-xs border border-error/30 bg-base-100 text-error"
                  type="button"
                  disabled={busyId === project.id}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void removeProject(project);
                  }}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <aside className="rounded-lg border border-base-300 bg-base-100 p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Today</h2>
        <form onSubmit={(event) => void addTask(event)} className="mt-3 grid gap-2.5">
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
              {activeProjects.map((project) => (
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
          <div className="mt-2 mb-1">
            <ColorPicker value={taskColor} onChange={setTaskColor} />
          </div>
          <button className="btn btn-primary btn-sm" type="submit">
            Add task
          </button>
        </form>

        <ul className="mt-4 grid gap-2">
          {todayTasks.length === 0 && todaySteps.length === 0 ? <li className="text-sm text-base-content/60">Nothing on today&apos;s list.</li> : null}
          {todayTasks.map((todo) => (
            <TaskRow key={todo.id} todo={todo} today={today} onToggle={toggle} />
          ))}
          {todaySteps.map((step) => (
            <StepRow key={step.id} step={step} today={today} />
          ))}
        </ul>

        <h3 className="mt-6 text-sm font-semibold uppercase tracking-[0.12em] text-base-content/60">Coming up</h3>
        <ul className="mt-2 grid gap-2">
          {upcoming.length === 0 && upcomingSteps.length === 0 ? <li className="text-sm text-base-content/60">Nothing due in the next week.</li> : null}
          {upcoming.map((todo) => (
            <TaskRow key={todo.id} todo={todo} today={today} onToggle={toggle} />
          ))}
          {upcomingSteps.map((step) => (
            <StepRow key={step.id} step={step} today={today} />
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
      <ColorDot color={todo.color} />
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

function StepRow({ step, today }: { step: CalendarStep; today: string | null }) {
  const overdue = Boolean(today && step.dueDate && step.dueDate < today && step.status !== "done");
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className="mt-1.5 h-2 w-2 shrink-0 rotate-45 bg-primary" aria-hidden />
      <span className={step.status === "done" ? "text-base-content/50 line-through" : ""}>
        {step.title}
        <span className="ml-1 text-xs text-primary">step</span>
        {step.projectTitle ? (
          <Link
            href={`/projects/${step.projectId}`}
            transitionTypes={["nav-forward"]}
            className="mt-0.5 block text-xs text-base-content/50 underline"
            onMouseEnter={() => prefetchProject(step.projectId)}
            onFocus={() => prefetchProject(step.projectId)}
          >
            {step.projectTitle}
          </Link>
        ) : null}
        {overdue ? <span className="mt-0.5 block text-xs text-warning">Overdue</span> : null}
      </span>
    </li>
  );
}
