export type Point = { x: number; y: number };

export type LayoutNode = { id: string; x: number; y: number };
export type LayoutEdge = { sourceNodeId: string; targetNodeId: string };

/** Approximate collapsed step card size (matches `w-44` cards on the canvas). */
const NODE_W = 176;
const NODE_H = 72;
const GAP_X = 360;
const GAP_Y = 200;

/**
 * Pick connection sides from node centres.
 * Prefer left/right on layer hops so SmoothStep bends in the gutter instead of
 * running vertically through sibling cards.
 */
export function inferHandles(source: Point, target: Point): { sourceHandle: string; targetHandle: string } {
  const dx = target.x + NODE_W / 2 - (source.x + NODE_W / 2);
  const dy = target.y + NODE_H / 2 - (source.y + NODE_H / 2);
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);

  if (adx >= NODE_W * 0.55) {
    if (dx >= 0) return { sourceHandle: "right", targetHandle: "left" };
    return { sourceHandle: "left", targetHandle: "right" };
  }
  if (ady >= NODE_H * 0.55) {
    if (dy >= 0) return { sourceHandle: "bottom", targetHandle: "top" };
    return { sourceHandle: "top", targetHandle: "bottom" };
  }
  if (adx >= ady) {
    if (dx >= 0) return { sourceHandle: "right", targetHandle: "left" };
    return { sourceHandle: "left", targetHandle: "right" };
  }
  if (dy >= 0) return { sourceHandle: "bottom", targetHandle: "top" };
  return { sourceHandle: "top", targetHandle: "bottom" };
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  if (ordered.length % 2) return ordered[mid]!;
  return (ordered[mid - 1]! + ordered[mid]!) / 2;
}

export function layeredLayout(nodes: LayoutNode[], edges: LayoutEdge[], gapX = GAP_X, gapY = GAP_Y): LayoutNode[] {
  const ids = nodes.map((node) => node.id);
  const incoming: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  const outgoing: Record<string, string[]> = Object.fromEntries(ids.map((id) => [id, []]));
  const parents: Record<string, string[]> = Object.fromEntries(ids.map((id) => [id, []]));
  for (const edge of edges) {
    if (!(edge.sourceNodeId in incoming) || !(edge.targetNodeId in incoming)) continue;
    incoming[edge.targetNodeId] += 1;
    outgoing[edge.sourceNodeId].push(edge.targetNodeId);
    parents[edge.targetNodeId].push(edge.sourceNodeId);
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

  const seed = Object.fromEntries(ids.map((id, index) => [id, index]));
  const layerOrder = Object.keys(layers)
    .map(Number)
    .sort((a, b) => a - b);
  for (const layer of layerOrder) {
    layers[layer] = layers[layer]!.slice().sort((a, b) => seed[a]! - seed[b]!);
  }

  for (let pass = 0; pass < 4; pass += 1) {
    for (const layer of layerOrder.slice(1)) {
      const indexOf = Object.fromEntries(layers[layer - 1]!.map((id, index) => [id, index]));
      layers[layer] = layers[layer]!.slice().sort((a, b) => {
        const aLinked = parents[a]!.map((id) => indexOf[id]).filter((value): value is number => value !== undefined);
        const bLinked = parents[b]!.map((id) => indexOf[id]).filter((value): value is number => value !== undefined);
        const aScore = aLinked.length ? median(aLinked) : seed[a]!;
        const bScore = bLinked.length ? median(bLinked) : seed[b]!;
        return aScore - bScore || seed[a]! - seed[b]!;
      });
    }
    for (const layer of [...layerOrder].reverse().slice(1)) {
      const indexOf = Object.fromEntries(layers[layer + 1]!.map((id, index) => [id, index]));
      layers[layer] = layers[layer]!.slice().sort((a, b) => {
        const aLinked = outgoing[a]!.map((id) => indexOf[id]).filter((value): value is number => value !== undefined);
        const bLinked = outgoing[b]!.map((id) => indexOf[id]).filter((value): value is number => value !== undefined);
        const aScore = aLinked.length ? median(aLinked) : seed[a]!;
        const bScore = bLinked.length ? median(bLinked) : seed[b]!;
        return aScore - bScore || seed[a]! - seed[b]!;
      });
    }
  }

  const maxLayerSize = Math.max(1, ...Object.values(layers).map((layerIds) => layerIds.length));
  const positions: Record<string, Point> = {};
  for (const [layer, layerIds] of Object.entries(layers)) {
    const yOffset = ((maxLayerSize - layerIds.length) * gapY) / 2;
    layerIds.forEach((id, index) => {
      positions[id] = { x: 80 + Number(layer) * gapX, y: 80 + yOffset + index * gapY };
    });
  }
  return nodes.map((node) => ({ ...node, ...(positions[node.id] ?? { x: 80, y: 80 }) }));
}
