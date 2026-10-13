"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { prefetchCalendar, prefetchDashboard } from "@/lib/data-cache";
import { createClient } from "@/lib/supabase/client";
import type { PublicUser } from "@/lib/types";
import SettingsModal from "./SettingsModal";

export default function AppHeader() {
  const pathname = usePathname();
  const [name, setName] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    api<{ user: PublicUser }>("/api/auth/me")
      .then((data) => setName(data.user.name))
      .catch(() => setName(null));
  }, []);

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
      <header className="navbar min-h-16 w-full border-b border-base-300 bg-base-100/95 px-3 shadow-sm backdrop-blur sm:px-5">
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
        <div className="flex items-center gap-2">
          {name ? <span className="hidden text-sm text-base-content/70 sm:inline">{name}</span> : null}
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
