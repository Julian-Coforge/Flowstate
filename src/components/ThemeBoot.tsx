"use client";

import { useLayoutEffect } from "react";
import { applyTheme, readTheme } from "@/lib/theme";

/** Re-applies the stored theme after hydration (React can clear the head-script attribute). */
export default function ThemeBoot() {
  useLayoutEffect(() => {
    applyTheme(readTheme());
  }, []);
  return null;
}
