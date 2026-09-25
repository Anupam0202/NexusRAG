"use client";

import { useEffect } from "react";
import { buildAuthLoginRedirect } from "@/components/auth/StaticAuthRedirect";
import { navigateStatic } from "@/lib/static-navigation";

export default function AuthConfirmPage() {
  useEffect(() => {
    navigateStatic(buildAuthLoginRedirect(window.location.search));
  }, []);

  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-lg font-semibold">Opening sign-in</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        If you are not redirected,{" "}
        <a className="underline underline-offset-4" href="/auth/login?next=%2Fdocuments">
          continue
        </a>
        .
      </p>
    </main>
  );
}
