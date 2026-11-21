// Generated modules exist after the validated OpenNext build (npm run cf:build).
import nextWorker from "./.open-next/worker.js";
import pagePolicy from "./.open-next/page-policy.json";
import { createDocumentStaticWorker } from "./src/lib/static-document-worker";
// Preserve OpenNext's Durable Object exports; this profile binds none.
export * from "./.open-next/worker.js";

export default createDocumentStaticWorker(nextWorker, pagePolicy.connect);
