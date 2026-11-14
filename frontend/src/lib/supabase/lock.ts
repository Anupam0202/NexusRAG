import { NavigatorLockAcquireTimeoutError, navigatorLock } from "@supabase/supabase-js";

const NOT_AVAILABLE = Symbol("lock not available");

/**
 * The Supabase client's cross-tab lock, with one difference. When it only tries a lock (a timeout of 0, which the
 * background token refresh does every few seconds) and another tab holds it, the library throws inside the browser's
 * lock callback; recent Firefox releases report that error as unhandled even though the library catches it, so every
 * page logged "Acquiring an exclusive Navigator LockManager lock ... immediately failed". Here the callback returns a
 * marker instead, and the same error is thrown outside it, where the library catches it as before.
 */
export async function browserLock<R>(name: string, acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  const locks = typeof globalThis.navigator === "undefined" ? undefined : globalThis.navigator.locks;
  if (acquireTimeout !== 0 || !locks) return navigatorLock(name, acquireTimeout, fn);
  const result = await locks.request(name, { mode: "exclusive", ifAvailable: true }, async (lock) =>
    lock ? fn() : NOT_AVAILABLE
  );
  if (result === NOT_AVAILABLE) {
    throw new NavigatorLockAcquireTimeoutError(`Acquiring an exclusive Navigator LockManager lock "${name}" immediately failed`);
  }
  return result as R;
}
