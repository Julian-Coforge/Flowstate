import { and, desc, eq, inArray, like } from "drizzle-orm";
import { db } from "@/db";
import { seedIfEmpty } from "@/db/seed";
import { checklistItems, edges, nodes, projects, sessions, todos, users } from "@/db/schema";
import { canLink } from "@/lib/edges";
import { progress } from "@/lib/progress";
import type { FlowNode, Importance, NodeStatus, ProjectSummary, PublicUser, Todo } from "@/lib/types";
import { THIRTY_DAYS } from "./auth";
import { hashPassword, verifyPassword } from "./password";

seedIfEmpty();

export class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function registerUser(input: { name: string; email: string; password: string }) {
  const email = input.email.toLowerCase();
  const existing = db.select().from(users).where(eq(users.email, email)).get();
  if (existing) throw new HttpError("An account with that email already exists", 409);
  const user = {
    id: crypto.randomUUID(),
    email,
    name: input.name,
    passwordHash: hashPassword(input.password),
    createdAt: Date.now(),
  };
  db.insert(users).values(user).run();
  return createSession(user.id);
}

export function loginUser(input: { email: string; password: string }) {
  const user = db.select().from(users).where(eq(users.email, input.email.toLowerCase())).get();
  if (!user || !verifyPassword(input.password, user.passwordHash)) {
    throw new HttpError("Email or password is wrong", 401);
  }
  return createSession(user.id);
}

export function createSession(userId: string) {
  const token = crypto.randomUUID();
  db.insert(sessions)
    .values({ id: token, userId, expiresAt: Date.now() + THIRTY_DAYS * 1000 })
    .run();
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) throw new HttpError("Account not found", 404);
  return { token, user: publicUser(user) };
}

export function deleteSession(token: string | undefined) {
  if (!token) return;
  db.delete(sessions).where(eq(sessions.id, token)).run();
}

export function listProjects(userId: string, query: string): ProjectSummary[] {
  const trimmed = query.trim().replace(/[%_]/g, "");
  const rows = trimmed
    ? db
        .select()
        .from(projects)
        .where(and(eq(projects.userId, userId), likeTitle(trimmed)))
        .orderBy(desc(projects.createdAt))
        .all()
    : db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.createdAt)).all();

  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const nodeRows = db.select().from(nodes).where(inArray(nodes.projectId, ids)).all();
  const todoRows = db.select().from(todos).where(inArray(todos.projectId, ids)).all();

  return rows.map((project) => ({
    id: project.id,
    title: project.title,
    description: project.description,
    status: project.status,
    createdAt: project.createdAt,
    progress: progress(nodeRows.filter((node) => node.projectId === project.id)),
    openTasks: todoRows.filter((todo) => todo.projectId === project.id && !todo.done).length,
  }));
}

export function createProject(userId: string, input: { title: string; description: string }) {
  const project = {
    id: crypto.randomUUID(),
    userId,
    title: input.title,
    description: input.description,
    status: "active",
    createdAt: Date.now(),
  };
  db.insert(projects).values(project).run();
  return {
    id: project.id,
    title: project.title,
    description: project.description,
    status: project.status,
    createdAt: project.createdAt,
    progress: progress([]),
    openTasks: 0,
  };
}

export function getProjectBundle(userId: string, projectId: string) {
  const project = ownedProject(userId, projectId);
  const nodeRows = db.select().from(nodes).where(eq(nodes.projectId, projectId)).all();
  const nodeIds = nodeRows.map((node) => node.id);
  const checks =
    nodeIds.length === 0
      ? []
      : db.select().from(checklistItems).where(inArray(checklistItems.nodeId, nodeIds)).all();
  const edgeRows = db.select().from(edges).where(eq(edges.projectId, projectId)).all();
  const todoRows = db
    .select()
    .from(todos)
    .where(and(eq(todos.userId, userId), eq(todos.projectId, projectId)))
    .all();

  const flowNodes: FlowNode[] = nodeRows.map((node) => ({
    id: node.id,
    projectId: node.projectId,
    title: node.title,
    description: node.description,
    importance: node.importance as Importance,
    notes: node.notes,
    status: node.status as NodeStatus,
    x: node.x,
    y: node.y,
    checklist: checks
      .filter((item) => item.nodeId === node.id)
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        id: item.id,
        nodeId: item.nodeId,
        text: item.text,
        done: item.done,
        position: item.position,
      })),
  }));

  return {
    project: {
      id: project.id,
      title: project.title,
      description: project.description,
      status: project.status,
      createdAt: project.createdAt,
    },
    nodes: flowNodes,
    edges: edgeRows.map((edge) => ({
      id: edge.id,
      projectId: edge.projectId,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
    })),
    todos: todoRows.map((todo) => toTodo(todo, project.title)),
    progress: progress(flowNodes),
  };
}

export function deleteProject(userId: string, projectId: string) {
  ownedProject(userId, projectId);
  db.delete(projects).where(eq(projects.id, projectId)).run();
}

export function createNode(userId: string, input: { projectId: string; title: string; x: number; y: number }) {
  ownedProject(userId, input.projectId);
  const node = {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    title: input.title,
    description: "",
    importance: "medium",
    notes: "",
    status: "todo",
    x: input.x,
    y: input.y,
  };
  db.insert(nodes).values(node).run();
  return { ...node, importance: "medium" as const, status: "todo" as const, checklist: [] };
}

export function updateNode(
  userId: string,
  nodeId: string,
  patch: Partial<{
    title: string;
    description: string;
    importance: Importance;
    notes: string;
    status: NodeStatus;
    x: number;
    y: number;
  }>,
) {
  ownedNode(userId, nodeId);
  db.update(nodes).set(patch).where(eq(nodes.id, nodeId)).run();
  return db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
}

export function deleteNode(userId: string, nodeId: string) {
  ownedNode(userId, nodeId);
  db.delete(nodes).where(eq(nodes.id, nodeId)).run();
}

export function createEdge(userId: string, input: { projectId: string; sourceNodeId: string; targetNodeId: string }) {
  ownedProject(userId, input.projectId);
  const nodeRows = db.select().from(nodes).where(eq(nodes.projectId, input.projectId)).all();
  const existing = db.select().from(edges).where(eq(edges.projectId, input.projectId)).all();
  const check = canLink({
    sourceId: input.sourceNodeId,
    targetId: input.targetNodeId,
    existing,
    nodeIds: new Set(nodeRows.map((node) => node.id)),
  });
  if (!check.ok) throw new HttpError(check.error, 400);
  const edge = { id: crypto.randomUUID(), ...input };
  db.insert(edges).values(edge).run();
  return edge;
}

export function deleteEdge(userId: string, edgeId: string) {
  const edge = db.select().from(edges).where(eq(edges.id, edgeId)).get();
  if (!edge) throw new HttpError("That link was not found", 404);
  ownedProject(userId, edge.projectId);
  db.delete(edges).where(eq(edges.id, edgeId)).run();
}

export function listTodos(userId: string, projectId?: string | null): Todo[] {
  const conditions = [eq(todos.userId, userId)];
  if (projectId) conditions.push(eq(todos.projectId, projectId));
  const rows = db
    .select()
    .from(todos)
    .where(and(...conditions))
    .all();
  const projectRows = db.select().from(projects).where(eq(projects.userId, userId)).all();
  const titles = new Map(projectRows.map((project) => [project.id, project.title]));
  return rows.map((todo) => toTodo(todo, todo.projectId ? (titles.get(todo.projectId) ?? null) : null));
}

export function createTodo(
  userId: string,
  input: { text: string; projectId?: string | null; nodeId?: string | null; dueDate?: string | null },
) {
  if (input.projectId) ownedProject(userId, input.projectId);
  if (input.nodeId) ownedNode(userId, input.nodeId);
  const todo = {
    id: crypto.randomUUID(),
    userId,
    projectId: input.projectId ?? null,
    nodeId: input.nodeId ?? null,
    text: input.text,
    done: false,
    dueDate: input.dueDate ?? null,
  };
  db.insert(todos).values(todo).run();
  const title = todo.projectId
    ? (db.select().from(projects).where(eq(projects.id, todo.projectId)).get()?.title ?? null)
    : null;
  return toTodo(todo, title);
}

export function updateTodo(
  userId: string,
  todoId: string,
  patch: Partial<{ text: string; done: boolean; dueDate: string | null; projectId: string | null }>,
) {
  const existing = db.select().from(todos).where(and(eq(todos.id, todoId), eq(todos.userId, userId))).get();
  if (!existing) throw new HttpError("That task was not found", 404);
  if (patch.projectId) ownedProject(userId, patch.projectId);
  db.update(todos).set(patch).where(eq(todos.id, todoId)).run();
  const next = db.select().from(todos).where(eq(todos.id, todoId)).get();
  if (!next) throw new HttpError("That task was not found", 404);
  const title = next.projectId
    ? (db.select().from(projects).where(eq(projects.id, next.projectId)).get()?.title ?? null)
    : null;
  return toTodo(next, title);
}

export function deleteTodo(userId: string, todoId: string) {
  const existing = db.select().from(todos).where(and(eq(todos.id, todoId), eq(todos.userId, userId))).get();
  if (!existing) throw new HttpError("That task was not found", 404);
  db.delete(todos).where(eq(todos.id, todoId)).run();
}

export function createChecklistItem(userId: string, input: { nodeId: string; text: string }) {
  ownedNode(userId, input.nodeId);
  const siblings = db.select().from(checklistItems).where(eq(checklistItems.nodeId, input.nodeId)).all();
  const item = {
    id: crypto.randomUUID(),
    nodeId: input.nodeId,
    text: input.text,
    done: false,
    position: siblings.length,
  };
  db.insert(checklistItems).values(item).run();
  return item;
}

export function updateChecklistItem(userId: string, itemId: string, patch: Partial<{ text: string; done: boolean }>) {
  const item = db.select().from(checklistItems).where(eq(checklistItems.id, itemId)).get();
  if (!item) throw new HttpError("That checklist item was not found", 404);
  ownedNode(userId, item.nodeId);
  db.update(checklistItems).set(patch).where(eq(checklistItems.id, itemId)).run();
  return db.select().from(checklistItems).where(eq(checklistItems.id, itemId)).get();
}

export function deleteChecklistItem(userId: string, itemId: string) {
  const item = db.select().from(checklistItems).where(eq(checklistItems.id, itemId)).get();
  if (!item) throw new HttpError("That checklist item was not found", 404);
  ownedNode(userId, item.nodeId);
  db.delete(checklistItems).where(eq(checklistItems.id, itemId)).run();
}

function publicUser(user: { id: string; email: string; name: string }): PublicUser {
  return { id: user.id, email: user.email, name: user.name };
}

function ownedProject(userId: string, projectId: string) {
  const project = db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .get();
  if (!project) throw new HttpError("That project was not found", 404);
  return project;
}

function ownedNode(userId: string, nodeId: string) {
  const node = db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
  if (!node) throw new HttpError("That step was not found", 404);
  ownedProject(userId, node.projectId);
  return node;
}

function toTodo(
  todo: {
    id: string;
    projectId: string | null;
    nodeId: string | null;
    text: string;
    done: boolean;
    dueDate: string | null;
  },
  projectTitle: string | null,
): Todo {
  return {
    id: todo.id,
    projectId: todo.projectId,
    nodeId: todo.nodeId,
    text: todo.text,
    done: todo.done,
    dueDate: todo.dueDate,
    projectTitle,
  };
}

function likeTitle(query: string) {
  return like(projects.title, `%${query}%`);
}
