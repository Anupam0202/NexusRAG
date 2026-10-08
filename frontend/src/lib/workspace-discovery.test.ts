import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedDiscoveryRead } from "./workspace-discovery";

describe("bounded read-only discovery", () => {
  afterEach(() => vi.useRealTimers());
  it("returns a successful result and clears its deadline", async () => {
    vi.useFakeTimers();
    expect(await boundedDiscoveryRead(async () => "member")).toBe("member");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves explicit absence separately from a network error", async () => {
    const error = Object.assign(new Error("Absent"), { code: "WORKSPACE_NOT_FOUND" });
    await expect(boundedDiscoveryRead(async () => { throw error; })).rejects.toBe(error);
  });
  it("times out a hung provider and ignores its eventual success", async () => {
    vi.useFakeTimers();
    let finish!: (result: string) => void;
    const result = boundedDiscoveryRead(() => new Promise<string>(resolve => { finish = resolve; }));
    const assertion = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    finish("late-workspace");
    expect(vi.getTimerCount()).toBe(0);
  });
});