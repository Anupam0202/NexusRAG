/**
 * Products that are built but not yet verified end to end stay out of the navigation until they are switched on
 * (decision D10). The list is baked in at build time from NEXT_PUBLIC_FEATURES, for example "radar,evidence-api".
 */
export const OPTIONAL_FEATURES = ["radar", "evidence-api", "evaluations"] as const;
export type OptionalFeature = (typeof OPTIONAL_FEATURES)[number];

export function enabledFeatures(raw: string | undefined = process.env.NEXT_PUBLIC_FEATURES): Set<OptionalFeature> {
  const known = new Set<string>(OPTIONAL_FEATURES);
  return new Set(
    String(raw ?? "")
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter((name): name is OptionalFeature => known.has(name))
  );
}

export function featureEnabled(name: OptionalFeature, raw?: string): boolean {
  return enabledFeatures(raw ?? process.env.NEXT_PUBLIC_FEATURES).has(name);
}
