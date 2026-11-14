export const SETTINGS_DEFAULTS = Object.freeze({
  retrieval_top_k: 10,
  hybrid_search_alpha: 0.6,
  llm_temperature: 0.1,
});
export function persistedSetting(row, key, { min, max, integer = false }) {
  const value = row?.[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)))
    return SETTINGS_DEFAULTS[key];
  return value;
}
