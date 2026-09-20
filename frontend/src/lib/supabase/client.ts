"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database.generated";
import {
  hasPublicSupabaseConfig,
  requirePublicSupabaseConfig,
} from "@/lib/supabase/config";

export { hasPublicSupabaseConfig };

export function createSupabaseBrowserClient() {
  const { url, anonKey } = requirePublicSupabaseConfig();
  return createBrowserClient<Database>(url, anonKey);
}
