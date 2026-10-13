import assert from "node:assert/strict";
import test from "node:test";
import { progress } from "./progress";

test("progress blends status when there are no checklists", () => {
  assert.deepEqual(progress([{ status: "done" }, { status: "todo" }, { status: "doing" }, { status: "done" }]), {
    done: 2,
    total: 4,
    percent: 63,
  });
});

test("progress rises when checklist items are ticked", () => {
  assert.deepEqual(
    progress([
      {
        status: "todo",
        checklist: [{ done: true }, { done: true }, { done: false }, { done: false }],
      },
    ]),
    { done: 0, total: 1, percent: 33 },
  );
});

test("progress is zero when a project has no steps", () => {
  assert.deepEqual(progress([]), { done: 0, total: 0, percent: 0 });
});
