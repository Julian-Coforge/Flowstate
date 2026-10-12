import assert from "node:assert/strict";
import test from "node:test";
import { inferHandles, layeredLayout } from "./layout";

test("inferHandles prefers the dominant axis", () => {
  assert.deepEqual(inferHandles({ x: 0, y: 0 }, { x: 200, y: 10 }), { sourceHandle: "right", targetHandle: "left" });
  assert.deepEqual(inferHandles({ x: 200, y: 0 }, { x: 0, y: 10 }), { sourceHandle: "left", targetHandle: "right" });
  assert.deepEqual(inferHandles({ x: 0, y: 0 }, { x: 10, y: 200 }), { sourceHandle: "bottom", targetHandle: "top" });
  assert.deepEqual(inferHandles({ x: 0, y: 200 }, { x: 10, y: 0 }), { sourceHandle: "top", targetHandle: "bottom" });
});

test("layeredLayout places roots on the left", () => {
  const laid = layeredLayout(
    [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 0, y: 0 },
      { id: "c", x: 0, y: 0 },
    ],
    [
      { sourceNodeId: "a", targetNodeId: "b" },
      { sourceNodeId: "b", targetNodeId: "c" },
    ],
  );
  const byId = Object.fromEntries(laid.map((node) => [node.id, node]));
  assert.equal(byId.a.x < byId.b.x, true);
  assert.equal(byId.b.x < byId.c.x, true);
});
