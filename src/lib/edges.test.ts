import assert from "node:assert/strict";
import test from "node:test";
import { canLink } from "./edges";

const nodeIds = new Set(["a", "b", "c"]);

test("a step can link to more than one other step", () => {
  const existing = [{ sourceNodeId: "a", targetNodeId: "b" }];
  assert.deepEqual(canLink({ sourceId: "a", targetId: "c", existing, nodeIds }), { ok: true });
});

test("rejects a link from a step to itself", () => {
  const result = canLink({ sourceId: "a", targetId: "a", existing: [], nodeIds });
  assert.equal(result.ok, false);
});

test("rejects a duplicate link", () => {
  const existing = [{ sourceNodeId: "a", targetNodeId: "b" }];
  const result = canLink({ sourceId: "a", targetId: "b", existing, nodeIds });
  assert.equal(result.ok, false);
});

test("rejects a link to a step outside the project", () => {
  const result = canLink({ sourceId: "a", targetId: "missing", existing: [], nodeIds });
  assert.equal(result.ok, false);
});
