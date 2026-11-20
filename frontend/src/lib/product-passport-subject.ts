export const passportSubjectFields = [
  ["product_id", "Product identifier", 128], ["product_name", "Product name", 256],
  ["product_version", "Product version", 128], ["supplier", "Supplier", 256],
] as const;
export type PassportSubject = Record<(typeof passportSubjectFields)[number][0], string>;

export function normalizePassportSubject(value: unknown): PassportSubject {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 4
    || Object.keys(value).some(key => !passportSubjectFields.some(([field]) => field === key)))
    throw new Error("A complete declared product identity is required.");
  const subject = value as Record<string, unknown>;
  return Object.fromEntries(passportSubjectFields.map(([field, label, maximum]) => {
    const text = subject[field];
    if (typeof text !== "string" || !text.trim() || text.includes("\0") || Array.from(text).length > maximum)
      throw new Error(`${label} is required and must contain at most ${maximum} characters.`);
    return [field, text.trim()];
  })) as PassportSubject;
}
export function passportSubjectIdentity(value: unknown): string {
  return JSON.stringify(normalizePassportSubject(value));
}
