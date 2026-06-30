"use client";

import { useStore, type AuthMode } from "@/hooks/useStore";

export function canUseWorkspaceApi(authMode: AuthMode) {
  return authMode === "authenticated" || authMode === "demo";
}

export function useWorkspaceApiAccess() {
  const authMode = useStore((state) => state.authMode);
  const workspaceId = useStore((state) => state.workspaceId);
  const isWorkspaceLoading = authMode === "authenticated" && !workspaceId;
  return {
    authMode,
    workspaceId,
    canAccessWorkspaceApi: canUseWorkspaceApi(authMode),
    isWorkspaceLoading,
    isAuthLoading: authMode === "loading",
    isSignedOut: authMode === "signed_out",
  };
}
