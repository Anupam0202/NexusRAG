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
  options: { json?: boolean; workspaceId?: string | null; expectedUserId?: string | null } = {}
): Promise<HeadersInit> {
  const headers: Record<string, string> = {};

  if (options.json !== false) {
    headers["Content-Type"] = "application/json";
  }

  const workspaceId = options.workspaceId === undefined ? getStoredWorkspaceId() : options.workspaceId?.trim() || null;
  if (workspaceId) {
    headers["X-Nexus-Workspace-Id"] = workspaceId;
    headers["X-Workspace-ID"] = workspaceId;
  }

  const identityError = () => Object.assign(new Error("Your account context changed or is unavailable. Sign in and retry this action."), { code: "AUTH_CONTEXT_CHANGED" });
  if (options.expectedUserId !== undefined && (!options.expectedUserId || !hasPublicSupabaseConfig())) throw identityError();
  if (hasPublicSupabaseConfig()) {
    try {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      if (options.expectedUserId !== undefined && data.session?.user?.id !== options.expectedUserId) throw identityError();
      const token = data.session?.access_token;
      if (options.expectedUserId !== undefined && !token) throw identityError();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      if (options.expectedUserId !== undefined) throw identityError();
      // Keep demo-compatible calls working when auth is absent or still loading.
    }
  }

  return headers;
}
