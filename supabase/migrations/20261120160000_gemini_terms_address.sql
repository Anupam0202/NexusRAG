-- Points the operator's Gemini terms review at an address that serves the terms as text.
--
-- On 20 November 2026 Google's https://ai.google.dev/gemini-api/terms began serving a page that draws the terms in
-- the browser: its HTML holds only the title, so scripts/provider_review.py refused it ("too little text") and no
-- deployment could record a Gemini review. Google publishes the same terms at https://aistudio.google.com/docs/terms
-- and, as Markdown, at https://aistudio.google.com/docs/terms.md, which the review reads.
--
-- Only the address changes. A review already on record stays valid; the next review fingerprints the Markdown text,
-- and if that differs from the last recorded fingerprint, workspace owners are asked to approve Gemini again, as for
-- any change of terms. An address someone has set by hand is left as it is.
update public.provider_registry
   set terms_url = 'https://aistudio.google.com/docs/terms.md', updated_at = now()
 where id = 'gemini' and terms_url = 'https://ai.google.dev/gemini-api/terms';
