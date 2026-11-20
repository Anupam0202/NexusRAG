-- Service-only evidence, Radar and research tables already deny browser roles: row security is on, no policy
-- exists and no table privilege is granted. State that boundary explicitly, as earlier service tables do, so
-- the Supabase security advisor reports nothing for them and a later grant cannot open them by accident.

create policy finding_export_rights_client_deny
  on public.finding_export_rights as restrictive
  for all to anon, authenticated
  using (false) with check (false);

create policy finding_packages_client_deny
  on public.finding_packages as restrictive
  for all to anon, authenticated
  using (false) with check (false);

create policy finding_serving_rights_client_deny
  on public.finding_serving_rights as restrictive
  for all to anon, authenticated
  using (false) with check (false);

create policy obligation_evidence_origins_client_deny
  on public.obligation_evidence_origins as restrictive
  for all to anon, authenticated
  using (false) with check (false);

create policy radar_changes_client_deny
  on public.radar_changes as restrictive
  for all to anon, authenticated
  using (false) with check (false);

create policy radar_findings_client_deny
  on public.radar_findings as restrictive
  for all to anon, authenticated
  using (false) with check (false);

create policy radar_reviews_client_deny
  on public.radar_reviews as restrictive
  for all to anon, authenticated
  using (false) with check (false);

create policy radar_snapshots_client_deny
  on public.radar_snapshots as restrictive
  for all to anon, authenticated
  using (false) with check (false);

create policy radar_sources_client_deny
  on public.radar_sources as restrictive
  for all to anon, authenticated
  using (false) with check (false);

create policy research_calculations_client_deny
  on public.research_calculations as restrictive
  for all to anon, authenticated
  using (false) with check (false);

create policy research_plans_client_deny
  on public.research_plans as restrictive
  for all to anon, authenticated
  using (false) with check (false);

create policy research_quantities_client_deny
  on public.research_quantities as restrictive
  for all to anon, authenticated
  using (false) with check (false);

create policy research_runs_client_deny
  on public.research_runs as restrictive
  for all to anon, authenticated
  using (false) with check (false);
