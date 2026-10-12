# Flowstate

A personal planner: today's tasks, a calendar, and a canvas for each project.

The API is a REST surface implemented as Next.js route handlers. The proposal names Clerk for sign-in. This local setup uses email and password sessions so the app runs without third-party keys. Every project and task is still stored against a user id.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000

Demo account: `demo@flowstate.app` / `flowstate`

```bash
npm test
```
