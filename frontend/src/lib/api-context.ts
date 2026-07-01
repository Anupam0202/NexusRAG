"use client";

import { createSupabaseBrowserClient, hasPublicSupabaseConfig } from "@/lib/supabase/client";

const WORKSPACE_STORAGE_KEY = "nexusrag.workspace_id";

export function getStoredWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(WORKSPACE_STORAGE_KEY)?.trim();
  return value || null;
}

export function setStoredWorkspaceId(workspaceId: string | null) {
  if (typeof window === "undefined") return;
  if (workspaceId?.trim()) {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspaceId.trim());
  } else {
    window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
  }
}

export async function getApiHeaders(
  options: { json?: boolean; workspaceId?: string | null } = {}
): Promise<HeadersInit> {
  const headers: Record<string, string> = {};

  if (options.json !== false) {
    headers["Content-Type"] = "application/json";
  }

  const workspaceId = options.workspaceId?.trim() || getStoredWorkspaceId();
  if (workspaceId) {
    headers["X-Nexus-Workspace-Id"] = workspaceId;
    headers["X-Workspace-ID"] = workspaceId;
  }

  if (hasPublicSupabaseConfig()) {
    try {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // Keep demo-compatible calls working when auth is absent or still loading.
    }
  }

  return headers;
}
