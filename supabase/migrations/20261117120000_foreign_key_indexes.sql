-- Covering indexes for the 21 foreign keys that had none (Supabase performance advisor, lint 0001).
--
-- Without one, deleting or changing a referenced row makes PostgreSQL scan the whole referencing table to check the
-- key: removing an account scans research plans, runs, calculations and quantities and workspace invitations for the
-- person, deleting a document scans research quantities, and deleting a research run scans findings. The indexes
-- also serve the lookups these columns are joined on. tests/postgres/foreign-key-index-assertions.sql keeps every
-- foreign key covered from now on.

-- Findings and their exports.
create index if not exists findings_source_research_run_id_idx on public.findings (source_research_run_id);
create index if not exists finding_packages_finding_id_idx on public.finding_packages (finding_id);

-- Workspace invitations, by the person who sent or accepted them.
create index if not exists workspace_invitations_accepted_by_idx on public.workspace_invitations (accepted_by);
create index if not exists workspace_invitations_created_by_idx on public.workspace_invitations (created_by);

-- Research plans, runs, calculations and the quantities they cite.
create index if not exists research_plans_owner_id_idx on public.research_plans (owner_id);
create index if not exists research_runs_owner_id_idx on public.research_runs (owner_id);
create index if not exists research_runs_plan_id_idx on public.research_runs (plan_id);
create index if not exists research_calculations_owner_id_idx on public.research_calculations (owner_id);
create index if not exists research_calculations_plan_id_idx on public.research_calculations (plan_id);
create index if not exists research_quantities_chunk_id_idx on public.research_quantities (chunk_id);
create index if not exists research_quantities_document_id_idx on public.research_quantities (document_id);
create index if not exists research_quantities_owner_id_idx on public.research_quantities (owner_id);
create index if not exists research_quantities_plan_id_idx on public.research_quantities (plan_id);
create index if not exists research_quantities_version_id_idx on public.research_quantities (version_id);

-- Radar sources, snapshots and changes.
create index if not exists radar_sources_provider_id_idx on public.radar_sources (provider_id);
create index if not exists radar_sources_workspace_latest_snapshot_idx on public.radar_sources (workspace_id, latest_snapshot_id);
create index if not exists radar_sources_workspace_monitor_idx on public.radar_sources (workspace_id, monitor_id);
create index if not exists radar_snapshots_workspace_version_idx on public.radar_snapshots (workspace_id, version_id);
create index if not exists radar_changes_workspace_after_snapshot_idx on public.radar_changes (workspace_id, after_snapshot_id);
create index if not exists radar_changes_workspace_before_snapshot_idx on public.radar_changes (workspace_id, before_snapshot_id);
create index if not exists radar_changes_workspace_source_idx on public.radar_changes (workspace_id, source_id);
