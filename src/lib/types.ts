export type NodeStatus = "todo" | "doing" | "done";
export type Importance = "low" | "medium" | "high";
export type Recurrence = "none" | "daily" | "weekly" | "monthly";
export type TaskColor = "none" | "blue" | "green" | "amber" | "rose" | "violet" | "teal";

export type ChecklistItem = {
  id: string;
  nodeId: string;
  text: string;
  done: boolean;
  position: number;
};

export type FlowNode = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  importance: Importance;
  notes: string;
  status: NodeStatus;
  x: number;
  y: number;
  dueDate: string | null;
  recurrence: Recurrence;
  checklist: ChecklistItem[];
};

export type FlowEdge = {
  id: string;
  projectId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle: string | null;
  targetHandle: string | null;
};

export type CalendarStep = {
  id: string;
  projectId: string;
  projectTitle: string | null;
  title: string;
  status: NodeStatus;
  dueDate: string | null;
  importance: Importance;
  recurrence: Recurrence;
};

export type Todo = {
  id: string;
  projectId: string | null;
  nodeId: string | null;
  text: string;
  done: boolean;
  dueDate: string | null;
  recurrence: Recurrence;
  color: TaskColor;
  projectTitle: string | null;
};

export type Progress = { done: number; total: number; percent: number };

export type ProjectSummary = {
  id: string;
  title: string;
  description: string;
  status: string;
  createdAt: number;
  progress: Progress;
  openTasks: number;
};

export type PublicUser = { id: string; email: string; name: string };
