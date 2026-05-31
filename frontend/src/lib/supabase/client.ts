"use client";

import { createBrowserClient } from "@supabase/ssr";
import {
  hasPublicSupabaseConfig,
  requirePublicSupabaseConfig,
} from "@/lib/supabase/config";

export { hasPublicSupabaseConfig };

export function createSupabaseBrowserClient() {
  const { url, anonKey } = requirePublicSupabaseConfig();
  return createBrowserClient(url, anonKey);
}
