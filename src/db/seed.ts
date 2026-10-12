import { hashPassword } from "@/server/password";
import { addDays, todayISO } from "@/lib/tasks";
import { db } from "./index";
import { checklistItems, edges, nodes, projects, todos, users } from "./schema";

export function seedIfEmpty() {
  const existing = db.select({ id: users.id }).from(users).get();
  if (existing) return;

  const now = Date.now();
  const today = todayISO();
  const userId = crypto.randomUUID();
  db.insert(users)
    .values({
      id: userId,
      email: "demo@flowstate.app",
      name: "Demo",
      passwordHash: hashPassword("flowstate"),
      createdAt: now,
    })
    .run();

  const portfolio = crypto.randomUUID();
  const move = crypto.randomUUID();
  db.insert(projects)
    .values([
      {
        id: portfolio,
        userId,
        title: "Portfolio site",
        description: "A small site to show recent work.",
        status: "active",
        createdAt: now,
      },
      {
        id: move,
        userId,
        title: "Move house",
        description: "Leave the flat and settle into the new place.",
        status: "active",
        createdAt: now - 1000,
      },
    ])
    .run();

  const research = crypto.randomUUID();
  const design = crypto.randomUUID();
  const build = crypto.randomUUID();
  const publish = crypto.randomUUID();
  const landlord = crypto.randomUUID();
  const pack = crypto.randomUUID();
  const van = crypto.randomUUID();
  const unpack = crypto.randomUUID();

  db.insert(nodes)
    .values([
      node(research, portfolio, "Research", "Look at sites you like.", "medium", "doing", 40, 40),
      node(design, portfolio, "Design", "Layout, type, and colour.", "high", "done", 40, 200),
      node(build, portfolio, "Build the pages", "Home, work, and about.", "high", "todo", 320, 120),
      node(publish, portfolio, "Publish", "Put it on a public address.", "medium", "todo", 600, 120),
      node(landlord, move, "Tell the landlord", "Notice and the deposit.", "high", "done", 40, 80),
      node(pack, move, "Pack the kitchen", "Boxes, labels, fragile items.", "medium", "doing", 300, 40),
      node(van, move, "Book a van", "A morning slot on moving day.", "high", "todo", 300, 220),
      node(unpack, move, "Unpack", "Kitchen first, then the rest.", "low", "todo", 560, 130),
    ])
    .run();

  db.insert(edges)
    .values([
      edge(portfolio, research, build),
      edge(portfolio, design, build),
      edge(portfolio, build, publish),
      edge(move, pack, van),
      edge(move, van, unpack),
    ])
    .run();

  db.insert(checklistItems)
    .values([
      check(build, "Sketch the layouts", true, 0),
      check(build, "Write the home page", false, 1),
      check(build, "Pick fonts", false, 2),
      check(pack, "Get boxes", false, 0),
      check(pack, "Label each box", false, 1),
    ])
    .run();

  db.insert(todos)
    .values([
      task(userId, "Write the about page", portfolio, today, false),
      task(userId, "Pick fonts", portfolio, addDays(today, -1), true),
      task(userId, "Choose a host", portfolio, addDays(today, 3), false),
      task(userId, "Get packing boxes", move, today, false),
      task(userId, "Measure the sofa", move, addDays(today, 5), false),
      task(userId, "Buy milk", null, today, false),
    ])
    .run();
}

function node(
  id: string,
  projectId: string,
  title: string,
  description: string,
  importance: string,
  status: string,
  x: number,
  y: number,
) {
  return { id, projectId, title, description, importance, notes: "", status, x, y };
}

function edge(projectId: string, sourceNodeId: string, targetNodeId: string) {
  return { id: crypto.randomUUID(), projectId, sourceNodeId, targetNodeId };
}

function check(nodeId: string, text: string, done: boolean, position: number) {
  return { id: crypto.randomUUID(), nodeId, text, done, position };
}

function task(userId: string, text: string, projectId: string | null, dueDate: string, done: boolean) {
  return { id: crypto.randomUUID(), userId, projectId, nodeId: null, text, done, dueDate };
}
