"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { prefetchCalendar, prefetchDashboard } from "@/lib/data-cache";
import { createClient } from "@/lib/supabase/client";
import type { PublicUser } from "@/lib/types";
import SettingsModal from "./SettingsModal";

function initialsFor(name: string | null) {
  if (!name?.trim()) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

export default function AppHeader() {
  const pathname = usePathname();
  const [name, setName] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const initials = useMemo(() => initialsFor(name), [name]);

  useEffect(() => {
    api<{ user: PublicUser }>("/api/auth/me")
      .then((data) => setName(data.user.name))
      .catch(() => setName(null));
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as HTMLElement)) setMenuOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  function item(href: string, label: string) {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    const fromProject = pathname.startsWith("/projects/");
    return (
      <Link
        href={href}
        transitionTypes={fromProject ? ["nav-back"] : undefined}
        className={`nav-link btn btn-ghost btn-sm ${active ? "bg-primary/10 font-medium text-primary" : ""}`}
        onMouseEnter={() => {
          if (href === "/") prefetchDashboard();
          if (href === "/calendar") prefetchCalendar();
        }}
        onFocus={() => {
          if (href === "/") prefetchDashboard();
          if (href === "/calendar") prefetchCalendar();
        }}
      >
        {label}
      </Link>
    );
  }

  return (
    <>
      <header className="app-header navbar sticky top-0 z-30 min-h-16 w-full border-b border-base-300 bg-base-100/90 px-3 backdrop-blur-md sm:px-5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <Link
            href="/"
            transitionTypes={pathname.startsWith("/projects/") ? ["nav-back"] : undefined}
            className="display mr-2 text-xl font-semibold tracking-tight transition hover:text-primary"
            onMouseEnter={() => prefetchDashboard()}
            onFocus={() => prefetchDashboard()}
          >
            Flowstate
          </Link>
          {item("/", "Today")}
          {item("/calendar", "Calendar")}
        </div>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            className={`account-chip flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2.5 transition duration-200 ${
              menuOpen ? "bg-base-200/90 shadow-sm ring-1 ring-base-300" : "hover:bg-base-200/70"
            }`}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((current) => !current);
            }}
          >
            <span
              className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 text-[0.7rem] font-semibold tracking-wide text-primary ring-1 ring-primary/15"
              aria-hidden
            >
              {initials}
            </span>
            <span className="hidden max-w-[9.5rem] truncate text-sm font-medium tracking-tight text-base-content sm:block">
              {name ?? "Account"}
            </span>
            <svg
              viewBox="0 0 24 24"
              className={`mr-0.5 h-3.5 w-3.5 shrink-0 text-base-content/45 transition-transform duration-200 ${menuOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+0.55rem)] z-50 w-56 overflow-hidden rounded-2xl border border-base-300/80 bg-base-100/95 shadow-xl backdrop-blur-md"
            >
              <div className="border-b border-base-300/70 px-3.5 py-3">
                <p className="text-[0.65rem] font-medium uppercase tracking-[0.14em] text-base-content/45">Signed in</p>
                <p className="mt-0.5 truncate text-sm font-semibold tracking-tight">{name ?? "Account"}</p>
              </div>
              <div className="p-1.5">
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-base-200/80"
                  onClick={() => {
                    setMenuOpen(false);
                    setSettingsOpen(true);
                  }}
                >
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-base-200 text-base-content/70" aria-hidden>
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6" strokeLinecap="round" />
                    </svg>
                  </span>
                  Settings
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-base-200/80"
                  onClick={() => {
                    setMenuOpen(false);
                    void signOut();
                  }}
                >
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-base-200 text-base-content/70" aria-hidden>
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M10 7V5a2 2 0 0 1 2-2h7v18h-7a2 2 0 0 1-2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M15 12H4m0 0 3-3m-3 3 3 3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  Sign out
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </header>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
