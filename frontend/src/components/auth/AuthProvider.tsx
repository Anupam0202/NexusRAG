"use client";

import { useEffect } from "react";
import { useStore } from "@/hooks/useStore";
import { getCurrentWorkspace } from "@/lib/api";
import { getStoredWorkspaceId } from "@/lib/api-context";
import { boundedDiscoveryRead } from "@/lib/workspace-discovery";
import {
  createSupabaseBrowserClient,
  hasPublicSupabaseConfig,
} from "@/lib/supabase/client";

export function AuthProvider() {
  const setAuthState = useStore((state) => state.setAuthState);
  const setWorkspaceId = useStore((state) => state.setWorkspaceId);
  const setWorkspaceDiscovery = useStore((state) => state.setWorkspaceDiscovery);

  useEffect(() => {
    // Missing deployment configuration is not authorization or a demo session.
    // The real signed-out transition clears cached private scope and data.
    if (!hasPublicSupabaseConfig()) {
      setAuthState("signed_out", null);
      return;
    }
    const storedWorkspaceId = getStoredWorkspaceId();
    if (storedWorkspaceId) {
      setWorkspaceId(storedWorkspaceId);
    }

    const supabase = createSupabaseBrowserClient();
    let active = true;
    let generation = 0;

    const syncSession = async () => {
      const initiatingGeneration = ++generation;
      let data;
      try { ({ data } = await boundedDiscoveryRead(() => supabase.auth.getSession())); }
      catch {
        if (active && generation === initiatingGeneration) setAuthState("signed_out", null);
        return;
      }
      if (!active || generation !== initiatingGeneration) return;

      const session = data.session;
      if (!session?.user) {
        setAuthState("signed_out", null);
        return;
      }

      setAuthState("authenticated", {
        id: session.user.id,
        email: session.user.email ?? null,
      });
      setWorkspaceDiscovery("loading");

      const cachedWorkspace = getStoredWorkspaceId();
      if (cachedWorkspace) {
        try {
          await boundedDiscoveryRead(() => getCurrentWorkspace({ workspaceId: cachedWorkspace, expectedUserId: session.user.id }));
          if (active && generation === initiatingGeneration) setWorkspaceDiscovery("ready");
          return; // A token refresh never resets a valid selected workspace.
        } catch (error: unknown) {
          if (!active || generation !== initiatingGeneration) return;
          const denied = error && typeof error === "object" && "code" in error &&
            ["FORBIDDEN", "WORKSPACE_UNAVAILABLE", "WORKSPACE_NOT_FOUND"].includes(String(error.code));
          if (!denied || useStore.getState().workspaceId !== cachedWorkspace) {
            setWorkspaceDiscovery(useStore.getState().workspaceId ? "ready" : "error");
            return;
          }
          // A stored identifier is not proof of this account's membership.
          // Preserve it on network errors, but discard a confirmed denied binding.
          setWorkspaceId(null);
        }
      }
      try {
        const workspace = await boundedDiscoveryRead(() => getCurrentWorkspace({ workspaceId: null, expectedUserId: session.user.id }));
        if (active && generation === initiatingGeneration) {
          if (!useStore.getState().workspaceId) setWorkspaceId(workspace.workspace_id);
          setWorkspaceDiscovery("ready");
        }
      } catch (error: unknown) {
        if (!active || generation !== initiatingGeneration) return;
        const missing = error && typeof error === "object" && "code" in error && error.code === "WORKSPACE_NOT_FOUND";
        setWorkspaceDiscovery(useStore.getState().workspaceId ? "ready" : missing ? "missing" : "error");
      }
    };

    void syncSession();

    const { data: subscription } = supabase.auth.onAuthStateChange(() => {
      void syncSession();
    });

    return () => {
      active = false;
      generation += 1;
      subscription.subscription.unsubscribe();
    };
  }, [setAuthState, setWorkspaceId, setWorkspaceDiscovery]);

  return null;
}
