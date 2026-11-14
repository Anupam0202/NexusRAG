"use client";

import { useStore, type AuthMode } from "@/hooks/useStore";

export function canUseWorkspaceApi(authMode: AuthMode) {
  return authMode === "authenticated" || authMode === "demo";
}

export function useWorkspaceApiAccess() {
  const authMode = useStore((state) => state.authMode);
  const workspaceId = useStore((state) => state.workspaceId);
  const workspaceDiscovery = useStore((state) => state.workspaceDiscovery);
  const isWorkspaceLoading = authMode === "authenticated" && !workspaceId && workspaceDiscovery === "loading";
  return {
    authMode,
    workspaceId,
    canAccessWorkspaceApi: canUseWorkspaceApi(authMode) && (authMode !== "authenticated" || !!workspaceId),
    isWorkspaceLoading,
    workspaceDiscovery,
    isAuthLoading: authMode === "loading",
    isSignedOut: authMode === "signed_out",
  };
}
