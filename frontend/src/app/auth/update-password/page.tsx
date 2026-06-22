import { redirect } from "next/navigation";

export default function UpdatePasswordPage() {
  redirect("/auth/login");
}
