"use client";

import { useState } from "react";
import { applyTheme, readTheme, type Theme } from "@/lib/theme";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => (typeof window === "undefined" ? "light" : readTheme()));

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
  }

  return (
    <button className="btn btn-ghost btn-sm" type="button" onClick={toggle} aria-label="Switch colour theme">
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
