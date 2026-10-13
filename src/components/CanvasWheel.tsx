"use client";

import { useEffect } from "react";

export type WheelAction = {
  id: string;
  label: string;
  run: () => void;
  danger?: boolean;
  disabled?: boolean;
};

type Props = {
  x: number;
  y: number;
  actions: WheelAction[];
  onClose: () => void;
};

const RADIUS = 96;
const BUTTON = 58;

export default function CanvasWheel({ x, y, actions, onClose }: Props) {
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
      <button className="pointer-events-auto absolute inset-0 cursor-default bg-transparent" type="button" aria-label="Dismiss" onClick={onClose} />
      <div
        className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow"
        style={{ left: x, top: y }}
      />
      <div
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/30 bg-base-100/20"
        style={{ left: x, top: y, width: RADIUS * 2 + BUTTON, height: RADIUS * 2 + BUTTON }}
      />
      {actions.map((action, index) => {
        const angle = (index / usable) * Math.PI * 2 - Math.PI / 2;
        const left = x + Math.cos(angle) * RADIUS;
        const top = y + Math.sin(angle) * RADIUS;
        return (
          <button
            key={action.id}
            type="button"
            role="menuitem"
            disabled={action.disabled}
            className={`pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-center text-xs font-semibold shadow-lg transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40 ${
              action.danger
                ? "border-error/40 bg-error text-error-content"
                : "border-base-300 bg-base-100 text-base-content hover:border-primary"
            }`}
            style={{ left, top, width: BUTTON, height: BUTTON }}
            onClick={() => {
              if (action.disabled) return;
              action.run();
              onClose();
            }}
          >
            <span className="px-1 leading-tight">{action.label}</span>
          </button>
        );
      })}
    </div>
  );
}
