"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AuthRequiredState } from "@/components/auth/AuthRequiredState";
import { PasswordField } from "@/components/auth/PasswordField";
import { PasswordRequirements } from "@/components/auth/PasswordRequirements";
import { useStore } from "@/hooks/useStore";
import { genericAuthError, passwordValidationError } from "@/lib/password-policy";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const authMode = useStore((state) => state.authMode);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = passwordValidationError(password, confirmation);
    setFormError(validationError);
    if (validationError || authMode !== "authenticated") return;

    setSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated");
      router.replace("/settings/security");
    } catch {
      const message = genericAuthError("password-update");
      setFormError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (authMode !== "authenticated") {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-4 py-8">
          <AuthRequiredState
            authMode={authMode}
            nextPath="/auth/update-password"
            title="Open your recovery link"
            description="Use the latest password-recovery email to establish a secure recovery session."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-4 py-10">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
            <KeyRound size={22} />
          </span>
          <div>
            <h2 className="text-xl font-bold">Choose a new password</h2>
            <p className="text-sm text-[var(--text-muted)]">Protect your NexusRAG account</p>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5"
        >
          <PasswordField
            id="new-password"
            label="New password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            disabled={submitting}
          />
          <PasswordField
            id="new-password-confirmation"
            label="Confirm new password"
            value={confirmation}
            onChange={setConfirmation}
            autoComplete="new-password"
            disabled={submitting}
          />
          <PasswordRequirements password={password} />
          {formError ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {formError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={submitting || !password || !confirmation}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
            {submitting ? "Updating" : "Update password"}
          </button>
        </form>
      </main>
    </div>
  );
}
