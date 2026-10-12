# Flowstate: Implementation Plan

Source: `Flowstate-Proposal-updated.pptx` (9 slides, updated 12 Oct 2026). Audience: the next implementing agent.
Read `AGENTS.md` first: this Next.js (16.x) has breaking changes, so consult `node_modules/next/dist/docs/` before writing Next-specific code (e.g. `src/proxy.ts` replaces `middleware.ts`).

## 1. Product summary (from the slides)

One app replacing a separate calendar, to-do list and project planner. Three pillars:

1. **Dashboard** ("Progress page"): today's date, today's to-do list, project cards with progress bars, search and create-project in the top bar. Click a card to open its canvas.
2. **Project canvas**: React Flow node-and-link graph. Each node has title, description, importance; click a node for notes, checklist and completion status. A node can link to many others. Project to-do list docked on the right. Toolbar to create/delete/link nodes, with keyboard shortcuts.
3. **Calendar view**: due dates from every project's tasks.

Audience is non-technical personal planners as well as developers: plain words, very few controls. The slides say Flowstate's own UI will be simpler than the inspiration screenshots.

Progress = completed nodes / all nodes. One `todos` table feeds project list, today list and calendar. Zod validates every request and every AI reply before saving. A user id is stored on every project and task.

### Scope (slide 9)

| Tier | Items |
|---|---|
| Must | Sign-in/personal accounts; dashboard with date + today's to-dos; create/search projects; canvas with nodes and links; node notes/checklist/status; project to-do list; persistent state |
| Should | Keyboard shortcuts; due dates + calendar view; per-project progress; works on phone and laptop |
| Want | AI plan generation (quick + thinking modes); recurring tasks; drag-to-link on canvas |
| Not now | Real-time collaboration; native apps; calendar sync; GitHub/Outlook/other integrations |

The notes frame this as a **24-hour build**. Cut from the bottom of "Want" first.

## 2. Current state of the repo (verified 12 Oct 2026)

Location: `/Users/Julian.Marchington/Repos/flowstate/flowstate` (the proposal pptx is one level up). Git: single "Initial commit"; almost everything is **untracked**. Commit a baseline before changing anything.

`npm test` passes (9 tests) and `tsc --noEmit` is clean.

Already built, about 2,700 lines:

- **Stack**: Next.js 16 App Router, React 19, TS, Tailwind 4 + DaisyUI 5, `@xyflow/react` 12, Zod 4, Drizzle ORM + `better-sqlite3`.
- **Auth**: local email/password with session cookie `flowstate_session` (`src/server/auth.ts`, `password.ts`, `/api/auth/*`), route guard in `src/proxy.ts`. Seeded demo user `demo@flowstate.app` / `flowstate`.
- **DB** (`src/db/schema.ts`, `index.ts`, `seed.ts`): users, sessions, projects, nodes, edges (unique per project/source/target), checklist_items, todos. SQLite file at `data/flowstate.db` (git-ignored). Schema is created by raw SQL in `db/index.ts` and is duplicated in `schema.ts`, so keep them in sync.
- **API** (`src/app/api/**`): auth, projects (+search `?q=`), nodes, edges, checklist, todos, health. All use `requireUser()` and `parseBody(zodSchema)`. Data logic is in `src/server/store.ts` (364 lines, ownership checks via `ownedProject`).
- **UI**: `Dashboard.tsx` (date header, create project, search, project cards, today list), `ProjectCanvas.tsx` (616 lines; has `onConnect` drag-to-link and a `keydown` handler), `CalendarView.tsx`, `AppHeader.tsx`, `login/page.tsx`.
- **Pure logic with tests** (`src/lib`): `progress`, `tasks` (today/upcoming rules), `edges` (`canLink` rejects duplicate and cross-project links).

Not present: AI generation, recurring tasks, any Supabase code, a dark-mode toggle (only `data-theme="light"`), automated API or UI tests, an `.env.example`, a `docs/` folder.

## 3. Decisions the next agent must confirm or default

**D1. Backend/auth/DB: the slides and the repo disagree.** Slide 8 says Supabase Auth + Supabase DB, with Next.js route handlers as the REST API. The speaker notes (stale) say Node/Express + PostgreSQL. The README says the proposal named Clerk. The repo implements SQLite + local sessions "so it runs without third-party keys". **Default: keep SQLite/local auth as the working baseline** (it already satisfies every Must-have and runs offline), keep all DB access behind `src/server/store.ts`, and treat Supabase as the Phase 7 migration. Ask the user whether the Supabase migration is required for submission. If it is, do Phase 7 before any "Want" items. Also tell the user the notes on slide 8 are out of date.

**D2. AI model IDs.** Originally Claude Haiku/Sonnet; this repo uses OpenAI instead: `gpt-4o-mini` (quick) and `gpt-4o` (thinking). Put both IDs in env/config, not hard-coded in routes.

**D3. Simplified canvas.** Slide 6 says the canvas is "inspiration only" and "simpler". Do not chase the screenshots' feature set.

## 4. Phases

Each phase ends green: `npm test`, `npm run typecheck`, `npm run lint`, and a manual check in the browser. Commit per phase. Use TDD for any pure logic (`src/lib/*.test.ts` pattern; the test glob is `src/lib/*.test.ts`, so API/store tests need the script widened).

### Phase 0: Baseline (≈0.5h)
- `git add` the project, fix `.gitignore` (already ignores `.next`, `data/*.db*`, `.env*`), commit "baseline scaffold". Remove `tsconfig.tsbuildinfo` from tracking.
- Run `npm install && npm run dev`; log in as demo; click through dashboard, a project canvas, calendar. Record anything broken in `docs/KNOWN_ISSUES.md`.
- Add `npm run lint` check; fix lint errors.
- Add `.env.example` (empty vars for later phases).

### Phase 1: Verify and harden Must-haves (≈3h)
Walk each Must-have against the code and fix gaps; write tests as you go.
1. **Accounts**: register, login, logout, expired session; `proxy.ts` redirects; no cross-user access. Add store-level tests that user B cannot read/patch user A's project, node, edge, checklist item or todo (every route must go through an ownership check).
2. **Dashboard**: shows long date, today's list (`isOnTodayList`), project cards with progress and open task count, create + search projects.
3. **Canvas**: create/delete node, link, unlink, drag persists `x`/`y` (debounce position PATCHes), importance, description. Node panel: notes, checklist add/toggle/delete, status todo/doing/done.
4. **Project to-do list** docked right; adding a task links it to the project and optionally a node; completing it updates the dashboard and calendar.
5. **Persistence**: reload and restart server; data survives.
6. Error/empty/loading states in plain words (audience is non-technical).

### Phase 2: Should-haves (≈4h)
- **Keyboard shortcuts**: confirm what `ProjectCanvas.tsx`'s keydown handler covers. Target: `N` new node, `Delete`/`Backspace` delete selected node or edge, `L` link mode (or `Shift`-drag), `Esc` deselect, `?` shortcut cheat-sheet. Ignore shortcuts while typing in inputs/textareas. Show shortcuts in toolbar tooltips.
- **Due dates + calendar**: task due-date picker in the project list and node panel; `CalendarView` month grid showing tasks per day, overdue styling, click a day to see/add tasks; upcoming window on the dashboard (`isUpcoming`).
- **Progress**: already node-based; make sure deleting nodes and status changes refresh the card and the canvas header. Consider also showing checklist completion on nodes, but keep the project figure as nodes done / total.
- **Responsive**: test at 375px and 1280px. Canvas on phone: panel becomes a bottom sheet, toolbar scrolls horizontally, tap-to-link fallback since drag is hard on touch. Dashboard cards stack.
- **Dark mode** (the slides list "DaisyUI for consistent theme (and dark mode)"): add a second DaisyUI theme in `globals.css`, a header toggle, persisted in `localStorage`, defaulting to `prefers-color-scheme`; remove the hard-coded `data-theme="light"` or set it from a pre-hydration script to avoid flash.

### Phase 3: Quality gate for the core (≈2h)
- Widen the test script to include `src/server/*.test.ts`; run store tests against a temp SQLite file (set via env var in `db/index.ts`) so they never touch `data/flowstate.db`.
- Smoke-test all API routes with an authenticated session: 401 when logged out, 400 on bad bodies (Zod), 404 on others' ids.
- Playwright (or the in-app browser) pass over the login → create project → add nodes → link → complete → see progress and calendar journey. Capture screenshots for the presentation.

### Phase 4: Want-to-have: drag-to-link and recurring tasks (≈3h)
- **Drag-to-link**: `onConnect` already exists. Verify handles are large enough, reject self-links and duplicates via `canLink`, show a toast on rejection, and support edge deletion by click+Delete.
- **Recurring tasks** (daily/weekly/monthly): add `recurrence` (`none|daily|weekly|monthly`) to `todos` (schema + SQL + Zod + type). Completing a recurring task marks it done and creates the next occurrence from `addDays`/month math in `src/lib/tasks.ts` (pure function, tested, including month-end clamping). Show a repeat icon on the task.

### Phase 5: AI plan generation (≈5h, optional, product works without it)
Server only, never expose the key to the client.
- Env: `OPENAI_API_KEY`, `AI_MODEL_QUICK=gpt-4o-mini`, `AI_MODEL_THINKING=gpt-4o`. If the key is absent, hide the "Generate a plan" box and return a clear 503 from the route.
- Route `POST /api/projects/[id]/generate` (or accept it on project create): body `{ idea: string (≤500 chars), mode: "quick" | "thinking" }`.
- Zod `planSchema` for the AI reply: `{ nodes: [{ key, title, description, importance, checklist: string[] }], edges: [{ from, to }], todos: [{ text, nodeKey? }] }` with limits: quick 5–8 nodes, thinking 10–20; unique keys; edges reference existing keys; no self-links or duplicates (reuse `canLink`); string length caps. Request structured output / JSON only, parse, **validate before saving**, retry once on invalid output, then return a friendly error.
- Save in one DB transaction: nodes with auto-layout positions (simple layered layout by edge depth, or `dagre`), edges, checklist items, todos. Nothing is saved if validation fails.
- Thinking mode uses extended reasoning on the larger model; set a request timeout and show progress UI. Rate-limit per user (e.g. 5/hour) and cap `max_tokens`.
- UI: "Generate a plan" textarea + Quick/Thinking toggle on project creation; on success open the canvas with the new nodes, all editable. Treat the idea text as untrusted data in the prompt.
- Tests: schema accepts a good fixture and rejects malformed ones; transaction rollback; route behaviour with the client mocked.

### Phase 6: Polish and presentation (≈2h)
- Plain-language copy audit, empty states, focus rings, aria labels (React Flow nodes need accessible names), color contrast in both themes.
- Update `README.md` with run instructions, env vars, feature list, and what was cut. Final seed data that demos well (one technical project, one personal project such as "Moving house").

### Phase 7: Supabase migration (only if D1 says required; ≈4–6h)
- Create Supabase project; tables mirror `schema.ts` (uuid PKs, `user_id` = `auth.users.id`, FKs with cascade, unique edge constraint, `todos.due_date` as `date`).
- Auth: Supabase Auth with `@supabase/ssr` cookies; replace `server/auth.ts`, the auth routes and `proxy.ts` session check; drop `users`/`sessions`/password code. Keep the same `PublicUser` shape so UI is unchanged.
- Data: swap Drizzle driver to `drizzle-orm/postgres-js` (or supabase-js) behind the existing `store.ts` function signatures; convert the synchronous `.get()/.all()/.run()` calls to async, including the callers (route handlers already `await`).
- Enable **Row Level Security** on every table as defence in depth in addition to the existing `ownedProject` checks.
- Move seed to a script; env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, server-only service key and `DATABASE_URL`. Never commit them.

## 5. Cross-cutting rules

- **Security floor**: every query is scoped by the session user id; Zod on every request body and every AI reply; secrets only in `.env.local`; the AI key only on the server; session cookie `httpOnly`, `sameSite=lax`, `secure` in production; escape/render notes as text (no `dangerouslySetInnerHTML`).
- **Out of scope**: real-time collaboration, native apps, calendar sync, GitHub/Outlook integrations. Do not start them.
- **Order of cuts if time runs short**: Phase 7 (unless required) → Phase 5 → recurring tasks → drag-to-link polish → dark mode.
- **Definition of done**: all Must and Should items work on laptop and phone widths; tests and typecheck and lint pass; README accurate; demo data seeded.

## 6. Key files

| Concern | File |
|---|---|
| Data access + ownership | `src/server/store.ts` |
| Request validation | `src/lib/validators.ts` |
| Types shared client/server | `src/lib/types.ts` |
| Today/upcoming/date logic | `src/lib/tasks.ts` |
| Link rules | `src/lib/edges.ts` |
| Progress | `src/lib/progress.ts` |
| Schema | `src/db/schema.ts` + raw SQL in `src/db/index.ts` |
| Canvas UI | `src/components/ProjectCanvas.tsx` |
| Dashboard / Calendar | `src/components/Dashboard.tsx`, `CalendarView.tsx` |
| Route guard | `src/proxy.ts` |
