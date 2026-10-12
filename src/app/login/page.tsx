"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [mode, setMode] = useState<"sign-in" | "create">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const supabase = createClient();
    try {
      if (mode === "create") {
        const { data, error: created } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name } },
        });
        if (created) throw created;
        if (!data.session) {
          setError("Check your email to confirm the account, then sign in.");
          setPending(false);
          return;
        }
      } else {
        const { error: signed } = await supabase.auth.signInWithPassword({ email, password });
        if (signed) throw signed;
      }
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
      setPending(false);
    }
  }

  async function signInWithDemo() {
    setMode("sign-in");
    setEmail("demo@flowstate.app");
    setPassword("flowstate");
    setPending(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: signed } = await supabase.auth.signInWithPassword({
        email: "demo@flowstate.app",
        password: "flowstate",
      });
      if (signed) throw signed;
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <p className="text-sm font-medium uppercase tracking-[0.14em] text-primary">Flowstate</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Your day, your projects, one place.</h1>
        <p className="mt-3 text-base-content/70">A planner for what is due, and a canvas for how the work fits together.</p>

        <form onSubmit={(event) => void submit(event)} className="mt-8 rounded-lg border border-base-300 bg-base-100 p-5">
          <div className="mb-4 flex gap-2">
            <button type="button" className={`btn btn-sm ${mode === "sign-in" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("sign-in")}>
              Sign in
            </button>
            <button type="button" className={`btn btn-sm ${mode === "create" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("create")}>
              Create account
            </button>
          </div>

          {mode === "create" ? (
            <label className="mb-3 block text-sm">
              Name
              <input className="input mt-1 w-full" value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
          ) : null}

          <label className="mb-3 block text-sm">
            Email
            <input
              className="input mt-1 w-full"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="mb-4 block text-sm">
            Password
            <input
              className="input mt-1 w-full"
              type="password"
              autoComplete={mode === "create" ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={mode === "create" ? 8 : 1}
            />
          </label>

          {error ? (
            <p className="mb-3 text-sm text-error" role="alert">
              {error}
            </p>
          ) : null}

          <button className="btn btn-primary w-full" type="submit" disabled={pending}>
            {pending ? "Please wait…" : mode === "create" ? "Create account" : "Sign in"}
          </button>
        </form>

        <button className="btn btn-link mt-3 px-0" type="button" onClick={() => void signInWithDemo()}>
          Use the demo account
        </button>
        <p className="text-sm text-base-content/60">demo@flowstate.app · flowstate</p>
      </div>
    </main>
  );
}
