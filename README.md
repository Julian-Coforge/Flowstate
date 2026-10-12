# Flowstate

A personal planner: today's tasks, a calendar, and a canvas for each project.

The UI is a Next.js app. The API is Python FastAPI. Auth and data live in Supabase.

## Run with Docker (preferred)

Copy `.env.example` to `.env` and fill in your Supabase values.

```bash
docker compose up --build
```

Open http://localhost:3000

Demo account (created on backend start): `demo@flowstate.app` / `flowstate`

## Run locally without Docker

Terminal 1 — API:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m app.migrate
python -m app.seed
uvicorn app.main:app --reload --port 8000
```

Terminal 2 — UI:

```bash
npm install
npm run dev
```

## Env vars

| Name | Where |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser |
| `NEXT_PUBLIC_API_URL` | Browser (`http://localhost:8000`) |
| `SUPABASE_SECRET_KEY` | API only (seed / admin) |
| `DATABASE_URL` | API only (Postgres URI; URL-encode special characters in the password) |
| `CORS_ORIGINS` | API (`http://localhost:3000`) |
| `ANTHROPIC_API_KEY` | API only; omit to hide plan generation |
| `AI_MODEL_QUICK` / `AI_MODEL_THINKING` | API only |

Never commit `.env`.

## Features

Must: accounts, dashboard, project canvas, node notes/checklist/status, project tasks, persistence.

Should: shortcuts, due dates + calendar, progress, phone and laptop layout, dark mode.

Want: drag-to-link, recurring tasks, AI plan generation (when an Anthropic key is set).

Not in this build: real-time collaboration, native apps, calendar sync, GitHub/Outlook integrations.

## Tests

```bash
npm test
npm run typecheck
npm run lint
cd backend && python -m pytest
```
