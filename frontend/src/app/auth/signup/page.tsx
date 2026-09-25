"use client";

import { useEffect } from "react";
import { buildAuthLoginRedirect } from "@/components/auth/StaticAuthRedirect";
import { navigateStatic } from "@/lib/static-navigation";

export default function SignupPage() {
  useEffect(() => {
    navigateStatic(
      buildAuthLoginRedirect(window.location.search, "signup")
    );
  }, []);

  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-lg font-semibold">Opening account sign-in</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        If you are not redirected,{" "}
        <a className="underline underline-offset-4" href="/auth/login?intent=signup&next=%2Fonboarding">
          continue
        </a>
        .
      </p>
    </main>
  );
}
