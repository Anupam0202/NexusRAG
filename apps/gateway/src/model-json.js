// Replies that Gemini is asked to give as JSON. The request asks for JSON output (responseMimeType), but a model
// that ignores it wraps the JSON in a Markdown code fence, as every structured research reply did live before
// issue #29. One surrounding fence is removed; anything else must be JSON as it stands.
const FENCED = /^```[a-z]*[ \t]*\r?\n([\s\S]*?)\r?\n?[ \t]*```$/i;
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;

/** The JSON value of a model reply, or a SyntaxError for the caller to turn into its own refusal. */
export function parseModelJson(answer) {
  const text = String(answer ?? "").trim();
  const fenced = text.match(FENCED);
  return JSON.parse(fenced ? fenced[1] : text);
}

/**
 * The structure of a model reply without any of its text, for logs: object keys that look like field names (any
 * other key as its length), array lengths with their first three items, and each string as its length. Reading it
 * says why a reply was refused (a missing field, a list of the wrong length, a string over its limit) without
 * logging what a document says.
 */
export function replyShape(answer) {
  let value;
  try { value = parseModelJson(answer); }
  catch { return { parsed: false, characters: Array.from(String(answer ?? "")).length, fenced: /^\s*```/.test(String(answer ?? "")) }; }
  return { parsed: true, shape: shapeOf(value, 0) };
}

function shapeOf(value, depth) {
  if (typeof value === "string") return `string(${Array.from(value).length})`;
  if (value === null || typeof value !== "object") return value === null ? "null" : typeof value;
  if (depth >= 4) return Array.isArray(value) ? `array(${value.length})` : "object";
  if (Array.isArray(value)) return { length: value.length, first: value.slice(0, 3).map(item => shapeOf(item, depth + 1)) };
  return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, item]) =>
    [FIELD_NAME.test(key) ? key : `key(${Array.from(key).length})`, shapeOf(item, depth + 1)]));
}
