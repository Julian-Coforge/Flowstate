export const STATUS_LABEL = {
  todo: "Not started",
  doing: "In progress",
  done: "Done",
} as const;

export const IMPORTANCE_LABEL = {
  low: "Low",
  medium: "Medium",
  high: "High",
} as const;

export const RECURRENCE_LABEL = {
  none: "Does not repeat",
  daily: "Every day",
  weekly: "Every week",
  monthly: "Every month",
} as const;

export const TASK_COLORS = {
  none: { label: "No colour", swatch: "bg-base-300" },
  rose: { label: "Work", swatch: "bg-rose-500" },
  green: { label: "Friends & family", swatch: "bg-emerald-500" },
  amber: { label: "Home", swatch: "bg-amber-500" },
  teal: { label: "Health", swatch: "bg-teal-500" },
  blue: { label: "Learning", swatch: "bg-sky-500" },
  violet: { label: "Travel", swatch: "bg-violet-500" },
} as const;
