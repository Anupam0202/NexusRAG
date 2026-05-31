-- NexusRAG multi-tenant indexes.

create index if not exists workspaces_owner_id_idx
on public.workspaces (owner_id);

create index if not exists workspace_members_user_id_idx
on public.workspace_members (user_id);

create index if not exists documents_workspace_status_idx
on public.documents (workspace_id, status, created_at desc);

create index if not exists documents_workspace_uploaded_by_idx
on public.documents (workspace_id, uploaded_by);

create unique index if not exists documents_workspace_sha_active_idx
on public.documents (workspace_id, sha256)
where sha256 is not null and status <> 'deleted';

create index if not exists document_chunks_workspace_document_idx
on public.document_chunks (workspace_id, document_id, chunk_index);

create index if not exists document_chunks_workspace_hash_idx
on public.document_chunks (workspace_id, content_hash);

create index if not exists document_chunks_metadata_gin_idx
on public.document_chunks using gin (metadata);

create index if not exists ingestion_jobs_workspace_status_idx
on public.ingestion_jobs (workspace_id, status, created_at desc);

create index if not exists ingestion_jobs_document_id_idx
on public.ingestion_jobs (document_id);

create index if not exists chat_sessions_workspace_user_idx
on public.chat_sessions (workspace_id, user_id, updated_at desc);

create index if not exists chat_messages_session_created_idx
on public.chat_messages (session_id, created_at);

create index if not exists llm_usage_workspace_created_idx
on public.llm_usage_events (workspace_id, created_at desc);

create index if not exists audit_events_workspace_created_idx
on public.audit_events (workspace_id, created_at desc);

create index if not exists audit_events_user_created_idx
on public.audit_events (user_id, created_at desc);

create unique index if not exists api_keys_workspace_user_provider_active_idx
on public.api_keys (workspace_id, user_id, provider)
where is_active = true;

create index if not exists eval_runs_workspace_created_idx
on public.eval_runs (workspace_id, created_at desc);

create index if not exists eval_results_run_idx
on public.eval_results (eval_run_id, created_at);
