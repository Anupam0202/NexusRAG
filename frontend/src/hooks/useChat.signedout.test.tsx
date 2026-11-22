import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useChat } from "./useChat";
import { useStore } from "./useStore";

const config = vi.hoisted(() => ({ present: true }));
vi.mock("@/lib/supabase/config", async importOriginal => ({ ...await importOriginal<object>(), hasPublicSupabaseConfig: () => config.present }));
const api = vi.hoisted(() => ({ chatQuery: vi.fn(), getSessionMessages: vi.fn() }));
vi.mock("@/lib/api", async importOriginal => ({ ...await importOriginal<object>(), ...api }));

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ ...useStore.getInitialState(), authMode: "signed_out" });
});
afterEach(() => { cleanup(); useStore.setState(useStore.getInitialState()); });

it("tells a signed-out visitor to sign in when the build has its sign-in settings", async () => {
  config.present = true;
  renderHook(() => useChat());
  await waitFor(() => expect(useStore.getState().connectionStatus).toBe("auth_required"));
  expect(api.getSessionMessages).not.toHaveBeenCalled();
});

it("reports sign-in setup as missing only when the build lacks those settings", async () => {
  config.present = false;
  renderHook(() => useChat());
  await waitFor(() => expect(useStore.getState().connectionStatus).toBe("auth_setup_required"));
});
