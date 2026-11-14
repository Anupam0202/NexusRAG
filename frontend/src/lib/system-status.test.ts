import { describe, expect, it } from "vitest";
import { dependencyLine } from "./system-status";

const status = (qdrant: string, supabase = "REACHABLE") => ({
  dependency_status: { supabase_data_api: supabase, qdrant, gemini: "CONFIGURED_NOT_PROBED" },
});

describe("dependencyLine", () => {
  it("says what was reached and that Gemini was not checked", () => {
    expect(dependencyLine(status("READY"))).toEqual({
      tone: "ok",
      text: "Database and search index reachable — Gemini is checked when it is used",
    });
    // A new environment has no collection until the first upload creates it.
    expect(dependencyLine(status("EMPTY")).tone).toBe("ok");
  });

  it("names the search index problem and who can fix it", () => {
    expect(dependencyLine(status("NOT_ANSWERING"))).toEqual({
      tone: "warning",
      text: "The search index is not answering. It may be restarting or paused; your documents are safe",
    });
    expect(dependencyLine(status("KEY_REJECTED")).text).toMatch(/operator/);
    expect(dependencyLine(status("NOT_CONFIGURED")).text).toMatch(/not configured/);
    expect(dependencyLine(status("RATE_LIMITED")).text).toMatch(/rate limited/);
    expect(dependencyLine(status("REJECTED")).tone).toBe("warning");
  });

  it("puts a database outage first, because nothing works without it", () => {
    expect(dependencyLine(status("NOT_ANSWERING", "UNAVAILABLE"))).toEqual({
      tone: "warning",
      text: "The database is not reachable",
    });
  });

  it("claims nothing when the gateway reported no probe", () => {
    const unverified = { tone: "ok", text: "API responding — dependency readiness is not verified" };
    expect(dependencyLine(null)).toEqual(unverified);
    expect(dependencyLine({})).toEqual(unverified);
    // Older gateways report configuration only.
    expect(dependencyLine(status("CONFIGURED_NOT_PROBED"))).toEqual(unverified);
  });
});
