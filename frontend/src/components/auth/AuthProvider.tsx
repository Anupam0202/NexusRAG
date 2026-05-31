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

    const syncSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;

      const session = data.session;
      if (!session?.user) {
        setAuthState("signed_out", null);
        return;
      }

      setAuthState("authenticated", {
        id: session.user.id,
        email: session.user.email ?? null,
      });

      if (!getStoredWorkspaceId()) {
        try {
          const workspace = await getCurrentWorkspace();
          if (active) setWorkspaceId(workspace.workspace_id);
        } catch {
          // The user may be authenticated before being added to a workspace.
        }
      }
    };

    void syncSession();

    const { data: subscription } = supabase.auth.onAuthStateChange(() => {
      void syncSession();
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [setAuthState, setWorkspaceId]);

  return null;
}
