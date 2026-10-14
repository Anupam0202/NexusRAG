import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] || 3023);
const cover = "60606060-6060-4060-8060-606060606060";
const resume = "30303030-3030-4030-8030-303030303030";
const documents = [
  { document_id: resume, filename: "Resume.txt", status: "ready", file_type: "txt", chunk_count: 1, file_size: 100 },
  { document_id: cover, filename: "Cover_Letter.txt", status: "ready", file_type: "txt", chunk_count: 1, file_size: 100 },
];
let requests = 0;
const server = await createServer({ root, configFile: false, envFile: false, plugins: [react(), {
  name: "synthetic-summary-transport",
  configureServer(instance) { instance.middlewares.use((req, res, next) => { void serveFixture(req, res, next, instance); }); },
}],
  resolve: { alias: { "@": resolve(root, "src") } },
  define: { "process.env": JSON.stringify({ NODE_ENV: "development", NEXT_PUBLIC_API_URL: `http://127.0.0.1:${port}` }) },
  server: { host: "127.0.0.1", port, strictPort: true, watch: { ignored: ["**/.next/**", "**/.open-next/**"] } },
});
// This transport fixture renders production components but is not OAuth,
// a hosted Gateway, SQL persistence, or model-quality acceptance evidence.
async function serveFixture(request, response, next, instance) {
  const path = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
  const json = (value, status = 200) => { response.statusCode = status;
    response.setHeader("content-type", "application/json"); response.end(JSON.stringify(value)); };
  if (path === "/") {
    response.setHeader("content-type", "text/html");
    response.end(await instance.transformIndexHtml("/", '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/summary-selection.tsx"></script></body></html>'));
    return;
  }
  if (!path.startsWith("/api/")) return next();
  if (path === "/api/v1/documents") return json({ documents, total: 2 });
  if (path === "/api/v1/workspaces/current") return json({ role: "owner" });
  if (/\/sessions\/[^/]+\/messages$/.test(path)) return json({ messages: [], total: 0 });
  if (path !== "/api/v1/chat" || request.method !== "POST") return json({ detail: "Unknown fixture request" }, 404);
  let raw = "";
  for await (const fragment of request) raw += fragment;
  const body = JSON.parse(raw);
  requests++;
  if (body.chat_scope !== "documents" || !body.document_ids?.includes(cover)) {
    return json({ error: { code: "DOCUMENT_SELECTION_REQUIRED", message: "Select the document or documents to summarize." } }, 422);
  }
  return json({ answer: "This application describes laboratory collaboration and research plans. [S1]",
    query_type: "summary", confidence: 0.8, response_time_seconds: 0.01,
    sources: [{ content: "Dear hiring team. This application describes laboratory collaboration and research plans.",
      filename: "Cover_Letter.txt", page_number: 1, document_type: "txt", relevance_score: 0.8,
      metadata: { document_id: cover, chunk_id: "80808080-8080-4080-8080-808080808080", source_id: "S1" } }],
    metadata: { document_selection: { reason: "EXPLICIT_SCOPE", document_ids: [cover] } } });
}
await server.listen();
console.log(`SYNTHETIC_COMPONENT_FIXTURE http://127.0.0.1:${port}/; no hosted credentials/provider processing`);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
  console.log(JSON.stringify({ fixture_chat_requests: requests, production_acceptance: false }));
  await server.close(); process.exit(0);
});
