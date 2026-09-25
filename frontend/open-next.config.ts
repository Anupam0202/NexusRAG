import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// The zero-cost profile does not require R2 for Next.js incremental caching.
// Public assets are deployed through Workers Static Assets; authoritative
// application data remains in Supabase and reconstructible vectors in Qdrant.
export default defineCloudflareConfig({});