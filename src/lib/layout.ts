export type Point = { x: number; y: number };

export type LayoutNode = { id: string; x: number; y: number };
export type LayoutEdge = { sourceNodeId: string; targetNodeId: string };

export function inferHandles(source: Point, target: Point): { sourceHandle: string; targetHandle: string } {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) return { sourceHandle: "right", targetHandle: "left" };
    return { sourceHandle: "left", targetHandle: "right" };
  }
  if (dy >= 0) return { sourceHandle: "bottom", targetHandle: "top" };
  return { sourceHandle: "top", targetHandle: "bottom" };
}

export function layeredLayout(nodes: LayoutNode[], edges: LayoutEdge[], gapX = 300, gapY = 170): LayoutNode[] {
  const ids = nodes.map((node) => node.id);
  const incoming: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  const outgoing: Record<string, string[]> = Object.fromEntries(ids.map((id) => [id, []]));
  for (const edge of edges) {
    if (!(edge.sourceNodeId in incoming) || !(edge.targetNodeId in incoming)) continue;
    incoming[edge.targetNodeId] += 1;
    outgoing[edge.sourceNodeId].push(edge.targetNodeId);
  }

  const depth: Record<string, number> = {};
  const queue = ids.filter((id) => incoming[id] === 0);
  for (const id of queue) depth[id] = 0;
  const seen = new Set(queue);
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of outgoing[current]) {
      depth[child] = Math.max(depth[child] ?? 0, depth[current] + 1);
      if (!seen.has(child)) {
        seen.add(child);
        queue.push(child);
      }
    }
  }
  for (const id of ids) depth[id] ??= 0;

  const layers: Record<number, string[]> = {};
  for (const id of ids) {
    const layer = depth[id];
    layers[layer] ??= [];
    layers[layer].push(id);
  }

  const positions: Record<string, Point> = {};
  for (const [layer, layerIds] of Object.entries(layers)) {
    layerIds.forEach((id, index) => {
      positions[id] = { x: 80 + Number(layer) * gapX, y: 80 + index * gapY };
    });
  }
  return nodes.map((node) => ({ ...node, ...(positions[node.id] ?? { x: 80, y: 80 }) }));
}
