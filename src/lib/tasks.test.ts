import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays,
  formatWeekRange,
  isOnTodayList,
  isOverdue,
  isUpcoming,
  shiftMonth,
  startOfWeek,
  todayISO,
} from "./tasks";

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

test("isOverdue is true for open work past its due date", () => {
  const today = "2026-10-12";
  assert.equal(isOverdue({ done: false, dueDate: "2026-10-11" }, today), true);
  assert.equal(isOverdue({ done: true, dueDate: "2026-10-11" }, today), false);
  assert.equal(isOverdue({ status: "doing", dueDate: "2026-10-11" }, today), true);
  assert.equal(isOverdue({ status: "done", dueDate: "2026-10-11" }, today), false);
  assert.equal(isOverdue({ done: false, dueDate: today }, today), false);
  assert.equal(isOverdue({ done: false, dueDate: null }, today), false);
});

test("startOfWeek is Monday and formatWeekRange reads clearly", () => {
  assert.equal(startOfWeek("2026-10-14"), "2026-10-12");
  assert.equal(formatWeekRange("2026-10-12"), "12–18 October 2026");
  assert.equal(shiftMonth("2026-01-31", 1), "2026-02-28");
});
