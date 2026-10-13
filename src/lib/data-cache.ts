"use client";

import { api } from "@/lib/api";

type Entry<T> = {
  data?: T;
  at: number;
  inflight: Promise<T> | null;
};

const memory = new Map<string, Entry<unknown>>();

/** Serve without a network wait if younger than this. */
const FRESH_MS = 45_000;
/** Drop entries older than this. */
const MAX_AGE_MS = 15 * 60_000;

export function projectsListPath(query = "", status = "active") {
  return `/api/projects?q=${encodeURIComponent(query)}&status=${status}`;
}

export function projectBundlePath(projectId: string) {
  return `/api/projects/${projectId}`;
}

export const CALENDAR_PATH = "/api/calendar";
/** Same payload as `GET /api/projects` (defaults to active). */
export const PROJECTS_ALL_PATH = projectsListPath("", "active");

export function peekCached<T>(key: string): T | undefined {
  const entry = memory.get(key) as Entry<T> | undefined;
  if (!entry || entry.data === undefined) return undefined;
  if (Date.now() - entry.at > MAX_AGE_MS) {
    memory.delete(key);
    return undefined;
  }
  return entry.data;
}

export function putCached<T>(key: string, data: T): void {
  const existing = memory.get(key) as Entry<T> | undefined;
  memory.set(key, {
    data,
    at: Date.now(),
    inflight: existing?.inflight ?? null,
  });
}

export function invalidateCached(match?: string | RegExp): void {
  if (!match) {
    memory.clear();
    return;
  }
  for (const key of [...memory.keys()]) {
    const hit = typeof match === "string" ? key.includes(match) : match.test(key);
    if (hit) memory.delete(key);
  }
}

/** Drop list/calendar caches after project or task mutations. */
export function invalidateLists(): void {
  invalidateCached("/api/projects");
  invalidateCached(CALENDAR_PATH);
  invalidateCached("/api/todos");
}

/**
 * GET helper with short-lived memory cache and request dedupe.
 * Callers should `peekCached` first for instant paint, then await this to revalidate.
 */
export async function cachedGet<T>(path: string, options?: { force?: boolean; freshMs?: number }): Promise<T> {
  const freshMs = options?.freshMs ?? FRESH_MS;
  const entry = (memory.get(path) as Entry<T> | undefined) ?? { at: 0, inflight: null };
  const now = Date.now();

  if (!options?.force && entry.data !== undefined && now - entry.at < freshMs) {
    return entry.data;
  }

  if (entry.inflight) return entry.inflight;

  const inflight = api<T>(path)
    .then((data) => {
      memory.set(path, { data, at: Date.now(), inflight: null });
      return data;
    })
    .catch((err) => {
      const current = memory.get(path) as Entry<T> | undefined;
      if (current) current.inflight = null;
      throw err;
    });

  memory.set(path, { data: entry.data, at: entry.at, inflight });
  return inflight;
}

export function prefetchProject(projectId: string): void {
  void cachedGet(projectBundlePath(projectId));
}

export function prefetchCalendar(): void {
  void cachedGet(CALENDAR_PATH);
  void cachedGet(PROJECTS_ALL_PATH);
}

export function prefetchDashboard(query = "", status: "active" | "archived" = "active"): void {
  void cachedGet(projectsListPath(query, status));
  void cachedGet(CALENDAR_PATH);
}
