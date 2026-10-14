"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { applyTheme, readTheme, type Theme } from "@/lib/theme";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function SettingsModal({ open, onClose }: Props) {
  const [theme, setTheme] = useState<Theme>("light");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTheme(readTheme());
    setMessage(null);
    setError(null);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setDeleteConfirm("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function setColour(next: Theme) {
    setTheme(next);
    applyTheme(next);
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (newPassword.length < 8) {
      setError("Use at least 8 characters for the new password");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }
    setPasswordBusy(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("Sign in required");
      const { error: signed } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (signed) throw new Error("Current password is wrong");
      const { error: updated } = await supabase.auth.updateUser({ password: newPassword });
      if (updated) throw new Error(updated.message || "Could not change the password");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("Password updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the password");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function deleteAccount() {
    setError(null);
    setMessage(null);
    if (deleteConfirm.trim().toLowerCase() !== "delete") {
      setError('Type “delete” to confirm');
      return;
    }
    if (!confirm("This permanently deletes your account and all projects. Continue?")) return;
    setDeleteBusy(true);
    try {
      await api("/api/auth/account", { method: "DELETE" });
      const supabase = createClient();
      await supabase.auth.signOut();
      window.location.href = "/login";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the account");
      setDeleteBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]" role="dialog" aria-modal="true" aria-label="Settings">
      <button
        className="absolute inset-0 cursor-default bg-base-content/15 backdrop-blur-xl"
        type="button"
        aria-label="Close settings"
        onClick={onClose}
      />
      <div className="panel relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-base-300/80 bg-base-100/90 shadow-2xl backdrop-blur-md">
        <div className="border-b border-base-300/70 bg-gradient-to-br from-primary/8 via-transparent to-transparent px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-primary">Account</p>
              <h2 className="mt-0.5 text-xl font-semibold tracking-tight">Settings</h2>
            </div>
            <button className="btn btn-ghost btn-sm btn-square" type="button" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="space-y-5 p-5">
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-base-content/55">Appearance</h3>
            <div className="mt-2.5 grid grid-cols-2 gap-2 rounded-xl border border-base-300/80 bg-base-200/40 p-1">
              <button
                type="button"
                className={`btn btn-sm border-0 ${theme === "light" ? "btn-primary shadow-sm" : "btn-ghost"}`}
                onClick={() => setColour("light")}
              >
                Light
              </button>
              <button
                type="button"
                className={`btn btn-sm border-0 ${theme === "dark" ? "btn-primary shadow-sm" : "btn-ghost"}`}
                onClick={() => setColour("dark")}
              >
                Dark
              </button>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-base-content/55">Change password</h3>
            <form className="mt-2.5 grid gap-2.5" onSubmit={(event) => void changePassword(event)}>
              <input
                className="input w-full bg-base-100/80"
                type="password"
                autoComplete="current-password"
                placeholder="Current password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
              <input
                className="input w-full bg-base-100/80"
                type="password"
                autoComplete="new-password"
                placeholder="New password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
              <input
                className="input w-full bg-base-100/80"
                type="password"
                autoComplete="new-password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
              <button className="btn btn-primary btn-sm mt-0.5" type="submit" disabled={passwordBusy}>
                {passwordBusy ? "Updating…" : "Update password"}
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-error/25 bg-error/[0.04] p-3.5">
            <h3 className="text-sm font-semibold text-error">Delete account</h3>
            <p className="mt-1 text-sm leading-relaxed text-base-content/65">
              Removes your account, projects, steps, and tasks. This cannot be undone.
            </p>
            <input
              className="input mt-3 w-full bg-base-100/80"
              placeholder='Type “delete” to confirm'
              value={deleteConfirm}
              onChange={(event) => setDeleteConfirm(event.target.value)}
              aria-label="Type delete to confirm"
            />
            <button className="btn btn-error btn-sm mt-2.5" type="button" disabled={deleteBusy} onClick={() => void deleteAccount()}>
              {deleteBusy ? "Deleting…" : "Delete my account"}
            </button>
          </section>

          {message ? <p className="text-sm text-success">{message}</p> : null}
          {error ? (
            <p className="text-sm text-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
