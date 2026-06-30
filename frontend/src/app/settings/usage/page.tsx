import { redirect } from "next/navigation";

export default function SettingsUsageRedirect() {
  redirect("/settings/billing-or-usage");
}
