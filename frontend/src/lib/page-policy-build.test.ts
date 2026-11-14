import { describe, expect, it } from "vitest";
import { connectSources, LOCAL_GATEWAY } from "../../scripts/write-page-policy.mjs";

describe("connection sources a build allows (NX-28)", () => {
  it("are the origins of the gateway and Supabase the client bundle was built with", () => {
    expect(connectSources({
      NEXT_PUBLIC_API_URL: "https://nexusrag-gateway.example.workers.dev/",
      NEXT_PUBLIC_SUPABASE_URL: " https://abcdefghijklmnopqrst.supabase.co ",
    })).toEqual(["https://nexusrag-gateway.example.workers.dev", "https://abcdefghijklmnopqrst.supabase.co"]);
  });

  it("follow the client's fallback to the local gateway and list an origin once", () => {
    expect(connectSources({})).toEqual([LOCAL_GATEWAY]);
    expect(connectSources({ NEXT_PUBLIC_API_URL: " ", NEXT_PUBLIC_SUPABASE_URL: "http://localhost:8000/rest" })).toEqual([LOCAL_GATEWAY]);
  });

  it("fail the build for a URL the client could not use either", () => {
    expect(() => connectSources({ NEXT_PUBLIC_API_URL: "gateway without scheme" })).toThrow();
  });
});
