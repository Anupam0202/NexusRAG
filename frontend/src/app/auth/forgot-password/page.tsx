import { StaticAuthRedirect } from "@/components/auth/StaticAuthRedirect";

export default function ForgotPasswordPage() {
  return <StaticAuthRedirect href="/auth/login" />;
}
