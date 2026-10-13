type ProgressNode = {
  status: string;
  checklist?: { done: boolean }[];
};

function nodeCompletion(node: ProgressNode): number {
  if (node.status === "done") return 1;
  const statusPart = node.status === "doing" ? 0.5 : 0;
  const checks = node.checklist ?? [];
  if (checks.length === 0) return statusPart;
  const checkPart = checks.filter((item) => item.done).length / checks.length;
  return Math.min(0.99, 0.35 * statusPart + 0.65 * checkPart);
}

export function progress(nodes: ProgressNode[]) {
  const total = nodes.length;
  if (total === 0) return { done: 0, total: 0, percent: 0 };
  const done = nodes.filter((node) => node.status === "done").length;
  const percent = Math.round((nodes.reduce((sum, node) => sum + nodeCompletion(node), 0) / total) * 100);
  return { done, total, percent };
}
