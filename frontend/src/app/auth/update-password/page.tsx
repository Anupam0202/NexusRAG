import { StaticAuthRedirect } from "@/components/auth/StaticAuthRedirect";

export default function UpdatePasswordPage() {
  return <StaticAuthRedirect href="/auth/login" />;
}
