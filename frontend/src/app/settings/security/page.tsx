"use client";

import { FormEvent, useEffect, useState } from "react";
import { KeyRound, Loader2, LogOut, ShieldCheck, ShieldEllipsis } from "lucide-react";
import { toast } from "sonner";
import { AuthRequiredState } from "@/components/auth/AuthRequiredState";
import { PasswordField } from "@/components/auth/PasswordField";
import { PasswordRequirements } from "@/components/auth/PasswordRequirements";
import { useStore } from "@/hooks/useStore";
import { genericAuthError, passwordValidationError } from "@/lib/password-policy";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type SignOutScope = "local" | "global";

export default function SecuritySettingsPage() {
  const authMode = useStore((state) => state.authMode);
  const authUser = useStore((state) => state.authUser);
  const setWorkspaceId = useStore((state) => state.setWorkspaceId);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [signingOut, setSigningOut] = useState<SignOutScope | null>(null);

  useEffect(() => {
    if (authMode !== "authenticated") return;
    let active = true;
    const supabase = createSupabaseBrowserClient();
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setVerified(Boolean(data.user?.email_confirmed_at));
    });
    return () => {
      active = false;
    };
  }, [authMode]);

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = passwordValidationError(password, confirmation);
    setFormError(validationError);
    if (validationError) return;

    setChangingPassword(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword("");
      setConfirmation("");
      toast.success("Password changed");
    } catch {
      const message = genericAuthError("password-update");
      setFormError(message);
      toast.error(message);
    } finally {
      setChangingPassword(false);
    }
  };

  const signOut = async (scope: SignOutScope) => {
    setSigningOut(scope);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signOut({ scope });
      if (error) throw error;
      setWorkspaceId(null);
      toast.success(scope === "local" ? "Current session signed out" : "All sessions signed out");
    } catch {
      toast.error("We could not sign out the requested sessions. Please try again.");
    } finally {
      setSigningOut(null);
    }
  };

  if (authMode !== "authenticated") {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-4 py-8">
          <AuthRequiredState
            authMode={authMode}
            nextPath="/settings/security"
            title="Sign in to manage account security"
            description="Password and session controls require a verified account session."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 md:px-6 md:py-8">
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} className="text-brand-500" />
          <h2 className="text-lg font-bold">Account Security</h2>
        </div>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Signed-in account</h3>
              <p className="mt-1 truncate text-sm text-[var(--text-muted)]">
                {authUser?.email ?? "Email unavailable"}
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${verified ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}
            >
              {verified === null ? "Checking verification" : verified ? "Email verified" : "Verification pending"}
            </span>
          </div>
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 md:p-5">
          <div className="mb-4 flex items-center gap-2">
            <KeyRound size={17} className="text-brand-500" />
            <h3 className="text-sm font-semibold">Change password</h3>
          </div>
          <form onSubmit={changePassword} className="space-y-4">
            <PasswordField
              id="security-new-password"
              label="New password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              disabled={changingPassword}
            />
            <PasswordField
              id="security-new-password-confirmation"
              label="Confirm new password"
              value={confirmation}
              onChange={setConfirmation}
              autoComplete="new-password"
              disabled={changingPassword}
            />
            <PasswordRequirements password={password} />
            {formError ? (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {formError}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={changingPassword || !password || !confirmation}
              className="flex h-10 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
            >
              {changingPassword ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
              {changingPassword ? "Changing password" : "Change password"}
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 md:p-5">
          <div className="mb-4 flex items-center gap-2">
            <ShieldEllipsis size={17} className="text-brand-500" />
            <h3 className="text-sm font-semibold">Sessions</h3>
          </div>
          <p className="mb-4 text-sm leading-6 text-[var(--text-muted)]">
            Current-session sign out leaves your other devices active. All-session sign out revokes
            refresh sessions everywhere; existing access tokens expire according to Supabase policy.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void signOut("local")}
              disabled={signingOut !== null}
              className="flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 text-sm font-semibold transition hover:bg-[var(--bg-hover)] disabled:opacity-50"
            >
              {signingOut === "local" ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}
              Sign out current session
            </button>
            <button
              type="button"
              onClick={() => void signOut("global")}
              disabled={signingOut !== null}
              className="flex h-10 items-center justify-center gap-2 rounded-xl border border-red-300 px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30"
            >
              {signingOut === "global" ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}
              Sign out all sessions
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
