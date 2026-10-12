export type EdgeEnds = { sourceNodeId: string; targetNodeId: string };

export function canLink(args: {
  sourceId: string;
  targetId: string;
  existing: EdgeEnds[];
  nodeIds: Set<string>;
}): { ok: true } | { ok: false; error: string } {
  if (!args.nodeIds.has(args.sourceId) || !args.nodeIds.has(args.targetId)) {
    return { ok: false, error: "Both steps must be in this project" };
  }
  if (args.sourceId === args.targetId) {
    return { ok: false, error: "A step can't link to itself" };
  }
  const duplicate = args.existing.some(
    (edge) => edge.sourceNodeId === args.sourceId && edge.targetNodeId === args.targetId,
  );
  if (duplicate) {
    return { ok: false, error: "Those steps are already linked" };
  }
  return { ok: true };
}
