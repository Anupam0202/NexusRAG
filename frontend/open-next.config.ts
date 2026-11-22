import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// The zero-cost profile does not require R2 or KV for Next.js incremental caching.
// Public assets are deployed through Workers Static Assets; authoritative
// application data remains in Supabase and reconstructible vectors in Qdrant.
//
// Every page except /auth/confirm/verify is prerendered at build time. The static-assets cache reads those pages
// from the build's own output (under cdn-cgi/, which only the Worker can read), and cache interception answers
// them without starting the Next.js server. Without it, the Worker rendered each page again on every request,
// at 20-40 ms of CPU, and under a burst Cloudflare stopped requests over the Free plan's limit (issue #45). The
// cache is read-only: nothing revalidates, which is right for pages that only change with a release.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
