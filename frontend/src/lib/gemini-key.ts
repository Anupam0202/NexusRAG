/** The bounds the gateway applies to a Gemini key before it asks Google (POST /api/v1/apikey). */
export const GEMINI_KEY_MIN_LENGTH = 20;
export const GEMINI_KEY_MAX_LENGTH = 512;

/** What is wrong with a pasted key, or null when it is worth sending to the gateway for checking. */
export function geminiKeyProblem(value: string): string | null {
  const key = value.trim();
  if (!key) return "Enter your Gemini API key.";
  if (key.length < GEMINI_KEY_MIN_LENGTH || key.length > GEMINI_KEY_MAX_LENGTH || /[\r\n]/.test(key) || key.includes("\0")) {
    return "That does not look like a Gemini API key. Copy the whole key from Google AI Studio; it usually starts with AIza.";
  }
  return null;
}
