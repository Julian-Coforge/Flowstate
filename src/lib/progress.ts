export function progress(nodes: { status: string }[]) {
  const total = nodes.length;
  const done = nodes.filter((node) => node.status === "done").length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, percent };
}
