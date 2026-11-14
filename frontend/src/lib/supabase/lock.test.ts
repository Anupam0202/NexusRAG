import { afterEach, describe, expect, it, vi } from "vitest";
import { NavigatorLockAcquireTimeoutError } from "@supabase/supabase-js";
import { browserLock } from "./lock";

type Callback = (lock: { name: string } | null) => Promise<unknown>;

// A LockManager in which `held` names are taken by another tab; it records what each callback returned.
function lockManager(held: string[] = []) {
  const settled: Array<Promise<unknown>> = [];
  const request = vi.fn(async (name: string, _options: unknown, callback: Callback) => {
    const returned = callback(held.includes(name) ? null : { name });
    settled.push(returned);
    return returned;
  });
  vi.stubGlobal("navigator", { ...globalThis.navigator, locks: { request } });
  return { request, settled };
}

afterEach(() => vi.unstubAllGlobals());

describe("browserLock", () => {
  it("runs the work when the lock is free", async () => {
    const locks = lockManager();
    await expect(browserLock("lock:sb-token", 0, async () => "refreshed")).resolves.toBe("refreshed");
    expect(locks.request).toHaveBeenCalledWith("lock:sb-token", { mode: "exclusive", ifAvailable: true }, expect.any(Function));
  });

  it("reports a taken lock with the library's own error, without rejecting inside the browser's callback", async () => {
    const locks = lockManager(["lock:sb-token"]);
    const work = vi.fn();
    const failure = await browserLock("lock:sb-token", 0, work).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NavigatorLockAcquireTimeoutError);
    expect((failure as { isAcquireTimeout?: boolean }).isAcquireTimeout).toBe(true);
    expect(work).not.toHaveBeenCalled();
    // The promise the browser's lock manager receives resolves; nothing inside it is left rejected.
    await expect(Promise.all(locks.settled)).resolves.toBeDefined();
  });
});
