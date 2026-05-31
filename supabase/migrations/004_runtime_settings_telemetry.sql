-- Keep workspace runtime settings aligned with the settings UI.

alter table public.workspace_settings
  add column if not exists context_window_messages int not null default 10
    check (context_window_messages between 1 and 50),
  add column if not exists enable_semantic_chunking boolean not null default true,
  add column if not exists chunk_size int not null default 1000
    check (chunk_size between 100 and 8000),
  add column if not exists chunk_overlap int not null default 200
    check (chunk_overlap between 0 and 2000),
  add column if not exists embedding_model text not null
    default 'sentence-transformers/all-MiniLM-L6-v2';

create index if not exists llm_usage_events_workspace_created_idx
  on public.llm_usage_events(workspace_id, created_at desc);

create index if not exists audit_events_workspace_created_idx
  on public.audit_events(workspace_id, created_at desc);
