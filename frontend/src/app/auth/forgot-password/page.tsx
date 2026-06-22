import { redirect } from "next/navigation";

export default function ForgotPasswordPage() {
  redirect("/auth/login");
}
