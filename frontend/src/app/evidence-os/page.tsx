import {
  Activity, AlertTriangle, Beaker, BookOpenCheck, Building2, Calculator, CloudCog, Code2, FileCheck2, FileSearch,
  FileText, Landmark, MessageSquare, Network, PackageCheck, Scale, ShieldCheck,
} from "lucide-react";
import Link from "@/components/layout/StaticLink";
import { enabledFeatures } from "@/lib/features";

// What the app does today, and what is still being built. Products in development are listed with a plain
// status and linked only when switched on (lib/features.ts).
const AVAILABLE = [
  { name: "Chat with citations", description: "Ask about your documents; every answer links to the passages it comes from.", icon: MessageSquare, href: "/chat" },
  { name: "Documents", description: "Upload PDF, Word and text files. Each one shows whether it is ready to answer from.", icon: FileText, href: "/documents" },
  { name: "Research", description: "Plan a deeper question, run it across your documents, and see what was consulted and skipped.", icon: FileSearch, href: "/research" },
  { name: "Findings & reviews", description: "Save an answer as a finding, have a colleague review it, and export it with its evidence.", icon: FileCheck2, href: "/findings" },
] as const;

const IN_DEVELOPMENT = [
  { name: "API Terms & Quota Radar", description: "Notices when a provider changes its terms, quotas, prices or deprecations.", icon: Activity, status: "partly built", feature: "radar", href: "/radar" },
  { name: "Regulatory Obligation Compiler", description: "Turns regulations into reviewable obligations, each linked to its source text.", icon: Scale, status: "in development" },
  { name: "Procurement Intelligence Graph", description: "Tenders, buyers, suppliers and awards, each linked to its notice.", icon: Landmark, status: "waiting for a data-source review" },
  { name: "Counterparty Evidence Graph", description: "Organizations tracked over time, keeping verified facts apart from uncertain ones.", icon: Building2, status: "in development" },
  { name: "Product Evidence Passport", description: "A portable, reviewable record of what is known about a product, and what is not.", icon: PackageCheck, status: "in development" },
  { name: "Scientific Evidence Workbench", description: "Papers, registries and datasets, with corrections and retractions kept in view.", icon: Beaker, status: "waiting for data connections" },
  { name: "Open-Source Assurance Graph", description: "Supplied SBOM, licence and advisory data with references and review.", icon: Code2, status: "waiting for a data-source review" },
  { name: "Infrastructure & Public Risk", description: "Watchlists of authoritative public-risk sources, with change alerts.", icon: CloudCog, status: "waiting for a data-source review" },
  { name: "Evidence API & MCP", description: "Reviewed evidence for other tools to read, within your workspace's limits.", icon: Network, status: "partly built", feature: "evidence-api", href: "/evidence-api" },
] as const;

export default function EvidenceOSPage() {
  const features = enabledFeatures();
  return (
    <div
      role="region"
      className="h-full overflow-y-auto"
      tabIndex={0}
      aria-label="Evidence Intelligence OS content"
    >
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-8 md:py-8">
        <section className="relative overflow-hidden rounded-3xl border border-brand-400/20 bg-linear-to-br/srgb from-slate-950 via-indigo-950 to-purple-950 p-6 text-white shadow-2xl md:p-9">
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-purple-500/20 blur-3xl" />
          <div className="relative max-w-3xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide">
              <ShieldCheck size={14} /> About NexusRAG
            </div>
            <h1 className="text-3xl font-black tracking-tight md:text-5xl">Evidence Intelligence OS</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-indigo-100 md:text-base">
              NexusRAG answers questions about your documents with citations you can check, and helps your team turn
              those answers into reviewed findings.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 text-xs">
              {["Private to your workspace", "Every answer shows its sources", "No hidden paid fallback"].map((item) => (
                <span key={item} className="rounded-lg bg-white/10 px-3 py-2">{item}</span>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/documents" className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-indigo-950">Upload documents</Link>
              <Link href="/chat" className="rounded-xl border border-white/30 px-4 py-2 text-sm font-semibold">Ask a question</Link>
            </div>
          </div>
        </section>

        <section aria-labelledby="available-now">
          <h2 id="available-now" className="mb-3 text-lg font-bold">Available now</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {AVAILABLE.map(({ name, description, icon: Icon, href }) => (
              <Link key={name} href={href} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-linear-to-br/srgb from-brand-500/15 to-purple-500/15 p-2.5 text-brand-600 dark:text-brand-300"><Icon size={20} /></div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">{name}</h3>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{description}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section aria-labelledby="in-development">
          <h2 id="in-development" className="text-lg font-bold">In development</h2>
          <p className="mb-3 text-sm text-[var(--text-muted)]">Built on the same documents, evidence, review and deletion. Each joins the app once it works end to end.</p>
          <div className="grid gap-3 md:grid-cols-2">
            {IN_DEVELOPMENT.map((product) => {
              const Icon = product.icon;
              const open = "feature" in product && features.has(product.feature);
              return (
                <article key={product.name} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-slate-500/10 p-2.5 text-[var(--text-secondary)]"><Icon size={20} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-semibold">{product.name}</h3>
                        <span className="rounded-full bg-slate-500/10 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300">{product.status}</span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{product.description}</p>
                      {open && "href" in product && <Link href={product.href} className="mt-2 inline-block text-xs underline">Open</Link>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3" aria-label="What you can rely on">
          <Guarantee icon={BookOpenCheck} title="Answers show their sources" text="Each claim links to the passage and page it comes from, or says that nothing supports it." />
          <Guarantee icon={Calculator} title="Numbers are computed, not guessed" text="Calculations run as code, with their inputs, units and formula shown." />
          <Guarantee icon={AlertTriangle} title="Nothing runs on unknown terms" text="A data source whose terms or limits are unclear stays off until someone reviews it." />
        </section>
      </div>
    </div>
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
