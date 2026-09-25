"use client";

import { StaticAuthRedirect } from "@/components/auth/StaticAuthRedirect";

export default function SettingsUsageRedirect() {
  return (
    <StaticAuthRedirect
      href="/settings/billing-or-usage"
      title="Opening billing and usage"
    />
  );
}
