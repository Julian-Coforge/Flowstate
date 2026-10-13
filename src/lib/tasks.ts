export function todayISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(iso: string, days: number) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return todayISO(date);
}

export function formatLong(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = date.toLocaleDateString("en-GB", { weekday: "long" });
  const monthName = date.toLocaleDateString("en-GB", { month: "long" });
  return `${weekday} ${day} ${monthName}`;
}

export function formatMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export function formatYear(year: number) {
  return String(year);
}

/** Monday-start week containing `iso`. */
export function startOfWeek(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return todayISO(date);
}

export function formatWeekRange(startIso: string) {
  const endIso = addDays(startIso, 6);
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  const start = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  if (sy === ey && sm === em) {
    const month = start.toLocaleDateString("en-GB", { month: "long" });
    return `${sd}–${ed} ${month} ${sy}`;
  }
  if (sy === ey) {
    const startMonth = start.toLocaleDateString("en-GB", { month: "short" });
    const endMonth = end.toLocaleDateString("en-GB", { month: "short" });
    return `${sd} ${startMonth} – ${ed} ${endMonth} ${sy}`;
  }
  const startMonth = start.toLocaleDateString("en-GB", { month: "short" });
  const endMonth = end.toLocaleDateString("en-GB", { month: "short" });
  return `${sd} ${startMonth} ${sy} – ${ed} ${endMonth} ${ey}`;
}

export function shiftMonth(iso: string, delta: number) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  const maxDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, maxDay));
  return todayISO(date);
}

export function shiftYear(iso: string, delta: number) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year + delta, month - 1, 1);
  const maxDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, maxDay));
  return todayISO(date);
}

type Dated = { done: boolean; dueDate: string | null };

export function isOnTodayList(task: Dated, today: string) {
  if (task.dueDate === today) return true;
  if (task.done) return false;
  if (!task.dueDate) return true;
  return task.dueDate < today;
}

export function isUpcoming(task: Dated, today: string, until: string) {
  if (task.done || !task.dueDate) return false;
  return task.dueDate > today && task.dueDate <= until;
}

export function isOverdue(task: { done?: boolean; status?: string; dueDate: string | null }, today: string) {
  if (!task.dueDate || task.dueDate >= today) return false;
  if (typeof task.done === "boolean") return !task.done;
  return task.status !== "done";
}
