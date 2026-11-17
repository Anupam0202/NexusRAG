import { describe, expect, it } from "vitest";
import { connectSources, LOCAL_GATEWAY, siteOrigin } from "../../scripts/write-page-policy.mjs";
import { buildInfo } from "../../scripts/write-build-info.mjs";

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

describe("the address a build is made for", () => {
  const sha = "a".repeat(40);

  it("is the origin of NEXT_PUBLIC_SITE_URL, and none when the build has no address", () => {
    expect(siteOrigin({ NEXT_PUBLIC_SITE_URL: " https://nexusrag.pages.dev/ " })).toBe("https://nexusrag.pages.dev");
    expect(siteOrigin({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
    expect(siteOrigin({})).toBeNull();
    expect(siteOrigin({ NEXT_PUBLIC_SITE_URL: " " })).toBeNull();
  });

  it("fails the build when it is not HTTPS outside local development", () => {
    expect(() => siteOrigin({ NEXT_PUBLIC_SITE_URL: "http://nexusrag.pages.dev" })).toThrow(/HTTPS/);
    expect(() => siteOrigin({ NEXT_PUBLIC_SITE_URL: "nexusrag.pages.dev" })).toThrow();
  });

  it("is published in the build identity the front door reads, next to the reviewed commit", () => {
    expect(buildInfo({ SOURCE_COMMIT: sha, NEXT_PUBLIC_SITE_URL: "https://nexusrag.pages.dev/" }))
      .toEqual({ source_commit: sha, format: "nexusrag-build/1", site_url: "https://nexusrag.pages.dev" });
    expect(buildInfo({ SOURCE_COMMIT: sha })).toEqual({ source_commit: sha, format: "nexusrag-build/1" });
    expect(() => buildInfo({ SOURCE_COMMIT: "main" })).toThrow(/SOURCE_COMMIT/);
  });
});
