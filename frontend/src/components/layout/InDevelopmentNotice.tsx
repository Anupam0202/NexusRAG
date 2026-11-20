import { FlaskConical } from "lucide-react";
import { featureEnabled, type OptionalFeature } from "@/lib/features";

/** Shown on a product page reached directly while the product is still in development and switched off. */
export function InDevelopmentNotice({ feature, name }: { feature: OptionalFeature; name: string }) {
  if (featureEnabled(feature)) return null;
  return (
    <p role="note" className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
      <FlaskConical size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{name} is still in development and is not part of the supported app yet. It may change or stop working.</span>
    </p>
  );
}
