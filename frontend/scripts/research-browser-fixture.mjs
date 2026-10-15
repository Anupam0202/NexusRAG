import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { handle } from "../../apps/gateway/src/preview-worker.js";
import { RESEARCH_MODE_LIMITS } from "../../apps/gateway/src/research-plans.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] || 3024);
const workspace = "11111111-1111-4111-8111-111111111111", user = "22222222-2222-4222-8222-222222222222";
const policy = "44444444-4444-4444-8444-444444444444", document = "60606060-6060-4060-8060-606060606060";
const env = { SUPABASE_URL: "https://research-peer.invalid", SUPABASE_PUBLISHABLE_KEY: "synthetic-public", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service" };
const records = new Map(), keys = new Map();
const calculations = new Map(), calculationKeys = new Map();
const aggregations = new Map(), aggregationKeys = new Map();
const conversions = new Map(), conversionKeys = new Map();
const quantities = new Map(), quantityKeys = new Map();
const sourceVersion="70707070-7070-4070-8070-707070707070",sourceChunk="80808080-8080-4080-8080-808080808080";
const sourceText="\u{1F4CA} mass: 1.005 kg; other mass 9 kg",sourceHash=createHash("sha256").update(sourceText).digest("hex");
const ordinaryFetch = globalThis.fetch;
// Only the Supabase peer is simulated. Production page, API client and Gateway
// dispatch run unchanged. This is not SQL durability, real OAuth or hosted proof.
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  if (url.hostname !== "research-peer.invalid") return ordinaryFetch(input, init);
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
  if (url.pathname === "/auth/v1/user") return json({id: new Headers(init.headers).get("authorization")?.split(":").at(-1) || user});
  if (url.pathname === "/rest/v1/workspace_members") return json([{workspace_id: workspace, user_id: url.searchParams.get("user_id")?.slice(3) || user, role: "owner"}]);
  if (url.pathname === "/rest/v1/workspaces") return json([{id: workspace, name: "Synthetic research workspace", lifecycle_state: "active", capability_revision: 1}]);
  if (url.pathname === "/rest/v1/workspace_settings") return json([{active_policy_id: policy, policy_version: 1}]);
  if (url.pathname === "/rest/v1/documents") return json([{id: document, workspace_id: workspace, filename: "Synthetic policy.txt", status: "ready", file_type: "txt", chunk_count: 1, file_size: 100,lifecycle_state:"active",lifecycle_epoch:1,active_version_id:sourceVersion}]);
  if (url.pathname === "/rest/v1/document_versions") return json([{id:sourceVersion,workspace_id:workspace,document_id:document,publication_state:"ready",index_generation:"synthetic-source-generation",lifecycle_epoch:1}]);
  if (url.pathname === "/rest/v1/document_chunks") return json([{id:sourceChunk,workspace_id:workspace,document_id:document,version_id:sourceVersion,chunk_index:0,original_text:sourceText,content:sourceText,original_content_hash:sourceHash,page_number:2,location:{page:2},metadata:{}}]);
  const data = JSON.parse(init.body);
  if (url.pathname === "/rest/v1/rpc/nexus_research_quantity") {
    if(data.p_operation==="list")return json({items:[...quantities.values()].filter(item=>item.owner_id===data.p_context.user_id && item.plan_id===data.p_plan_id).reverse(),next_after:null});
    if(quantityKeys.has(data.p_key))return json(quantities.get(quantityKeys.get(data.p_key)));
    const command=data.p_input;
    if(command.document_id!==document || command.version_id!==sourceVersion || command.original_content_hash!==sourceHash ||
      command.value_span.start!==8 || command.value_span.end!==13 || command.unit_span.start!==14 || command.unit_span.end!==16)throw new Error("Unsupported synthetic capture response");
    const id=randomUUID(),record={id,plan_id:data.p_plan_id,workspace_id:workspace,owner_id:data.p_context.user_id,document_id:document,version_id:sourceVersion,chunk_id:sourceChunk,input:command,
      quantity:{value:"1.005",unit:"kg",evidence_ids:[`urn:nexusrag:quantity:${id}`]},source:{filename:"Synthetic policy.txt",page_number:2,location:{page:2},value_context:{text:sourceText,span_start:8,span_end:13},unit_context:{text:sourceText,span_start:14,span_end:16}},
      schema_version:"research-quantity/1",state:"captured",persistence_state:"PERSISTED",source_state:"SOURCE_SPANS_MATCHED_REVIEW_REQUIRED",freshness:"current",created_at:new Date().toISOString()};
    quantities.set(id,record);quantityKeys.set(data.p_key,id);
    return json({code:"08006",message:"Synthetic interrupted capture response after commit"},503);
  }
  if (url.pathname === "/rest/v1/rpc/nexus_research_conversion") {
    if(data.p_operation==="list")return json({items:[...conversions.values()].filter(item=>item.owner_id===data.p_context.user_id && item.plan_id===data.p_plan_id).reverse(),next_after:null});
    if(conversionKeys.has(data.p_key))return json(conversions.get(conversionKeys.get(data.p_key)));
    const command=data.p_input;
    // Fixed transport response; real conversion arithmetic/persistence is tested in SQL.
    if(command.quantity.value!=="1.005" || command.quantity.unit!=="kg" || command.factor!=="1000" || command.target_unit!=="g" ||
      command.precision!==2 || command.factor_effective_on!=="2026-10-15")throw new Error("Unsupported synthetic conversion response");
    const record={id:randomUUID(),plan_id:data.p_plan_id,workspace_id:workspace,owner_id:data.p_context.user_id,input:command,
      result:{operation:"CONVERT_UNIT",value:"1005.00",unit:"g",formula:"1.005*1000",evidence_ids:[...new Set([...command.quantity.evidence_ids,command.conversion_evidence_id])],precision:2,rounding:"ROUND_HALF_EVEN"},
      schema_version:"research-conversion/1",state:"calculated",persistence_state:"PERSISTED",input_evidence_state:"CALLER_ASSERTED_NOT_VERIFIED",created_at:new Date().toISOString()};
    conversions.set(record.id,record);conversionKeys.set(data.p_key,record.id);
    return json({code:"08006",message:"Synthetic interrupted conversion response after commit"},503);
  }
  if (url.pathname === "/rest/v1/rpc/nexus_research_aggregation") {
    if(data.p_operation==="list")return json({items:[...aggregations.values()].filter(item=>item.owner_id===data.p_context.user_id && item.plan_id===data.p_plan_id).reverse(),next_after:null});
    if(aggregationKeys.has(data.p_key))return json(aggregations.get(aggregationKeys.get(data.p_key)));
    const command=data.p_input;
    // Fixed weighted-average transport fixture, not a second arithmetic engine.
    if(command.operation!=="WEIGHTED_AVERAGE" || command.precision!==2 || !command.grouped || command.missing_value_treatment!=="EXCLUDE" ||
      JSON.stringify(command.weights)!==JSON.stringify(["1","3","0"]) || JSON.stringify(command.values.map(q=>q.value))!==JSON.stringify(["0.1","0.2",null]) ||
      command.values.some(q=>q.unit!=="USD" || q.group!=="A"))throw new Error("Unsupported synthetic aggregate response");
    const record={id:randomUUID(),plan_id:data.p_plan_id,workspace_id:workspace,owner_id:data.p_context.user_id,input:command,
      result:{operation:command.operation,precision:2,rounding:"ROUND_HALF_EVEN",missing_value_treatment:"EXCLUDE",groups:[{
        group:"A",value:"0.18",unit:"USD",expression:"weighted_average(0.1,0.2;weights=1,3)",rows:[],
        evidence_ids:[...new Set(command.values.slice(0,2).flatMap(q=>q.evidence_ids))],total_count:3,included_count:2,excluded_count:1,excluded_input_indices:[2],value_display:"ROUND_HALF_EVEN"}]},
      state:"calculated",schema_version:"research-aggregation/1",persistence_state:"PERSISTED",input_evidence_state:"CALLER_ASSERTED_NOT_VERIFIED",created_at:new Date().toISOString()};
    aggregations.set(record.id,record);aggregationKeys.set(data.p_key,record.id);
    return json({code:"08006",message:"Synthetic interrupted aggregate response after commit"},503);
  }
  if (url.pathname === "/rest/v1/rpc/nexus_research_calculation") {
    if(data.p_operation==="list")return json({items:[...calculations.values()].filter(item=>item.owner_id===data.p_context.user_id && item.plan_id===data.p_plan_id).reverse()});
    if(calculationKeys.has(data.p_key))return json(calculations.get(calculationKeys.get(data.p_key)));
    if(data.p_input.right.value==="0")return json({code:"P0001",message:"NR:CALCULATION_INVALID"},400);
    // Fixed transport response only. Real arithmetic/persistence has separate SQL tests.
    const captured=data.p_input.operation==="ADD" && data.p_input.left.value==="1.005" && data.p_input.right.value==="1.005" && data.p_input.precision===3;
    if(!captured && (data.p_input.operation!=="ADD" || data.p_input.left.value!=="9007199254740993.1" || data.p_input.right.value!=="0.2" || data.p_input.precision!==2))throw new Error("Unsupported synthetic calculation response");
    const record={id:randomUUID(),plan_id:data.p_plan_id,workspace_id:workspace,owner_id:data.p_context.user_id,input:data.p_input,
      result:{operation:"ADD",value:captured?"2.010":"9007199254740993.30",unit:captured?"kg":"USD",formula:captured?"1.005+1.005":"9007199254740993.1+0.2",
        evidence_ids:[...new Set([...data.p_input.left.evidence_ids,...data.p_input.right.evidence_ids])],precision:captured?3:2,rounding:"ROUND_HALF_EVEN"},
      state:"calculated",schema_version:"research-calculation/1",persistence_state:"PERSISTED",input_evidence_state:"CALLER_ASSERTED_NOT_VERIFIED",created_at:new Date().toISOString()};
    calculations.set(record.id,record);calculationKeys.set(data.p_key,record.id);
    if(data.p_input.left.evidence_ids.includes("synthetic-interrupted-calculation"))return json({code:"08006",message:"Synthetic interrupted response after commit"},503);
    return json(record);
  }
  if (url.pathname !== "/rest/v1/rpc/nexus_research_plan") throw new Error(`Unexpected synthetic peer path: ${url.pathname}`);
  if (data.p_operation === "create") {
    if (keys.has(data.p_key)) return json(records.get(keys.get(data.p_key)));
    const record = {id: randomUUID(), workspace_id: workspace, owner_id: data.p_context.user_id, plan: data.p_plan,
      limits: RESEARCH_MODE_LIMITS[data.p_plan.mode], state: "planned", persistence_state: "PERSISTED", execution_supported: false,
      schema_version: "research-plan/1", created_at: new Date().toISOString()};
    records.set(record.id, record); keys.set(data.p_key, record.id);
    if (data.p_plan.question.includes("Synthetic interrupted save")) return json({code: "08006", message: "Synthetic connection interrupted after commit"}, 503);
    return json(record);
  }
  if (data.p_operation === "read") return json(records.get(data.p_id));
  const ordered = [...records.values()].filter(item => item.owner_id===data.p_context.user_id).reverse();
  const start = data.p_after ? ordered.findIndex(item => item.id === data.p_after) + 1 : 0;
  const items = ordered.slice(start, start + data.p_limit);
  return json({items, next_after: start + items.length < ordered.length ? items.at(-1).id : null});
};
const server = await createServer({ root, configFile: false, envFile: false,
  // The HTML is generated by middleware, so Vite cannot infer its TSX entry.
  // Discover dependencies before interaction, not by reloading a filled form.
  optimizeDeps: { entries: ["scripts/fixtures/research-plans.tsx"],
    include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react", "zustand", "clsx", "tailwind-merge"],
    force: true, holdUntilCrawlEnd: true },
  plugins: [react(), {name: "synthetic-research-transport", configureServer(instance) {
    instance.middlewares.use((request, response, next) => { void serve(request, response, next, instance).catch(error => {
      console.error(error); response.statusCode=500; response.end("Synthetic fixture failed");
    }); });
  }}],
  resolve: {alias: [{find: "@/lib/api-context", replacement: resolve(root,"scripts/fixtures/research-context.ts")}, {find: "@", replacement: resolve(root,"src")}]},
  define: {"process.env": JSON.stringify({NODE_ENV: "development", NEXT_PUBLIC_API_URL: `http://127.0.0.1:${port}`})},
  server: {host: "127.0.0.1", port, strictPort: true, watch: {ignored: ["**/.next/**", "**/.open-next/**"]}},
});
async function serve(request, response, next, instance) {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (url.pathname === "/") {
    response.setHeader("content-type","text/html");
    response.end(await instance.transformIndexHtml("/", '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/research-plans.tsx"></script></body></html>'));
    return;
  }
  if (!url.pathname.startsWith("/api/")) return next();
  let body=""; for await (const fragment of request) body+=fragment;
  const result = await handle(new Request(url, {method: request.method, headers: request.headers,
    ...(["GET","HEAD"].includes(request.method) ? {} : {body})}), env);
  response.statusCode=result.status;
  result.headers.forEach((value,key) => response.setHeader(key,value));
  response.end(Buffer.from(await result.arrayBuffer()));
}
await server.listen();
console.log(`SYNTHETIC_RESEARCH_UI_GATEWAY_FIXTURE http://127.0.0.1:${port}/; no hosted credentials/provider processing`);
for (const signal of ["SIGINT","SIGTERM"]) process.on(signal, async () => { await server.close(); process.exit(0); });
