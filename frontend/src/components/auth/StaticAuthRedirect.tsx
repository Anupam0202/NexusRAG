"use client";

import { useEffect } from "react";
import { sanitizeAuthNextPath } from "@/lib/auth-redirect";
import { navigateStatic } from "@/lib/static-navigation";

export function StaticAuthRedirect({
  href,
  title = "Redirecting to sign in",
}: {
  href: string;
  title?: string;
}) {
  useEffect(() => {
    navigateStatic(href);
  }, [href]);

  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        If you are not redirected,{" "}
        <a className="underline underline-offset-4" href={href}>
          continue
        </a>
        .
      </p>
    </main>
  );
}

export function buildAuthLoginRedirect(search: string, intent?: "signup") {
  const params = new URLSearchParams(search);
  const safeNext = sanitizeAuthNextPath(
    params.get("next"),
    intent === "signup" ? "/onboarding" : "/documents"
  );
  const query = new URLSearchParams();
  if (intent) query.set("intent", intent);
  query.set("next", safeNext);
  return `/auth/login?${query.toString()}`;
}