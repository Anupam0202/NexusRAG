"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Mail, ShieldPlus } from "lucide-react";
import { toast } from "sonner";
import { createSupabaseBrowserClient, hasPublicSupabaseConfig } from "@/lib/supabase/client";
import { useStore } from "@/hooks/useStore";

function cleanNextPath(value: string | null) {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/onboarding";
  return value;
}

export default function SignupPage() {
  const router = useRouter();
  const authMode = useStore((state) => state.authMode);
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nextPath, setNextPath] = useState("/onboarding");
  const supabaseReady = hasPublicSupabaseConfig();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNextPath(cleanNextPath(params.get("next")));
  }, []);

  useEffect(() => {
    if (authMode === "authenticated") {
      router.replace(nextPath);
    }
  }, [authMode, nextPath, router]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !supabaseReady) return;

    setSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
        options: {
          emailRedirectTo: redirectTo,
          shouldCreateUser: true,
        },
      });
      if (error) throw error;
      setSentTo(trimmedEmail);
      toast.success("Signup link sent");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Unable to send signup link");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-4 py-10">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
            <ShieldPlus size={22} />
          </span>
          <div>
            <h2 className="text-xl font-bold">Create a NexusRAG account</h2>
            <p className="text-sm text-[var(--text-muted)]">Start with a secure workspace</p>
          </div>
        </div>

        {!supabaseReady ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            Supabase browser variables are missing from this frontend deployment.
          </div>
        ) : sentTo ? (
          <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <p className="text-sm font-semibold">Check your inbox</p>
            <p className="text-sm leading-6 text-[var(--text-muted)]">
              A signup link was sent to {sentTo}. Open it to create your session.
            </p>
            <button
              type="button"
              onClick={() => setSentTo(null)}
              className="text-sm font-semibold text-brand-600 hover:text-brand-500"
            >
              Use another email
            </button>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5"
          >
            <label className="block">
              <span className="text-xs font-semibold text-[var(--text-muted)]">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2.5 text-sm outline-none transition focus:border-brand-500"
              />
            </label>
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
              {submitting ? "Sending" : "Send signup link"}
            </button>
          </form>
        )}

        <div className="mt-5 flex items-center justify-between gap-3 text-sm">
          <Link
            href="/auth/login"
            className="font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Already have access?
          </Link>
          <Link
            href="/documents"
            className="inline-flex items-center gap-2 font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Documents
            <ArrowRight size={15} />
          </Link>
        </div>
      </main>
    </div>
  );
}
