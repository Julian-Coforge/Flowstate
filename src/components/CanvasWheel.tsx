"use client";

import { useEffect } from "react";

export type WheelAction = {
  id: string;
  label: string;
  icon: "add" | "link" | "delete" | "tidy" | "undo" | "clear";
  run: () => void;
  danger?: boolean;
  disabled?: boolean;
};

type Props = {
  x: number;
  y: number;
  actions: WheelAction[];
  hoveredId: string | null;
  onClose: () => void;
};

export const WHEEL_RADIUS = 36;
export const WHEEL_BUTTON = 36;

function WheelIcon({ name }: { name: WheelAction["icon"] }) {
  const common = "h-4 w-4";
  switch (name) {
    case "add":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
      );
    case "link":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L10.5 5.5" strokeLinecap="round" />
          <path d="M14 11a5 5 0 0 0-7.07 0L4.8 13.12a5 5 0 0 0 7.07 7.07L13.5 18.5" strokeLinecap="round" />
        </svg>
      );
    case "delete":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <path d="M4 7h16M9 7V5h6v2M10 11v6M14 11v6M6 7l1 12h10l1-12" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "tidy":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <path d="M4 6h6v6H4zM14 6h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" strokeLinejoin="round" />
        </svg>
      );
    case "undo":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <path d="M9 14H4v-5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 9a9 9 0 1 1 2.6 6.4" strokeLinecap="round" />
        </svg>
      );
    case "clear":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <circle cx="12" cy="12" r="8" />
          <path d="M8 8l8 8" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}

/** Hit-test by pie sector (release anywhere in a slice) with a small center dead zone. */
export function wheelActionAtPoint(
  originX: number,
  originY: number,
  clientX: number,
  clientY: number,
  actions: WheelAction[],
): string | null {
  if (!actions.length) return null;
  const dx = clientX - originX;
  const dy = clientY - originY;
  const dist = Math.hypot(dx, dy);
  const inner = 8;
  const outer = WHEEL_RADIUS + WHEEL_BUTTON * 0.65;
  if (dist < inner || dist > outer) return null;

  // Buttons start at top (-PI/2); map pointer angle into that same space.
  let angle = Math.atan2(dy, dx) + Math.PI / 2;
  if (angle < 0) angle += Math.PI * 2;
  const slice = (Math.PI * 2) / actions.length;
  const index = Math.floor(angle / slice) % actions.length;
  return actions[index]?.id ?? null;
}

export default function CanvasWheel({ x, y, actions, hoveredId, onClose }: Props) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const usable = actions.length || 1;

  return (
    <div className="pointer-events-none fixed inset-0 z-40" role="menu" aria-label="Canvas actions">
      <div
        className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow"
        style={{ left: x, top: y }}
      />
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/20 bg-base-100/10"
        style={{ left: x, top: y, width: WHEEL_RADIUS * 2 + WHEEL_BUTTON, height: WHEEL_RADIUS * 2 + WHEEL_BUTTON }}
      />
      {actions.map((action, index) => {
        const angle = (index / usable) * Math.PI * 2 - Math.PI / 2;
        const left = x + Math.cos(angle) * WHEEL_RADIUS;
        const top = y + Math.sin(angle) * WHEEL_RADIUS;
        const active = hoveredId === action.id;
        return (
          <div
            key={action.id}
            role="menuitem"
            aria-label={action.label}
            aria-disabled={action.disabled || undefined}
            className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-md transition ${
              action.disabled
                ? "border-base-300/50 bg-base-200 text-base-content/30"
                : action.danger
                  ? active
                    ? "scale-110 border-error bg-error text-error-content"
                    : "border-error/40 bg-base-100 text-error"
                  : active
                    ? "scale-110 border-primary bg-primary text-primary-content"
                    : "border-base-300 bg-base-100 text-base-content"
            }`}
            style={{ left, top, width: WHEEL_BUTTON, height: WHEEL_BUTTON }}
          >
            <WheelIcon name={action.icon} />
          </div>
        );
      })}
    </div>
  );
}
