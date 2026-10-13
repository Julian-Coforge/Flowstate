"use client";

import { TASK_COLORS } from "@/lib/labels";
import type { TaskColor } from "@/lib/types";

export default function ColorPicker({
  value,
  onChange,
}: {
  value: TaskColor;
  onChange: (color: TaskColor) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-1" role="radiogroup" aria-label="Task colour">
      {(Object.keys(TASK_COLORS) as TaskColor[]).map((color) => {
        const meta = TASK_COLORS[color];
        const selected = value === color;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            title={meta.label}
            aria-label={meta.label}
            onClick={() => onChange(color)}
            className={`color-swatch h-6 w-6 rounded-full border-2 ${meta.swatch} ${
              selected
                ? "border-primary shadow-sm ring-2 ring-primary/30 ring-offset-2 ring-offset-base-100"
                : "border-base-100 shadow-sm hover:border-base-content/20"
            }`}
          />
        );
      })}
    </div>
  );
}

export function ColorDot({ color }: { color: TaskColor | undefined }) {
  if (!color || color === "none") return null;
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${TASK_COLORS[color].swatch}`} aria-hidden />;
}
