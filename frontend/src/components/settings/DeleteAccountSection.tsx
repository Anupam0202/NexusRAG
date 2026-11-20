"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DELETE_ACCOUNT_CONFIRMATION, deleteAccount, listWorkspaces } from "@/lib/api";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { navigateStatic } from "@/lib/static-navigation";
import { useStore } from "@/hooks/useStore";

/** Deleting one's own account: says what goes and what stays, then asks for a typed confirmation. */
export function DeleteAccountSection() {
  const userId = useStore((state) => state.authUser?.id ?? null);
  const setWorkspaceId = useStore((state) => state.setWorkspaceId);
  const [owned, setOwned] = useState<string[] | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [working, setWorking] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!userId) return;
    listWorkspaces({ workspaceId: null, expectedUserId: userId }, { limit: 100 })
      .then((page) => { if (alive.current) setOwned(page.workspaces.filter((item) => item.role === "owner").map((item) => item.name)); })
      .catch(() => { if (alive.current) setOwned(null); });
  }, [userId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (confirmation !== DELETE_ACCOUNT_CONFIRMATION || working || !userId) return;
    setWorking(true);
    try {
      await deleteAccount({ workspaceId: null, expectedUserId: userId });
      // The sign-in is gone or going; end this browser's session either way.
      await createSupabaseBrowserClient().auth.signOut({ scope: "local" }).catch(() => undefined);
      setWorkspaceId(null);
      navigateStatic("/auth/login?account=deleted");
    } catch (error) {
      if (!alive.current) return;
      toast.error(error instanceof Error ? error.message : "Your account could not be deleted. Nothing was changed; try again.");
      setWorking(false);
    }
  };

  return (
    <section className="rounded-xl border border-red-300 bg-red-50/70 p-4 md:p-5 dark:border-red-900 dark:bg-red-950/20">
      <div className="mb-3 flex items-center gap-2">
        <Trash2 size={17} className="text-red-600 dark:text-red-300" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-red-900 dark:text-red-100">Delete your account</h3>
      </div>
      <div className="space-y-2 text-sm leading-6 text-red-900 dark:text-red-200">
        <p>This removes your sign-in, your Gemini key and your usage records. It cannot be undone.</p>
        {owned === null ? (
          <p>Workspaces you own are deleted with everything in them, for every member.</p>
        ) : owned.length ? (
          <p>
            {owned.length === 1 ? "This workspace you own is" : "These workspaces you own are"} deleted with everything in
            them, for every member: <strong>{owned.join(", ")}</strong>.
          </p>
        ) : (
          <p>You do not own any workspace.</p>
        )}
        <p>
          In workspaces owned by others, your private conversations and unshared findings are deleted; documents you
          uploaded and findings you shared stay with that workspace.
        </p>
      </div>
      <form className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]" onSubmit={(event) => void submit(event)}>
        <input
          aria-label="Confirm account deletion"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder={`Type ${DELETE_ACCOUNT_CONFIRMATION}`}
          className="min-w-0 rounded-lg border border-red-400 bg-white px-3 py-2 text-sm outline-none focus:border-red-600 dark:bg-red-950/40"
        />
        <button
          type="submit"
          disabled={confirmation !== DELETE_ACCOUNT_CONFIRMATION || working}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
        >
          {working ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
          Delete my account
        </button>
      </form>
    </section>
  );
}
