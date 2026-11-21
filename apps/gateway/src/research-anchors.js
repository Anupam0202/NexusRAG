// How research prompts ask Gemini to point at evidence. Gemini cannot count characters: live on 2026-11-21 every
// figure a CALCULATION run anchored by code-point offsets pointed at the wrong words, and Entity Investigation, Due
// Diligence and Product Passport replies were refused for the same reason (issue #29). Prompts therefore ask for the
// exact wording, which the parsers find in the passage themselves; offsets are still read when a reply sends them.
export const QUOTE_ANCHOR = '{"citation_id":"S#","quote":"exact contiguous wording"}';
export const ANCHOR_RULE = `Each anchor is ${QUOTE_ANCHOR}: the wording copied exactly, character for character, from that source's content, at most 300 characters. Never paraphrase, shorten, translate or reformat a quote, and never count characters or give offsets.`;
