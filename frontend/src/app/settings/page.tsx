"use client";

import { useEffect, useState } from "react";
import { getSettings, updateSettings } from "@/lib/api";
import type { AppSettings, SettingsUpdate } from "@/types";
import { toast } from "sonner";
import { Save, Settings2, Loader2 } from "lucide-react";

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<SettingsUpdate>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s);
        setDraft({
          llm_temperature: s.llm_temperature,
          retrieval_top_k: s.retrieval_top_k,
          enable_reranking: s.enable_reranking,
          hybrid_search_alpha: s.hybrid_search_alpha,
          context_window_messages: s.context_window_messages,
        });
      })
      .catch((err) => toast.error(err.message));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await updateSettings(draft);
      setSettings(updated);
      toast.success("Settings saved successfully");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] text-sm gap-2">
        <Loader2 size={20} className="animate-spin" />
        Loading settings…
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6">
        <div className="flex items-center gap-2">
          <Settings2 size={20} className="text-brand-500" />
          <h2 className="text-lg font-bold">Runtime Settings</h2>
        </div>

        <div className="space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 md:p-6">
          <Slider label="Temperature" desc="0 = factual, 1 = creative"
            value={draft.llm_temperature ?? settings.llm_temperature} min={0} max={1} step={0.05}
            onChange={(v) => setDraft((d) => ({ ...d, llm_temperature: v }))} />

          <Slider label="Retrieval Top K" desc="Chunks retrieved per query"
            value={draft.retrieval_top_k ?? settings.retrieval_top_k} min={1} max={50} step={1}
            onChange={(v) => setDraft((d) => ({ ...d, retrieval_top_k: v }))} />

          <Slider label="Hybrid Alpha" desc="0 = keyword, 1 = semantic"
            value={draft.hybrid_search_alpha ?? settings.hybrid_search_alpha} min={0} max={1} step={0.05}
            onChange={(v) => setDraft((d) => ({ ...d, hybrid_search_alpha: v }))} />

          <Slider label="Context Window" desc="Recent messages sent to LLM"
            value={draft.context_window_messages ?? settings.context_window_messages} min={1} max={30} step={1}
            onChange={(v) => setDraft((d) => ({ ...d, context_window_messages: v }))} />

          {/* Re-ranking toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Re-ranking</p>
              <p className="text-xs text-[var(--text-muted)]">Cross-encoder re-scoring</p>
            </div>
            <button
              onClick={() => setDraft((d) => ({ ...d, enable_reranking: !(d.enable_reranking ?? settings.enable_reranking) }))}
              className={`relative h-6 w-11 rounded-full transition ${
                (draft.enable_reranking ?? settings.enable_reranking) ? "bg-brand-500" : "bg-gray-300 dark:bg-gray-600"
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                (draft.enable_reranking ?? settings.enable_reranking) ? "translate-x-5" : ""
              }`} />
            </button>
          </div>

          <hr className="border-[var(--border)]" />

          {/* Read-only info */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Info label="Model" value={settings.llm_model_name} />
            <Info label="Embedding" value={settings.embedding_model.split("/").pop() ?? ""} />
            <Info label="Chunk Size" value={`${settings.chunk_size}`} />
            <Info label="Semantic Chunking" value={settings.enable_semantic_chunking ? "On" : "Off"} />
            <Info label="Contextual Enrichment" value={settings.enable_contextual_enrichment ? "On" : "Off"} />
          </div>
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-purple-600 text-white px-5 py-2.5 text-sm font-semibold shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 w-full sm:w-auto justify-center"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {saving ? "Saving…" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

function Slider({ label, desc, value, min, max, step, onChange }: {
  label: string; desc: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-[var(--text-muted)]">{desc}</p>
        </div>
        <span className="text-sm font-semibold text-brand-600 dark:text-brand-400 tabular-nums bg-brand-50 dark:bg-brand-900/30 px-2 py-0.5 rounded-md">
          {Number.isInteger(step) ? value : value.toFixed(2)}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none bg-gray-200 dark:bg-gray-700 accent-brand-500 cursor-pointer" />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="font-medium text-sm truncate">{value}</p>
    </div>
  );
}