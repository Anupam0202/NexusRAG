import {
  Activity, AlertTriangle, Beaker, BookOpenCheck, Box, Building2,
  Calculator, CloudCog, Code2, FileSearch, Landmark, Network,
  PackageCheck, Scale, ShieldCheck,
} from "lucide-react";

const PRODUCTS = [
  { name: "Evidence Workbench", description: "Evidence-first research with claim status, citations, comparisons, timelines, and contradiction analysis.", icon: FileSearch, state: "FOUNDATION_READY" },
  { name: "API Terms & Quota Radar", description: "Material-change detection for provider terms, quotas, pricing, schemas, and deprecations.", icon: Activity, state: "FOUNDATION_READY" },
  { name: "Regulatory Obligation Compiler", description: "Review-first obligations linked to authoritative text, jurisdiction, actors, dates, and supersession.", icon: Scale, state: "FOUNDATION_READY" },
  { name: "Procurement Intelligence Graph", description: "Evidence-linked notices, buyers, suppliers, lots, awards, amendments, and identifiers.", icon: Landmark, state: "PROVIDER_REVIEW" },
  { name: "Counterparty Evidence Graph", description: "Temporal entity resolution that keeps assertions, uncertainty, and verified joins distinct.", icon: Building2, state: "FOUNDATION_READY" },
  { name: "Product Evidence Passport", description: "Portable software evidence claims with deterministic JSON-LD receipts and SBOM-ready provenance.", icon: PackageCheck, state: "FOUNDATION_READY" },
  { name: "Scientific Evidence Workbench", description: "Paper, registry, dataset, and authority evidence with versioned extraction and review.", icon: Beaker, state: "CONNECTORS_PENDING" },
  { name: "Open-Source Assurance Graph", description: "OSV, KEV, SPDX, VEX, and SLSA evidence without flattening uncertainty.", icon: Code2, state: "PROVIDER_REVIEW" },
  { name: "Infrastructure & Public Risk", description: "Watchlist-driven monitoring of authoritative public-risk sources within bounded quotas.", icon: CloudCog, state: "PROVIDER_REVIEW" },
  { name: "Evidence API & MCP", description: "Capability-scoped evidence operations with tenant, rights, version, and budget enforcement.", icon: Network, state: "CONTRACT_READY" },
] as const;

const STATUS_STYLE: Record<string, string> = {
  FOUNDATION_READY: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  CONTRACT_READY: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  PROVIDER_REVIEW: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  CONNECTORS_PENDING: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
};

export default function EvidenceOSPage() {
  return (
    <main
      className="h-full overflow-y-auto"
      tabIndex={0}
      aria-label="Evidence Intelligence OS content"
    >
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-8 md:py-8">
        <section className="relative overflow-hidden rounded-3xl border border-brand-400/20 bg-gradient-to-br from-slate-950 via-indigo-950 to-purple-950 p-6 text-white shadow-2xl md:p-9">
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-purple-500/20 blur-3xl" />
          <div className="relative max-w-3xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide">
              <ShieldCheck size={14} /> ZERO_COST_LOW_TRAFFIC
            </div>
            <h1 className="text-3xl font-black tracking-tight md:text-5xl">Evidence Intelligence OS</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-indigo-100 md:text-base">
              A rights-aware evidence supply chain for turning private documents and authoritative public data into reviewable claims, obligations, relationships, decisions, monitors, and portable evidence packages.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 text-xs">
              {["Tenant isolated", "Provenance fenced", "Fail-closed quotas", "No hidden paid fallback"].map((item) => (
                <span key={item} className="rounded-lg bg-white/10 px-3 py-2">{item}</span>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="platform-products">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <h2 id="platform-products" className="text-lg font-bold">One platform, ten evidence products</h2>
              <p className="text-sm text-[var(--text-muted)]">Shared identity, evidence, rights, graph, review, budgets, exports, audit, and deletion.</p>
            </div>
            <span className="hidden text-xs text-[var(--text-muted)] sm:block">Honest readiness states</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {PRODUCTS.map(({ name, description, icon: Icon, state }) => (
              <article key={name} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-gradient-to-br from-brand-500/15 to-purple-500/15 p-2.5 text-brand-600 dark:text-brand-300"><Icon size={20} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold">{name}</h3>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold tracking-wide ${STATUS_STYLE[state]}`}>{state.replaceAll("_", " ")}</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{description}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3" aria-label="Evidence guarantees">
          <Guarantee icon={BookOpenCheck} title="Evidence before prose" text="Claims carry versioned locators and explicit support states." />
          <Guarantee icon={Calculator} title="Deterministic arithmetic" text="Formula, units, precision, and input evidence remain inspectable." />
          <Guarantee icon={AlertTriangle} title="Fail closed" text="Unknown rights and undocumented quotas require review instead of guessing." />
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
          <div className="flex items-center gap-2"><Box size={18} className="text-brand-500" /><h2 className="font-bold">Setup Center</h2></div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Live services stay disabled until their identity, rights, budget, and isolation gates are verified.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Cloudflare gateway", "PREVIEW FOUNDATION"],
              ["Supabase authority", "SCHEMA VERIFIED"],
              ["Qdrant retrieval", "CREDENTIAL REQUIRED"],
              ["Gemini gateway", "CREDENTIAL REQUIRED"],
            ].map(([label, state]) => (
              <div key={label} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
                <div className="text-xs font-semibold">{label}</div>
                <div className="mt-1 text-[10px] font-bold text-[var(--text-muted)]">{state}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function Guarantee({ icon: Icon, title, text }: { icon: typeof ShieldCheck; title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <Icon size={18} className="text-brand-500" />
      <h2 className="mt-3 text-sm font-bold">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{text}</p>
    </div>
  );
}