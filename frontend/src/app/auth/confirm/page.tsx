import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { sanitizeAuthNextPath } from "@/lib/auth-redirect";

export const metadata: Metadata = {
  referrer: "no-referrer",
};

interface AuthConfirmPageProps {
  searchParams: Promise<{
    next?: string;
  }>;
}

export default async function AuthConfirmPage({
  searchParams,
}: AuthConfirmPageProps) {
  const params = await searchParams;
  const nextPath = sanitizeAuthNextPath(params.next, "/documents");

  redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
}
