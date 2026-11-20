\set ON_ERROR_STOP on
-- Runs right after the migrations, before fixtures.sql replaces the provider rows with synthetic ones. The operator's
-- review (scripts/provider_review.py) reads each terms page itself, so each address must serve the terms as text.
-- Google's https://ai.google.dev/gemini-api/terms now draws them in the browser (its HTML holds only the title);
-- the same terms are published as Markdown at https://aistudio.google.com/docs/terms.md.
do $$
declare address text;
begin
  select terms_url into address from public.provider_registry where id = 'gemini';
  if address is distinct from 'https://aistudio.google.com/docs/terms.md' then
    raise exception 'the Gemini terms address does not serve the terms as text: %', address;
  end if;
end $$;
select 'PROVIDER_TERMS_ADDRESS_SQL_PASS';
