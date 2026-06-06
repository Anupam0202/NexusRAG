"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { buildAuthCallbackUrl, sanitizeAuthNextPath } from "@/lib/auth-redirect";
import { createSupabaseBrowserClient, hasPublicSupabaseConfig } from "@/lib/supabase/client";
import { useStore } from "@/hooks/useStore";

export default function LoginPage() {
  const router = useRouter();
  const authMode = useStore((state) => state.authMode);
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nextPath, setNextPath] = useState("/documents");
  const supabaseReady = hasPublicSupabaseConfig();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNextPath(sanitizeAuthNextPath(params.get("next"), "/documents"));
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
      const redirectTo = buildAuthCallbackUrl(
        window.location.origin,
        nextPath,
        process.env.NEXT_PUBLIC_SITE_URL
      );
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
        options: {
          emailRedirectTo: redirectTo,
          shouldCreateUser: false,
        },
      });
      if (error) throw error;
      setSentTo(trimmedEmail);
      toast.success("Magic link sent");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Unable to send magic link");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-4 py-10">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
            <ShieldCheck size={22} />
          </span>
          <div>
            <h2 className="text-xl font-bold">Sign in to NexusRAG</h2>
            <p className="text-sm text-[var(--text-muted)]">Secure workspace access</p>
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
              A sign-in link was sent to {sentTo}. Return here after opening the link.
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
              {submitting ? "Sending" : "Send magic link"}
            </button>
          </form>
        )}

        <Link
          href="/documents"
          className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          Continue to documents
          <ArrowRight size={15} />
        </Link>
        <Link
          href={`/auth/signup?next=${encodeURIComponent(nextPath)}`}
          className="mt-3 text-sm font-semibold text-brand-600 hover:text-brand-500"
        >
          Create a new workspace account
        </Link>
      </main>
    </div>
  );
}
