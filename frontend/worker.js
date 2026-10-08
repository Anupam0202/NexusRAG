// Generated module exists after the validated OpenNext build.
import nextWorker from "./.open-next/worker.js";
import { createDocumentStaticWorker } from "./src/lib/static-document-worker";
// Preserve OpenNext's Durable Object exports; this profile binds none.
export * from "./.open-next/worker.js";

export default createDocumentStaticWorker(nextWorker);