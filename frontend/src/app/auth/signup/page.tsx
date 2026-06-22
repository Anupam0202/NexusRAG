import { redirect } from "next/navigation";
import { sanitizeAuthNextPath } from "@/lib/auth-redirect";

interface SignupPageProps {
  searchParams: Promise<{
    next?: string;
  }>;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = await searchParams;
  const nextPath = sanitizeAuthNextPath(params.next, "/onboarding");

  redirect(
    `/auth/login?intent=signup&next=${encodeURIComponent(nextPath)}`
  );
}
