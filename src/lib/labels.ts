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
