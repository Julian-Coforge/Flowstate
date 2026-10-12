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
