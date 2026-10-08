"use client";

import { useEffect } from "react";
import { useStore } from "@/hooks/useStore";
import { getCurrentWorkspace } from "@/lib/api";
import { getStoredWorkspaceId } from "@/lib/api-context";
import {
  createSupabaseBrowserClient,
  hasPublicSupabaseConfig,
} from "@/lib/supabase/client";

export function AuthProvider() {
  const setAuthState = useStore((state) => state.setAuthState);
  const setWorkspaceId = useStore((state) => state.setWorkspaceId);

  useEffect(() => {
    const storedWorkspaceId = getStoredWorkspaceId();
    if (storedWorkspaceId) {
      setWorkspaceId(storedWorkspaceId);
    }

    if (!hasPublicSupabaseConfig()) {
      setAuthState("demo", null);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    let active = true;
    let generation = 0;

    const syncSession = async () => {
      const initiatingGeneration = ++generation;
      let data;
      try { ({ data } = await supabase.auth.getSession()); }
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

      const cachedWorkspace = getStoredWorkspaceId();
      if (cachedWorkspace) {
        try {
          await getCurrentWorkspace({ workspaceId: cachedWorkspace, expectedUserId: session.user.id });
          return; // A token refresh never resets a valid selected workspace.
        } catch (error: unknown) {
          if (!active || generation !== initiatingGeneration) return;
          const denied = error && typeof error === "object" && "code" in error &&
            ["FORBIDDEN", "WORKSPACE_UNAVAILABLE", "WORKSPACE_NOT_FOUND"].includes(String(error.code));
          if (!denied || useStore.getState().workspaceId !== cachedWorkspace) return;
          // A stored identifier is not proof of this account's membership.
          // Preserve it on network errors, but discard a confirmed denied binding.
          setWorkspaceId(null);
        }
      }
      try {
        const workspace = await getCurrentWorkspace({ workspaceId: null, expectedUserId: session.user.id });
        if (active && generation === initiatingGeneration && !useStore.getState().workspaceId) setWorkspaceId(workspace.workspace_id);
      } catch {
        // Onboarding reports discovery failures; provider outages are not evidence
        // that a new workspace should be created.
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
  }, [setAuthState, setWorkspaceId]);

  return null;
}
