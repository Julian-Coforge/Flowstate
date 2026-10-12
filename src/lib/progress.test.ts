import assert from "node:assert/strict";
import test from "node:test";
import { progress } from "./progress";

test("progress is completed steps divided by all steps", () => {
  assert.deepEqual(progress([{ status: "done" }, { status: "todo" }, { status: "doing" }, { status: "done" }]), {
    done: 2,
    total: 4,
    percent: 50,
  });
});

test("progress is zero when a project has no steps", () => {
  assert.deepEqual(progress([]), { done: 0, total: 0, percent: 0 });
});
