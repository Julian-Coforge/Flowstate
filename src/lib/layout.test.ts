import assert from "node:assert/strict";
import test from "node:test";
import { inferHandles, layeredLayout } from "./layout";

test("inferHandles uses left/right on layer hops so bends stay in the gutter", () => {
  assert.deepEqual(inferHandles({ x: 0, y: 0 }, { x: 360, y: 0 }), {
    sourceHandle: "right",
    targetHandle: "left",
  });
  // Forward + down still left/right — avoids routing down through sibling cards.
  assert.deepEqual(inferHandles({ x: 80, y: 80 }, { x: 440, y: 280 }), {
    sourceHandle: "right",
    targetHandle: "left",
  });
  assert.deepEqual(inferHandles({ x: 360, y: 0 }, { x: 0, y: 0 }), {
    sourceHandle: "left",
    targetHandle: "right",
  });
});

test("inferHandles prefers vertical sides when stacked in a column", () => {
  assert.deepEqual(inferHandles({ x: 0, y: 0 }, { x: 0, y: 220 }), {
    sourceHandle: "bottom",
    targetHandle: "top",
  });
  assert.deepEqual(inferHandles({ x: 0, y: 220 }, { x: 0, y: 0 }), {
    sourceHandle: "top",
    targetHandle: "bottom",
  });
});

test("layeredLayout places roots on the left and keeps linked steps near each other", () => {
  const laid = layeredLayout(
    [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 0, y: 0 },
      { id: "c", x: 0, y: 0 },
      { id: "d", x: 0, y: 0 },
    ],
    [
      { sourceNodeId: "a", targetNodeId: "b" },
      { sourceNodeId: "a", targetNodeId: "c" },
      { sourceNodeId: "b", targetNodeId: "d" },
      { sourceNodeId: "c", targetNodeId: "d" },
    ],
  );
  const byId = Object.fromEntries(laid.map((node) => [node.id, node]));
  assert.equal(byId.a!.x < byId.b!.x, true);
  assert.equal(byId.b!.x < byId.d!.x, true);
  assert.equal(byId.b!.x, byId.c!.x);
  // Remerge sits between the branch band rather than above both.
  const branchYs = [byId.b!.y, byId.c!.y].sort((left, right) => left - right);
  assert.equal(branchYs[0]! < byId.d!.y && byId.d!.y < branchYs[1]!, true);
});
