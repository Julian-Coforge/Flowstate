import assert from "node:assert/strict";
import test from "node:test";
import { addDays, isOnTodayList, isUpcoming, todayISO } from "./tasks";

test("today's list includes tasks due today, overdue open tasks, and undated open tasks", () => {
  const today = "2026-10-12";
  assert.equal(isOnTodayList({ done: false, dueDate: today }, today), true);
  assert.equal(isOnTodayList({ done: true, dueDate: today }, today), true);
  assert.equal(isOnTodayList({ done: false, dueDate: "2026-10-11" }, today), true);
  assert.equal(isOnTodayList({ done: true, dueDate: "2026-10-11" }, today), false);
  assert.equal(isOnTodayList({ done: false, dueDate: null }, today), true);
  assert.equal(isOnTodayList({ done: false, dueDate: "2026-10-13" }, today), false);
});

test("upcoming is the open tasks after today through the window", () => {
  const today = "2026-10-12";
  const until = addDays(today, 7);
  assert.equal(until, "2026-10-19");
  assert.equal(isUpcoming({ done: false, dueDate: "2026-10-15" }, today, until), true);
  assert.equal(isUpcoming({ done: false, dueDate: today }, today, until), false);
  assert.equal(isUpcoming({ done: true, dueDate: "2026-10-15" }, today, until), false);
});

test("todayISO uses the local calendar date", () => {
  assert.equal(todayISO(new Date(2026, 9, 12)), "2026-10-12");
});
