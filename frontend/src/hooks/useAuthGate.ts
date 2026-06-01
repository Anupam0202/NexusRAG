"use client";

import { useStore, type AuthMode } from "@/hooks/useStore";

export function canUseWorkspaceApi(authMode: AuthMode) {
  return authMode === "authenticated" || authMode === "demo";
}

export function useWorkspaceApiAccess() {
  const authMode = useStore((state) => state.authMode);
  return {
    authMode,
    canAccessWorkspaceApi: canUseWorkspaceApi(authMode),
    isAuthLoading: authMode === "loading",
    isSignedOut: authMode === "signed_out",
  };
}
