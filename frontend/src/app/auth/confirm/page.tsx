import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { sanitizeAuthNextPath } from "@/lib/auth-redirect";

export const metadata: Metadata = {
  referrer: "no-referrer",
};

interface AuthConfirmPageProps {
  searchParams: Promise<{
    token_hash?: string;
    type?: string;
    next?: string;
  }>;
}

export default async function AuthConfirmPage({ searchParams }: AuthConfirmPageProps) {
  const params = await searchParams;
  const tokenHash = params.token_hash;
  const validLink = typeof tokenHash === "string" && tokenHash.length > 0 && params.type === "email";
  const nextPath = sanitizeAuthNextPath(params.next, "/documents");

  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 text-center">
        {validLink ? (
          <>
            <ShieldCheck size={28} className="mx-auto mb-3 text-brand-500" />
            <h2 className="text-sm font-semibold">Confirm your secure sign-in</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
              Continue to verify this one-time link and securely sign in to NexusRAG.
            </p>
            <form action="/auth/confirm/verify" method="post" className="mt-4">
              <input type="hidden" name="token_hash" value={tokenHash} />
              <input type="hidden" name="type" value="email" />
              <input type="hidden" name="next" value={nextPath} />
              <button
                type="submit"
                className="inline-flex rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-500"
              >
                Confirm and sign in
              </button>
            </form>
          </>
        ) : (
          <>
            <ShieldAlert size={28} className="mx-auto mb-3 text-red-500" />
            <h2 className="text-sm font-semibold">This sign-in link is invalid</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
              Request a new one-time link to continue securely.
            </p>
            <Link
              href="/auth/login"
              className="mt-4 inline-flex rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-500"
            >
              Request a new sign-in link
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
