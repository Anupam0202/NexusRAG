import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "@/hooks/useStore";
import { useWorkspaceApiAccess } from "./useAuthGate";

describe("useWorkspaceApiAccess", () => {
  beforeEach(() => {
    useStore.setState({ authMode: "loading", workspaceId: null });
  });

  it("marks authenticated workspace APIs as waiting until a workspace is selected", () => {
    useStore.setState({ authMode: "authenticated", workspaceId: null });

    const { result } = renderHook(() => useWorkspaceApiAccess());

    expect(result.current.canAccessWorkspaceApi).toBe(true);
    expect(result.current.isWorkspaceLoading).toBe(true);
  });

  it("clears workspace loading when the selected workspace is available", () => {
    useStore.setState({
      authMode: "authenticated",
      workspaceId: "7908ac49-51a2-4188-b387-307ffe3b393b",
    });

    const { result } = renderHook(() => useWorkspaceApiAccess());

    expect(result.current.canAccessWorkspaceApi).toBe(true);
    expect(result.current.isWorkspaceLoading).toBe(false);
  });
});
