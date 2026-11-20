import { describe, expect, it } from "vitest";
import { enabledFeatures, featureEnabled } from "./features";

describe("optional features", () => {
  it("are off unless named", () => {
    expect([...enabledFeatures(undefined)]).toEqual([]);
    expect([...enabledFeatures("")]).toEqual([]);
    expect(featureEnabled("radar", "")).toBe(false);
  });

  it("accept a comma-separated list and ignore unknown names", () => {
    expect([...enabledFeatures(" Radar , evidence-api,unknown,,evaluations ")].sort()).toEqual(["evaluations", "evidence-api", "radar"]);
    expect(featureEnabled("evidence-api", "radar,evidence-api")).toBe(true);
    expect(featureEnabled("evaluations", "radar")).toBe(false);
  });
});
