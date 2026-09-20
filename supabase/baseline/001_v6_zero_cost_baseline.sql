-- NexusRAG Evidence Intelligence OS
-- Clean migration-001 baseline generated from the reviewed live catalog.
-- Status: CANDIDATE_NOT_APPLIED. Production application requires separate authorization.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';
set local search_path = public, extensions, pg_catalog;
create schema if not exists extensions;
create schema if not exists nexusrag_private;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create sequence if not exists public.workbench_turn_order as bigint start with 1 increment by 1 minvalue 1 no maxvalue cache 1 no cycle;

create table if not exists public."api_keys" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "user_id" uuid not null,
  "provider" text not null,
  "encrypted_key" text not null,
  "key_prefix" text,
  "is_active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "last_used_at" timestamp with time zone,
  "encryption_key_version" text default 'legacy'::text not null,
  "credential_version" bigint default 1 not null,
  "revoked_at" timestamp with time zone
);

create table if not exists public."audit_events" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid,
  "user_id" uuid,
  "action" text not null,
  "resource_type" text,
  "resource_id" text,
  "ip_address" text,
  "user_agent" text,
  "metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists public."budget_reservations" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "provider_id" text not null,
  "dimension" text not null,
  "amount" bigint not null,
  "idempotency_key" text not null,
  "state" text default 'RESERVED'::text not null,
  "measured" bigint,
  "reset_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "settled_at" timestamp with time zone
);

create table if not exists public."cache_entries" (
  "workspace_id" uuid not null,
  "cache_key" text not null,
  "authorization_revision" bigint not null,
  "workspace_policy_hash" text not null,
  "rights_hash" text not null,
  "source_version_hashes" text[] not null,
  "operation" text not null,
  "prompt_version" text not null,
  "model_revision" text not null,
  "payload" jsonb not null,
  "expires_at" timestamp with time zone not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists public."chat_messages" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "session_id" uuid not null,
  "role" text not null,
  "content" text not null,
  "sources" jsonb default '[]'::jsonb not null,
  "metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "run_id" uuid,
  "message_order" bigint
);

create table if not exists public."chat_sessions" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "user_id" uuid,
  "title" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "visibility" text default 'private'::text not null,
  "deleted_at" timestamp with time zone,
  "revision" bigint default 1 not null
);

create table if not exists public."conversation_participants" (
  "workspace_id" uuid not null,
  "session_id" uuid not null,
  "user_id" uuid not null,
  "permission" text not null
);

create table if not exists public."deletion_operations" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "resource_id" uuid not null,
  "tombstone_epoch" bigint not null,
  "state" text default 'pending'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "verified_at" timestamp with time zone
);

create table if not exists public."deletion_receipts" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "operation_id" uuid not null,
  "target_id" uuid not null,
  "provider" text not null,
  "receipt_hash" text not null,
  "verified_at" timestamp with time zone not null
);

create table if not exists public."deletion_targets" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "operation_id" uuid not null,
  "kind" text not null,
  "resource_id" uuid,
  "bucket" text,
  "object_key" text,
  "inventory" jsonb default '{}'::jsonb not null,
  "attempts" integer default 0 not null,
  "verified_at" timestamp with time zone,
  "failure_code" text,
  "next_attempt_at" timestamp with time zone default now() not null
);

create table if not exists public."document_chunks" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "document_id" uuid not null,
  "chunk_index" integer not null,
  "content" text not null,
  "content_hash" text,
  "page_number" integer,
  "section_title" text,
  "token_count" integer,
  "qdrant_point_id" text,
  "metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "embedding" extensions.vector(384),
  "version_id" uuid,
  "original_content_hash" text,
  "original_text" text,
  "enrichment_text" text,
  "location" jsonb,
  "embedding_space_id" text
);

create table if not exists public."document_uploads" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "actor_id" uuid not null,
  "document_id" uuid not null,
  "version_id" uuid default gen_random_uuid() not null,
  "replacement" boolean default false not null,
  "lifecycle_epoch" bigint not null,
  "filename" text not null,
  "content_type" text not null,
  "expected_bytes" bigint not null,
  "original_bucket" text not null,
  "original_key" text not null,
  "original_hash" text,
  "original_bytes" bigint,
  "state" text default 'allocated'::text not null,
  "write_token" uuid,
  "original_verified_at" timestamp with time zone,
  "job_id" uuid,
  "cleanup_state" text default 'not_needed'::text not null,
  "failed_at" timestamp with time zone,
  "cleanup_verified_at" timestamp with time zone,
  "begin_key" text not null,
  "begin_hash" text not null,
  "complete_key" text,
  "created_at" timestamp with time zone default now() not null,
  "expires_at" timestamp with time zone default (now() + '01:00:00'::interval) not null
);

create table if not exists public."document_versions" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "document_id" uuid not null,
  "original_bucket" text not null,
  "original_key" text not null,
  "original_hash" text not null,
  "original_bytes" bigint not null,
  "original_verified_at" timestamp with time zone not null,
  "parser_version" text not null,
  "chunker_version" text not null,
  "embedding_space_id" text,
  "index_generation" text,
  "extraction_manifest" jsonb default '{}'::jsonb not null,
  "lifecycle_epoch" bigint not null,
  "publication_state" text default 'staged'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "published_at" timestamp with time zone,
  "failure_code" text,
  "staged_by_generation" bigint,
  "staged_manifest_hash" text
);

create table if not exists public."documents" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "uploaded_by" uuid not null,
  "filename" text not null,
  "original_filename" text not null,
  "content_type" text,
  "file_size_bytes" bigint default 0 not null,
  "storage_bucket" text default 'documents'::text not null,
  "storage_path" text,
  "sha256" text,
  "status" text default 'queued'::text not null,
  "page_count" integer default 0 not null,
  "chunk_count" integer default 0 not null,
  "error_message" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "lifecycle_state" text default 'active'::text not null,
  "lifecycle_epoch" bigint default 1 not null,
  "revision" bigint default 1 not null,
  "active_version_id" uuid
);

create table if not exists public."eval_results" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "eval_run_id" uuid not null,
  "question" text not null,
  "expected_answer" text,
  "answer" text,
  "expected_sources" jsonb default '[]'::jsonb not null,
  "sources" jsonb default '[]'::jsonb not null,
  "metrics" jsonb default '{}'::jsonb not null,
  "passed" boolean,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists public."eval_runs" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "user_id" uuid,
  "name" text not null,
  "mode" text default 'mock'::text not null,
  "status" text default 'queued'::text not null,
  "metrics" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "completed_at" timestamp with time zone
);

create table if not exists public."evidence_exports" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "requested_by" uuid not null,
  "format" text not null,
  "state" text default 'queued'::text not null,
  "attribution" text[] default '{}'::text[] not null,
  "manifest_hash" text,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists public."evidence_items" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "source_version_id" uuid not null,
  "evidence_type" text not null,
  "locator" jsonb not null,
  "exact_hash" text not null,
  "claim_state" text not null,
  "confidence" numeric(5,4) not null,
  "attribution" text[] default '{}'::text[] not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists public."evidence_source_versions" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "source_id" uuid not null,
  "version_key" text not null,
  "content_hash" text not null,
  "retrieved_at" timestamp with time zone not null,
  "valid_from" timestamp with time zone,
  "valid_to" timestamp with time zone,
  "recorded_at" timestamp with time zone default now() not null,
  "rights_hash" text not null,
  "attribution" text[] default '{}'::text[] not null,
  "metadata" jsonb default '{}'::jsonb not null,
  "supersedes_id" uuid
);

create table if not exists public."evidence_sources" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "provider_id" text,
  "source_kind" text not null,
  "canonical_uri" text not null,
  "title" text not null,
  "authority" text,
  "rights_hash" text not null,
  "lifecycle_state" text default 'active'::text not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists public."finding_participants" (
  "workspace_id" uuid not null,
  "finding_id" uuid not null,
  "user_id" uuid not null,
  "permission" text not null
);

create table if not exists public."finding_reviews" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "finding_id" uuid not null,
  "revision" bigint not null,
  "reviewer_id" uuid not null,
  "decision" text not null,
  "comment" text not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists public."finding_versions" (
  "workspace_id" uuid not null,
  "finding_id" uuid not null,
  "revision" bigint not null,
  "author_id" uuid not null,
  "title" text not null,
  "authored_markdown" text not null,
  "generated_markdown" text,
  "redacted_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists public."findings" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "owner_id" uuid not null,
  "title" text not null,
  "revision" bigint default 1 not null,
  "source_run_id" uuid,
  "deleted_at" timestamp with time zone,
  "create_key" text not null,
  "payload_hash" text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists public."graph_aliases" (
  "workspace_id" uuid not null,
  "entity_id" uuid not null,
  "alias" text not null,
  "source_version_id" uuid not null
);

create table if not exists public."graph_entities" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "entity_type" text not null,
  "canonical_id" text not null,
  "jurisdiction" text,
  "valid_from" timestamp with time zone,
  "valid_to" timestamp with time zone,
  "recorded_at" timestamp with time zone default now() not null,
  "confidence" numeric(5,4) not null,
  "resolution_method" text not null,
  "review_state" text default 'REVIEW_REQUIRED'::text not null,
  "supersedes_id" uuid
);

create table if not exists public."graph_relationships" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "source_entity_id" uuid not null,
  "target_entity_id" uuid not null,
  "relationship_type" text not null,
  "evidence_item_id" uuid not null,
  "valid_from" timestamp with time zone,
  "valid_to" timestamp with time zone,
  "recorded_at" timestamp with time zone default now() not null,
  "confidence" numeric(5,4) not null,
  "resolution_method" text not null,
  "review_state" text default 'REVIEW_REQUIRED'::text not null,
  "contradiction_state" text default 'NONE'::text not null,
  "reviewed_by" uuid
);

create table if not exists public."ingestion_jobs" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "document_id" uuid,
  "status" text default 'queued'::text not null,
  "progress" integer default 0 not null,
  "stage" text,
  "error_message" text,
  "attempts" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "available_at" timestamp with time zone default now() not null,
  "lease_owner" text,
  "lease_expires_at" timestamp with time zone,
  "max_attempts" integer default 3 not null,
  "last_error_at" timestamp with time zone,
  "kind" text default 'ingestion'::text not null,
  "version_id" uuid,
  "lifecycle_epoch" bigint default 1 not null,
  "lease_generation" bigint default 0 not null,
  "heartbeat_at" timestamp with time zone,
  "cancellation_requested_at" timestamp with time zone,
  "error_code" text,
  "payload" jsonb default '{}'::jsonb not null
);

create table if not exists public."llm_usage_events" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "user_id" uuid,
  "provider" text,
  "model" text,
  "operation" text,
  "input_tokens" integer,
  "output_tokens" integer,
  "latency_ms" integer,
  "success" boolean default true not null,
  "error_code" text,
  "created_at" timestamp with time zone default now() not null,
  "cost_microusd" bigint default 0 not null
);

create table if not exists public."materializations" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "provider_id" text not null,
  "source_version_id" uuid,
  "selection_logic" jsonb not null,
  "source_hash" text not null,
  "materialized_records" bigint not null,
  "reconstructible" boolean default true not null,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists public."monitor_runs" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "monitor_id" uuid not null,
  "status" text not null,
  "previous_hash" text,
  "current_hash" text,
  "materiality" text,
  "started_at" timestamp with time zone default now() not null,
  "completed_at" timestamp with time zone,
  "metadata" jsonb default '{}'::jsonb not null
);

create table if not exists public."monitors" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "provider_id" text not null,
  "owner_id" uuid not null,
  "tier" text not null,
  "retrieval_method" text not null,
  "target_uri" text not null,
  "etag" text,
  "last_modified" text,
  "last_content_hash" text,
  "next_run_at" timestamp with time zone,
  "state" text default 'READY'::text not null,
  "enabled" boolean default true not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists public."profiles" (
  "id" uuid not null,
  "email" text,
  "display_name" text,
  "avatar_url" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists public."provider_health_state" (
  "workspace_id" uuid not null,
  "provider" text not null,
  "model" text not null,
  "mode" text not null,
  "consecutive_failures" integer default 0 not null,
  "quota_exhausted" boolean default false not null,
  "last_error_code" text,
  "circuit_open_until" timestamp with time zone,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists public."provider_registry" (
  "id" text not null,
  "display_name" text not null,
  "jurisdiction" text,
  "authority" text not null,
  "documentation_url" text not null,
  "terms_url" text not null,
  "pricing_url" text,
  "licence" text,
  "authentication" jsonb default '{}'::jsonb not null,
  "quota" jsonb default '{}'::jsonb not null,
  "pagination" jsonb default '{}'::jsonb not null,
  "bulk_path" text,
  "incremental_path" text,
  "stable_identifiers" text[] default '{}'::text[] not null,
  "rights" jsonb default '{}'::jsonb not null,
  "attribution" text[] default '{}'::text[] not null,
  "privacy" jsonb default '{}'::jsonb not null,
  "sensitive_data" jsonb default '{}'::jsonb not null,
  "freshness" jsonb default '{}'::jsonb not null,
  "historical_coverage" jsonb default '{}'::jsonb not null,
  "schema_version" text,
  "deprecation" jsonb default '{}'::jsonb not null,
  "status" text default 'UNKNOWN'::text not null,
  "fallback" text,
  "self_host_option" text,
  "paid_migration_path" text,
  "terms_checked_at" timestamp with time zone,
  "terms_hash" text,
  "review_owner" uuid,
  "revision" bigint default 1 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists public."provider_terms_snapshots" (
  "id" uuid default gen_random_uuid() not null,
  "provider_id" text not null,
  "revision" bigint not null,
  "checked_at" timestamp with time zone not null,
  "content_hash" text not null,
  "etag" text,
  "last_modified" text,
  "retrieval_method" text not null,
  "terms" jsonb not null,
  "materiality" text not null,
  "approved_by" uuid
);

create table if not exists public."query_events" (
  "workspace_id" uuid not null,
  "run_id" uuid not null,
  "sequence" bigint not null,
  "event_id" uuid not null,
  "event_hash" text not null,
  "event_type" text not null,
  "attempt_id" uuid not null,
  "payload" jsonb not null,
  "occurred_at" timestamp with time zone default clock_timestamp() not null,
  "redacted_at" timestamp with time zone
);

create table if not exists public."query_run_sources" (
  "workspace_id" uuid not null,
  "run_id" uuid not null,
  "document_id" uuid not null,
  "version_id" uuid not null,
  "lifecycle_epoch" bigint not null
);

create table if not exists public."query_runs" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "user_id" uuid not null,
  "session_id" uuid not null,
  "job_id" uuid not null,
  "reservation_id" uuid not null,
  "attempt_id" uuid default gen_random_uuid() not null,
  "idempotency_key" text not null,
  "payload_hash" text not null,
  "request" jsonb not null,
  "context" jsonb not null,
  "state" text default 'accepted'::text not null,
  "next_sequence" bigint default 1 not null,
  "deadline" timestamp with time zone not null,
  "turn_order" bigint default nextval('workbench_turn_order'::regclass) not null,
  "final_answer" jsonb,
  "accounting_state" text default 'not_started'::text not null,
  "persistence_state" text default 'committed'::text not null,
  "cancellation_requested_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "completed_at" timestamp with time zone,
  "last_observed_at" timestamp with time zone default now() not null
);

create table if not exists public."resource_budgets" (
  "scope_key" text not null,
  "workspace_id" uuid,
  "provider_id" text not null,
  "dimension" text not null,
  "hard_limit" bigint not null,
  "used" bigint default 0 not null,
  "reserved" bigint default 0 not null,
  "window_kind" text not null,
  "reset_at" timestamp with time zone,
  "state" text default 'READY'::text not null,
  "revision" bigint default 1 not null,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists public."rights_decisions" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "provider_id" text not null,
  "action" text not null,
  "decision" text not null,
  "provider_revision" bigint not null,
  "workspace_policy_version" bigint,
  "rights_hash" text not null,
  "duties" text[] default '{}'::text[] not null,
  "reason_code" text not null,
  "decided_at" timestamp with time zone default now() not null,
  "actor_id" uuid,
  "request_id" text
);

create table if not exists public."usage_ledger" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "actor_id" uuid not null,
  "reservation_id" uuid not null,
  "attempt_id" uuid not null,
  "provider" text not null,
  "model" text not null,
  "funding_principal" text not null,
  "input_tokens" bigint,
  "output_tokens" bigint,
  "cost_microusd" bigint,
  "measurement" text default 'unknown'::text not null,
  "state" text default 'pending_reconciliation'::text not null,
  "price_table_version" text,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists public."usage_reservations" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "actor_id" uuid not null,
  "operation_id" uuid not null,
  "charge_period" date default ((now() AT TIME ZONE 'UTC'::text))::date not null,
  "reserved_queries" bigint not null,
  "reserved_tokens" bigint not null,
  "state" text not null,
  "created_at" timestamp with time zone default now() not null,
  "expires_at" timestamp with time zone not null
);

create table if not exists public."workbench_mutations" (
  "workspace_id" uuid not null,
  "actor_id" uuid not null,
  "operation" text not null,
  "idempotency_key" text not null,
  "payload_hash" text not null,
  "response" jsonb not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists public."workbench_outbox" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "aggregate_id" uuid not null,
  "aggregate_version" bigint not null,
  "event_type" text not null,
  "payload" jsonb default '{}'::jsonb not null,
  "delivered_at" timestamp with time zone,
  "next_attempt_at" timestamp with time zone default now() not null,
  "attempts" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists public."workspace_members" (
  "workspace_id" uuid not null,
  "user_id" uuid not null,
  "role" text not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists public."workspace_policy_versions" (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "version" bigint not null,
  "policy" jsonb not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists public."workspace_provider_policies" (
  "workspace_id" uuid not null,
  "provider_id" text not null,
  "status" text default 'UNKNOWN'::text not null,
  "allowed_actions" text[] default '{}'::text[] not null,
  "prohibited_actions" text[] default '{}'::text[] not null,
  "review_actions" text[] default '{}'::text[] not null,
  "duties" text[] default '{}'::text[] not null,
  "rights_hash" text not null,
  "policy_version" bigint default 1 not null,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone
);

create table if not exists public."workspace_settings" (
  "workspace_id" uuid not null,
  "retrieval_top_k" integer default 10 not null,
  "hybrid_search_alpha" double precision default 0.6 not null,
  "enable_reranking" boolean default false not null,
  "enable_query_expansion" boolean default true not null,
  "enable_contextual_enrichment" boolean default false not null,
  "llm_temperature" double precision default 0.1 not null,
  "default_model" text default 'gemini-2.5-flash'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "context_window_messages" integer default 10 not null,
  "enable_semantic_chunking" boolean default true not null,
  "chunk_size" integer default 1000 not null,
  "chunk_overlap" integer default 200 not null,
  "embedding_model" text default 'sentence-transformers/all-MiniLM-L6-v2'::text not null,
  "retention_enabled" boolean default false not null,
  "retention_days" integer default 0 not null,
  "last_retention_at" timestamp with time zone,
  "next_retention_at" timestamp with time zone,
  "retention_lease_owner" text,
  "retention_lease_expires_at" timestamp with time zone,
  "policy_version" bigint default 1 not null,
  "active_policy_id" uuid
);

create table if not exists public."workspace_usage_daily" (
  "workspace_id" uuid not null,
  "usage_date" date not null,
  "query_count" bigint default 0 not null,
  "input_tokens" bigint default 0 not null,
  "output_tokens" bigint default 0 not null,
  "total_tokens" bigint default 0 not null,
  "successful_calls" bigint default 0 not null,
  "failed_calls" bigint default 0 not null,
  "estimated_cost_microusd" bigint default 0 not null,
  "reconciled_at" timestamp with time zone default now() not null
);

create table if not exists public."workspaces" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "slug" text not null,
  "owner_id" uuid not null,
  "plan" text default 'free'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "lifecycle_state" text default 'active'::text not null,
  "capability_revision" bigint default 1 not null
);

alter table only public."api_keys" add constraint "api_keys_pkey" PRIMARY KEY (id);
alter table only public."api_keys" add constraint "api_keys_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table only public."api_keys" add constraint "api_keys_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table only public."audit_events" add constraint "audit_events_pkey" PRIMARY KEY (id);
alter table only public."audit_events" add constraint "audit_events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only public."audit_events" add constraint "audit_events_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
alter table only public."budget_reservations" add constraint "budget_reservations_amount_check" CHECK (amount > 0);
alter table only public."budget_reservations" add constraint "budget_reservations_measured_check" CHECK (measured IS NULL OR measured >= 0);
alter table only public."budget_reservations" add constraint "budget_reservations_pkey" PRIMARY KEY (id);
alter table only public."budget_reservations" add constraint "budget_reservations_provider_id_fkey" FOREIGN KEY (provider_id) REFERENCES provider_registry(id);
alter table only public."budget_reservations" add constraint "budget_reservations_state_check" CHECK (state = ANY (ARRAY['RESERVED'::text, 'SETTLED'::text, 'RELEASED'::text, 'RECONCILIATION_REQUIRED'::text]));
alter table only public."budget_reservations" add constraint "budget_reservations_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
alter table only public."budget_reservations" add constraint "budget_reservations_workspace_id_idempotency_key_key" UNIQUE (workspace_id, idempotency_key);
alter table only public."cache_entries" add constraint "cache_entries_pkey" PRIMARY KEY (workspace_id, cache_key);
alter table only public."cache_entries" add constraint "cache_entries_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
alter table only public."chat_messages" add constraint "chat_messages_pkey" PRIMARY KEY (id);
alter table only public."chat_messages" add constraint "chat_messages_role_check" CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text]));
alter table only public."chat_messages" add constraint "chat_messages_session_id_fkey" FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE;
alter table only public."chat_messages" add constraint "chat_messages_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table only public."chat_messages" add constraint "message_run_tenant_fk" FOREIGN KEY (workspace_id, run_id) REFERENCES query_runs(workspace_id, id);
alter table only public."chat_messages" add constraint "messages_tenant_session_fk" FOREIGN KEY (workspace_id, session_id) REFERENCES chat_sessions(workspace_id, id) NOT VALID;
alter table only public."chat_sessions" add constraint "chat_sessions_pkey" PRIMARY KEY (id);
alter table only public."chat_sessions" add constraint "chat_sessions_tenant_identity" UNIQUE (workspace_id, id);
alter table only public."chat_sessions" add constraint "chat_sessions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only public."chat_sessions" add constraint "chat_sessions_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table only public."chat_sessions" add constraint "chat_visibility_v2" CHECK (visibility = ANY (ARRAY['private'::text, 'legacy_workspace'::text]));
alter table only public."conversation_participants" add constraint "conversation_participants_permission_check" CHECK (permission = ANY (ARRAY['read'::text, 'contribute'::text]));
alter table only public."conversation_participants" add constraint "conversation_participants_pkey" PRIMARY KEY (workspace_id, session_id, user_id);
alter table only public."conversation_participants" add constraint "conversation_participants_workspace_id_session_id_fkey" FOREIGN KEY (workspace_id, session_id) REFERENCES chat_sessions(workspace_id, id) ON DELETE CASCADE;
alter table only public."conversation_participants" add constraint "conversation_participants_workspace_id_user_id_fkey" FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members(workspace_id, user_id) ON DELETE CASCADE;
alter table only public."deletion_operations" add constraint "deletion_operations_pkey" PRIMARY KEY (id);
alter table only public."deletion_operations" add constraint "deletion_operations_state_check" CHECK (state = ANY (ARRAY['pending'::text, 'cleaning'::text, 'blocked'::text, 'verified'::text]));
alter table only public."deletion_operations" add constraint "deletion_operations_workspace_id_id_key" UNIQUE (workspace_id, id);
alter table only public."deletion_receipts" add constraint "deletion_receipts_pkey" PRIMARY KEY (id);
alter table only public."deletion_receipts" add constraint "deletion_receipts_receipt_hash_check" CHECK (receipt_hash ~ '^[0-9a-f]{64}$'::text);
alter table only public."deletion_receipts" add constraint "deletion_receipts_target_id_fkey" FOREIGN KEY (target_id) REFERENCES deletion_targets(id);
alter table only public."deletion_receipts" add constraint "deletion_receipts_workspace_id_operation_id_fkey" FOREIGN KEY (workspace_id, operation_id) REFERENCES deletion_operations(workspace_id, id);
alter table only public."deletion_receipts" add constraint "deletion_receipts_workspace_id_target_id_provider_key" UNIQUE (workspace_id, target_id, provider);
alter table only public."deletion_targets" add constraint "deletion_targets_pkey" PRIMARY KEY (id);
alter table only public."deletion_targets" add constraint "deletion_targets_workspace_id_operation_id_fkey" FOREIGN KEY (workspace_id, operation_id) REFERENCES deletion_operations(workspace_id, id);
alter table only public."document_chunks" add constraint "chunk_version_tenant_fk" FOREIGN KEY (workspace_id, document_id, version_id) REFERENCES document_versions(workspace_id, document_id, id) NOT VALID;
alter table only public."document_chunks" add constraint "chunks_tenant_document_fk" FOREIGN KEY (workspace_id, document_id) REFERENCES documents(workspace_id, id) NOT VALID;
alter table only public."document_chunks" add constraint "chunks_tenant_id" UNIQUE (workspace_id, id);
alter table only public."document_chunks" add constraint "chunks_v2_evidence_required" CHECK (version_id IS NULL OR original_text IS NOT NULL AND original_content_hash ~ '^[0-9a-f]{64}$'::text AND location IS NOT NULL AND embedding_space_id IS NOT NULL) NOT VALID;
alter table only public."document_chunks" add constraint "document_chunks_document_id_fkey" FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;
alter table only public."document_chunks" add constraint "document_chunks_pkey" PRIMARY KEY (id);
alter table only public."document_chunks" add constraint "document_chunks_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table only public."document_uploads" add constraint "document_uploads_cleanup_state_check" CHECK (cleanup_state = ANY (ARRAY['not_needed'::text, 'pending'::text, 'verified'::text]));
alter table only public."document_uploads" add constraint "document_uploads_expected_bytes_check" CHECK (expected_bytes >= 1 AND expected_bytes <= 25000000);
alter table only public."document_uploads" add constraint "document_uploads_original_bucket_original_key_key" UNIQUE (original_bucket, original_key);
alter table only public."document_uploads" add constraint "document_uploads_pkey" PRIMARY KEY (id);
alter table only public."document_uploads" add constraint "document_uploads_state_check" CHECK (state = ANY (ARRAY['allocated'::text, 'receiving'::text, 'stored'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]));
alter table only public."document_uploads" add constraint "document_uploads_workspace_id_actor_id_begin_key_key" UNIQUE (workspace_id, actor_id, begin_key);
alter table only public."document_uploads" add constraint "document_uploads_workspace_id_document_id_fkey" FOREIGN KEY (workspace_id, document_id) REFERENCES documents(workspace_id, id);
alter table only public."document_uploads" add constraint "document_uploads_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
alter table only public."document_uploads" add constraint "document_uploads_workspace_id_id_key" UNIQUE (workspace_id, id);
alter table only public."document_versions" add constraint "document_versions_original_bucket_original_key_key" UNIQUE (original_bucket, original_key);
alter table only public."document_versions" add constraint "document_versions_original_bytes_check" CHECK (original_bytes >= 0);
alter table only public."document_versions" add constraint "document_versions_original_hash_check" CHECK (original_hash ~ '^[0-9a-f]{64}$'::text);
alter table only public."document_versions" add constraint "document_versions_pkey" PRIMARY KEY (id);
alter table only public."document_versions" add constraint "document_versions_publication_state_check" CHECK (publication_state = ANY (ARRAY['staged'::text, 'processing'::text, 'indexed'::text, 'ready'::text, 'failed'::text, 'cancelled'::text, 'legacy_unverified'::text]));
alter table only public."document_versions" add constraint "document_versions_workspace_id_document_id_fkey" FOREIGN KEY (workspace_id, document_id) REFERENCES documents(workspace_id, id);
alter table only public."document_versions" add constraint "document_versions_workspace_id_document_id_id_key" UNIQUE (workspace_id, document_id, id);
alter table only public."document_versions" add constraint "document_versions_workspace_id_id_key" UNIQUE (workspace_id, id);
alter table only public."documents" add constraint "active_version_tenant_fk" FOREIGN KEY (workspace_id, id, active_version_id) REFERENCES document_versions(workspace_id, document_id, id) DEFERRABLE INITIALLY DEFERRED;
alter table only public."documents" add constraint "documents_lifecycle_state_check" CHECK (lifecycle_state = ANY (ARRAY['active'::text, 'deleting'::text, 'deleted'::text]));
alter table only public."documents" add constraint "documents_pkey" PRIMARY KEY (id);
alter table only public."documents" add constraint "documents_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'processing'::text, 'ready'::text, 'failed'::text, 'deleted'::text]));
alter table only public."documents" add constraint "documents_tenant_identity" UNIQUE (workspace_id, id);
alter table only public."documents" add constraint "documents_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES profiles(id) ON DELETE RESTRICT;
alter table only public."documents" add constraint "documents_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table only public."eval_results" add constraint "eval_results_eval_run_id_fkey" FOREIGN KEY (eval_run_id) REFERENCES eval_runs(id) ON DELETE CASCADE;
alter table only public."eval_results" add constraint "eval_results_pkey" PRIMARY KEY (id);
alter table only public."eval_results" add constraint "eval_results_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table only public."eval_runs" add constraint "eval_runs_pkey" PRIMARY KEY (id);
alter table only public."eval_runs" add constraint "eval_runs_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]));
alter table only public."eval_runs" add constraint "eval_runs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only public."eval_runs" add constraint "eval_runs_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table only public."evidence_exports" add constraint "evidence_exports_format_check" CHECK (format = ANY (ARRAY['JSON_LD'::text, 'W3C_PROV'::text, 'RO_CRATE'::text, 'ODRL'::text, 'SPDX'::text, 'CYCLONEDX'::text]));
alter table only public."evidence_exports" add constraint "evidence_exports_pkey" PRIMARY KEY (id);
alter table only public."evidence_exports" add constraint "evidence_exports_state_check" CHECK (state = ANY (ARRAY['queued'::text, 'building'::text, 'ready'::text, 'failed'::text, 'expired'::text]));
alter table only public."evidence_exports" add constraint "evidence_exports_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
alter table only public."evidence_items" add constraint "evidence_items_claim_state_check" CHECK (claim_state = ANY (ARRAY['SUPPORTED'::text, 'PARTIALLY_SUPPORTED'::text, 'CONTRADICTED'::text, 'INFERRED'::text, 'UNSUPPORTED'::text, 'STALE'::text, 'SOURCE_UNAVAILABLE'::text]));
alter table only public."evidence_items" add constraint "evidence_items_confidence_check" CHECK (confidence >= 0::numeric AND confidence <= 1::numeric);
alter table only public."evidence_items" add constraint "evidence_items_exact_hash_check" CHECK (exact_hash ~ '^[0-9a-f]{64}$'::text);
alter table only public."evidence_items" add constraint "evidence_items_pkey" PRIMARY KEY (id);
alter table only public."evidence_items" add constraint "evidence_items_workspace_id_id_key" UNIQUE (workspace_id, id);
alter table only public."evidence_items" add constraint "evidence_items_workspace_id_source_version_id_fkey" FOREIGN KEY (workspace_id, source_version_id) REFERENCES evidence_source_versions(workspace_id, id);
alter table only public."evidence_source_versions" add constraint "evidence_source_versions_content_hash_check" CHECK (content_hash ~ '^[0-9a-f]{64}$'::text);
alter table only public."evidence_source_versions" add constraint "evidence_source_versions_pkey" PRIMARY KEY (id);
alter table only public."evidence_source_versions" add constraint "evidence_source_versions_rights_hash_check" CHECK (rights_hash ~ '^[0-9a-f]{64}$'::text);
alter table only public."evidence_source_versions" add constraint "evidence_source_versions_workspace_id_id_key" UNIQUE (workspace_id, id);
alter table only public."evidence_source_versions" add constraint "evidence_source_versions_workspace_id_source_id_fkey" FOREIGN KEY (workspace_id, source_id) REFERENCES evidence_sources(workspace_id, id);
alter table only public."evidence_source_versions" add constraint "evidence_source_versions_workspace_id_source_id_version_key_key" UNIQUE (workspace_id, source_id, version_key);
alter table only public."evidence_source_versions" add constraint "evidence_source_versions_workspace_id_supersedes_id_fkey" FOREIGN KEY (workspace_id, supersedes_id) REFERENCES evidence_source_versions(workspace_id, id);
alter table only public."evidence_sources" add constraint "evidence_sources_lifecycle_state_check" CHECK (lifecycle_state = ANY (ARRAY['active'::text, 'revoked'::text, 'deleted'::text]));
alter table only public."evidence_sources" add constraint "evidence_sources_pkey" PRIMARY KEY (id);
alter table only public."evidence_sources" add constraint "evidence_sources_provider_id_fkey" FOREIGN KEY (provider_id) REFERENCES provider_registry(id);
alter table only public."evidence_sources" add constraint "evidence_sources_rights_hash_check" CHECK (rights_hash ~ '^[0-9a-f]{64}$'::text);
alter table only public."evidence_sources" add constraint "evidence_sources_workspace_id_canonical_uri_key" UNIQUE (workspace_id, canonical_uri);
alter table only public."evidence_sources" add constraint "evidence_sources_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
alter table only public."evidence_sources" add constraint "evidence_sources_workspace_id_id_key" UNIQUE (workspace_id, id);
alter table only public."finding_participants" add constraint "finding_participants_permission_check" CHECK (permission = ANY (ARRAY['read'::text, 'contribute'::text]));
alter table only public."finding_participants" add constraint "finding_participants_pkey" PRIMARY KEY (workspace_id, finding_id, user_id);
alter table only public."finding_participants" add constraint "finding_participants_workspace_id_finding_id_fkey" FOREIGN KEY (workspace_id, finding_id) REFERENCES findings(workspace_id, id);
alter table only public."finding_participants" add constraint "finding_participants_workspace_id_user_id_fkey" FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members(workspace_id, user_id) ON DELETE CASCADE;
alter table only public."finding_reviews" add constraint "finding_reviews_comment_check" CHECK (length(comment) <= 5000);
alter table only public."finding_reviews" add constraint "finding_reviews_decision_check" CHECK (decision = ANY (ARRAY['approved'::text, 'changes_requested'::text]));
alter table only public."finding_reviews" add constraint "finding_reviews_pkey" PRIMARY KEY (id);
alter table only public."finding_reviews" add constraint "finding_reviews_workspace_id_finding_id_revision_fkey" FOREIGN KEY (workspace_id, finding_id, revision) REFERENCES finding_versions(workspace_id, finding_id, revision);
alter table only public."finding_reviews" add constraint "finding_reviews_workspace_id_finding_id_revision_reviewer_i_key" UNIQUE (workspace_id, finding_id, revision, reviewer_id);
alter table only public."finding_versions" add constraint "finding_versions_authored_markdown_check" CHECK (length(authored_markdown) <= 100000);
alter table only public."finding_versions" add constraint "finding_versions_pkey" PRIMARY KEY (workspace_id, finding_id, revision);
alter table only public."finding_versions" add constraint "finding_versions_workspace_id_finding_id_fkey" FOREIGN KEY (workspace_id, finding_id) REFERENCES findings(workspace_id, id);
alter table only public."findings" add constraint "findings_pkey" PRIMARY KEY (id);
alter table only public."findings" add constraint "findings_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
alter table only public."findings" add constraint "findings_workspace_id_id_key" UNIQUE (workspace_id, id);
alter table only public."findings" add constraint "findings_workspace_id_owner_id_create_key_key" UNIQUE (workspace_id, owner_id, create_key);
alter table only public."findings" add constraint "findings_workspace_id_source_run_id_fkey" FOREIGN KEY (workspace_id, source_run_id) REFERENCES query_runs(workspace_id, id);
alter table only public."graph_aliases" add constraint "graph_aliases_pkey" PRIMARY KEY (workspace_id, entity_id, alias);
alter table only public."graph_aliases" add constraint "graph_aliases_workspace_id_entity_id_fkey" FOREIGN KEY (workspace_id, entity_id) REFERENCES graph_entities(workspace_id, id);
alter table only public."graph_aliases" add constraint "graph_aliases_workspace_id_source_version_id_fkey" FOREIGN KEY (workspace_id, source_version_id) REFERENCES evidence_source_versions(workspace_id, id);
alter table only public."graph_entities" add constraint "graph_entities_confidence_check" CHECK (confidence >= 0::numeric AND confidence <= 1::numeric);
alter table only public."graph_entities" add constraint "graph_entities_pkey" PRIMARY KEY (id);
alter table only public."graph_entities" add constraint "graph_entities_review_state_check" CHECK (review_state = ANY (ARRAY['REVIEW_REQUIRED'::text, 'VERIFIED'::text, 'REJECTED'::text, 'SUPERSEDED'::text]));
alter table only public."graph_entities" add constraint "graph_entities_workspace_id_entity_type_canonical_id_key" UNIQUE (workspace_id, entity_type, canonical_id);
alter table only public."graph_entities" add constraint "graph_entities_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
alter table only public."graph_entities" add constraint "graph_entities_workspace_id_id_key" UNIQUE (workspace_id, id);
alter table only public."graph_entities" add constraint "graph_entities_workspace_id_supersedes_id_fkey" FOREIGN KEY (workspace_id, supersedes_id) REFERENCES graph_entities(workspace_id, id);
alter table only public."graph_relationships" add constraint "graph_relationships_check" CHECK (source_entity_id <> target_entity_id);
alter table only public."graph_relationships" add constraint "graph_relationships_check1" CHECK (review_state <> 'VERIFIED'::text OR reviewed_by IS NOT NULL AND confidence >= 0.98);
alter table only public."graph_relationships" add constraint "graph_relationships_confidence_check" CHECK (confidence >= 0::numeric AND confidence <= 1::numeric);
alter table only public."graph_relationships" add constraint "graph_relationships_contradiction_state_check" CHECK (contradiction_state = ANY (ARRAY['NONE'::text, 'POSSIBLE'::text, 'CONFIRMED'::text, 'RESOLVED'::text]));
alter table only public."graph_relationships" add constraint "graph_relationships_pkey" PRIMARY KEY (id);
alter table only public."graph_relationships" add constraint "graph_relationships_review_state_check" CHECK (review_state = ANY (ARRAY['REVIEW_REQUIRED'::text, 'VERIFIED'::text, 'REJECTED'::text, 'SUPERSEDED'::text]));
alter table only public."graph_relationships" add constraint "graph_relationships_workspace_id_evidence_item_id_fkey" FOREIGN KEY (workspace_id, evidence_item_id) REFERENCES evidence_items(workspace_id, id);
alter table only public."graph_relationships" add constraint "graph_relationships_workspace_id_source_entity_id_fkey" FOREIGN KEY (workspace_id, source_entity_id) REFERENCES graph_entities(workspace_id, id);
alter table only public."graph_relationships" add constraint "graph_relationships_workspace_id_target_entity_id_fkey" FOREIGN KEY (workspace_id, target_entity_id) REFERENCES graph_entities(workspace_id, id);
alter table only public."ingestion_jobs" add constraint "ingestion_jobs_document_id_fkey" FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;
alter table only public."ingestion_jobs" add constraint "ingestion_jobs_kind_check" CHECK (kind = ANY (ARRAY['ingestion'::text, 'queries'::text, 'research'::text, 'lifecycle'::text]));
alter table only public."ingestion_jobs" add constraint "ingestion_jobs_max_attempts_check" CHECK (max_attempts >= 1 AND max_attempts <= 20);
alter table only public."ingestion_jobs" add constraint "ingestion_jobs_payload_check" CHECK (octet_length(payload::text) <= 32768);
alter table only public."ingestion_jobs" add constraint "ingestion_jobs_pkey" PRIMARY KEY (id);
alter table only public."ingestion_jobs" add constraint "ingestion_jobs_progress_check" CHECK (progress >= 0 AND progress <= 100);
alter table only public."ingestion_jobs" add constraint "ingestion_jobs_status_v2" CHECK (status = ANY (ARRAY['queued'::text, 'processing'::text, 'completed'::text, 'retry_wait'::text, 'failed'::text, 'cancelled'::text]));
alter table only public."ingestion_jobs" add constraint "ingestion_jobs_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table only public."ingestion_jobs" add constraint "job_version_tenant_fk" FOREIGN KEY (workspace_id, document_id, version_id) REFERENCES document_versions(workspace_id, document_id, id) NOT VALID;
alter table only public."ingestion_jobs" add constraint "jobs_tenant_document_fk" FOREIGN KEY (workspace_id, document_id) REFERENCES documents(workspace_id, id) NOT VALID;
alter table only public."ingestion_jobs" add constraint "jobs_tenant_id_v2" UNIQUE (workspace_id, id);
alter table only public."llm_usage_events" add constraint "llm_usage_events_cost_microusd_check" CHECK (cost_microusd >= 0);
alter table only public."llm_usage_events" add constraint "llm_usage_events_pkey" PRIMARY KEY (id);
alter table only public."llm_usage_events" add constraint "llm_usage_events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table only public."llm_usage_events" add constraint "llm_usage_events_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table only public."materializations" add constraint "materializations_materialized_records_check" CHECK (materialized_records >= 0);
alter table only public."materializations" add constraint "materializations_pkey" PRIMARY KEY (id);
alter table only public."materializations" add constraint "materializations_provider_id_fkey" FOREIGN KEY (provider_id) REFERENCES provider_registry(id);
alter table only public."materializations" add constraint "materializations_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
alter table only public."materializations" add constraint "materializations_workspace_id_source_version_id_fkey" FOREIGN KEY (workspace_id, source_version_id) REFERENCES evidence_source_versions(workspace_id, id);
alter table only public."monitor_runs" add constraint "monitor_runs_materiality_check" CHECK (materiality IS NULL OR (materiality = ANY (ARRAY['NONE'::text, 'EDITORIAL'::text, 'OPERATIONAL'::text, 'RIGHTS_REVIEW'::text, 'SECURITY_REVIEW'::text])));
alter table only public."monitor_runs" add constraint "monitor_runs_pkey" PRIMARY KEY (id);
alter table only public."monitor_runs" add constraint "monitor_runs_status_check" CHECK (status = ANY (ARRAY['UNCHANGED'::text, 'CHANGED'::text, 'FAILED'::text, 'RIGHTS_BLOCKED'::text, 'QUOTA_EXHAUSTED'::text, 'REVIEW_REQUIRED'::text]));
alter table only public."monitor_runs" add constraint "monitor_runs_workspace_id_monitor_id_fkey" FOREIGN KEY (workspace_id, monitor_id) REFERENCES monitors(workspace_id, id);
alter table only public."monitors" add constraint "monitors_pkey" PRIMARY KEY (id);
alter table only public."monitors" add constraint "monitors_provider_id_fkey" FOREIGN KEY (provider_id) REFERENCES provider_registry(id);
alter table only public."monitors" add constraint "monitors_retrieval_method_check" CHECK (retrieval_method = ANY (ARRAY['STATUS_API'::text, 'CHANGELOG_FEED'::text, 'RSS_ATOM'::text, 'GIT_RELEASES'::text, 'CONDITIONAL_HTTP'::text, 'STATIC_HTML'::text, 'BROWSER'::text]));
alter table only public."monitors" add constraint "monitors_tier_check" CHECK (tier = ANY (ARRAY['CRITICAL_DAILY'::text, 'IMPORTANT_WEEKLY'::text, 'STANDARD_MONTHLY'::text, 'MANUAL_REVIEW'::text]));
alter table only public."monitors" add constraint "monitors_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
alter table only public."monitors" add constraint "monitors_workspace_id_id_key" UNIQUE (workspace_id, id);
alter table only public."profiles" add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table only public."profiles" add constraint "profiles_pkey" PRIMARY KEY (id);
alter table only public."provider_health_state" add constraint "provider_health_state_consecutive_failures_check" CHECK (consecutive_failures >= 0);
alter table only public."provider_health_state" add constraint "provider_health_state_mode_check" CHECK (mode = ANY (ARRAY['server_default_key'::text, 'workspace_byok_key'::text, 'extractive_only'::text]));
alter table only public."provider_health_state" add constraint "provider_health_state_pkey" PRIMARY KEY (workspace_id, provider, model, mode);
alter table only public."provider_health_state" add constraint "provider_health_state_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table only public."provider_registry" add constraint "provider_registry_pkey" PRIMARY KEY (id);
alter table only public."provider_registry" add constraint "provider_registry_status_check" CHECK (status = ANY (ARRAY['APPROVED'::text, 'APPROVED_WITH_DUTIES'::text, 'APPROVED_METADATA_ONLY'::text, 'RESEARCH_ONLY'::text, 'NONCOMMERCIAL_ONLY'::text, 'DEMO_ONLY'::text, 'LEGAL_REVIEW'::text, 'PRIVACY_REVIEW'::text, 'SECURITY_REVIEW'::text, 'DISABLED'::text, 'DEPRECATED'::text, 'UNKNOWN'::text]));
alter table only public."provider_registry" add constraint "provider_registry_terms_hash_check" CHECK (terms_hash IS NULL OR terms_hash ~ '^[0-9a-f]{64}$'::text);
alter table only public."provider_terms_snapshots" add constraint "provider_terms_snapshots_content_hash_check" CHECK (content_hash ~ '^[0-9a-f]{64}$'::text);
alter table only public."provider_terms_snapshots" add constraint "provider_terms_snapshots_materiality_check" CHECK (materiality = ANY (ARRAY['NONE'::text, 'EDITORIAL'::text, 'OPERATIONAL'::text, 'RIGHTS_REVIEW'::text, 'SECURITY_REVIEW'::text]));
alter table only public."provider_terms_snapshots" add constraint "provider_terms_snapshots_pkey" PRIMARY KEY (id);
alter table only public."provider_terms_snapshots" add constraint "provider_terms_snapshots_provider_id_fkey" FOREIGN KEY (provider_id) REFERENCES provider_registry(id);
alter table only public."provider_terms_snapshots" add constraint "provider_terms_snapshots_provider_id_revision_key" UNIQUE (provider_id, revision);
alter table only public."provider_terms_snapshots" add constraint "provider_terms_snapshots_retrieval_method_check" CHECK (retrieval_method = ANY (ARRAY['STATUS_API'::text, 'CHANGELOG_FEED'::text, 'RSS_ATOM'::text, 'GIT_RELEASES'::text, 'CONDITIONAL_HTTP'::text, 'STATIC_HTML'::text, 'BROWSER'::text]));
alter table only public."query_events" add constraint "query_events_payload_check" CHECK (octet_length(payload::text) <= 1000000);
alter table only public."query_events" add constraint "query_events_pkey" PRIMARY KEY (run_id, sequence);
alter table only public."query_events" add constraint "query_events_run_id_event_id_key" UNIQUE (run_id, event_id);
alter table only public."query_events" add constraint "query_events_workspace_id_run_id_fkey" FOREIGN KEY (workspace_id, run_id) REFERENCES query_runs(workspace_id, id);
alter table only public."query_run_sources" add constraint "query_run_sources_pkey" PRIMARY KEY (workspace_id, run_id, document_id);
alter table only public."query_run_sources" add constraint "query_run_sources_workspace_id_document_id_version_id_fkey" FOREIGN KEY (workspace_id, document_id, version_id) REFERENCES document_versions(workspace_id, document_id, id);
alter table only public."query_run_sources" add constraint "query_run_sources_workspace_id_run_id_fkey" FOREIGN KEY (workspace_id, run_id) REFERENCES query_runs(workspace_id, id);
alter table only public."query_runs" add constraint "query_runs_accounting_state_check" CHECK (accounting_state = ANY (ARRAY['not_started'::text, 'settled'::text, 'pending_reconciliation'::text]));
alter table only public."query_runs" add constraint "query_runs_job_id_fkey" FOREIGN KEY (job_id) REFERENCES ingestion_jobs(id);
alter table only public."query_runs" add constraint "query_runs_job_id_key" UNIQUE (job_id);
alter table only public."query_runs" add constraint "query_runs_pkey" PRIMARY KEY (id);
alter table only public."query_runs" add constraint "query_runs_request_check" CHECK (octet_length(request::text) <= 32768);
alter table only public."query_runs" add constraint "query_runs_state_check" CHECK (state = ANY (ARRAY['accepted'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'interrupted'::text]));
alter table only public."query_runs" add constraint "query_runs_workspace_id_id_key" UNIQUE (workspace_id, id);
alter table only public."query_runs" add constraint "query_runs_workspace_id_job_id_fkey" FOREIGN KEY (workspace_id, job_id) REFERENCES ingestion_jobs(workspace_id, id);
alter table only public."query_runs" add constraint "query_runs_workspace_id_reservation_id_fkey" FOREIGN KEY (workspace_id, reservation_id) REFERENCES usage_reservations(workspace_id, id);
alter table only public."query_runs" add constraint "query_runs_workspace_id_session_id_fkey" FOREIGN KEY (workspace_id, session_id) REFERENCES chat_sessions(workspace_id, id);
alter table only public."query_runs" add constraint "query_runs_workspace_id_user_id_idempotency_key_key" UNIQUE (workspace_id, user_id, idempotency_key);
alter table only public."resource_budgets" add constraint "resource_budgets_check" CHECK (scope_key = 'global'::text AND workspace_id IS NULL OR scope_key = ('workspace:'::text || workspace_id::text));
alter table only public."resource_budgets" add constraint "resource_budgets_hard_limit_check" CHECK (hard_limit >= 0);
alter table only public."resource_budgets" add constraint "resource_budgets_pkey" PRIMARY KEY (scope_key, provider_id, dimension);
alter table only public."resource_budgets" add constraint "resource_budgets_provider_id_fkey" FOREIGN KEY (provider_id) REFERENCES provider_registry(id);
alter table only public."resource_budgets" add constraint "resource_budgets_reserved_check" CHECK (reserved >= 0);
alter table only public."resource_budgets" add constraint "resource_budgets_state_check" CHECK (state = ANY (ARRAY['READY'::text, 'DEGRADED'::text, 'QUOTA_NEAR_LIMIT'::text, 'QUOTA_EXHAUSTED'::text, 'CAPACITY_REACHED'::text, 'PROVIDER_UNAVAILABLE'::text, 'PROVIDER_PAUSED'::text, 'READ_ONLY'::text, 'RIGHTS_BLOCKED'::text, 'REVIEW_REQUIRED'::text, 'TRY_AFTER_RESET'::text, 'MIGRATION_REQUIRED'::text]));
alter table only public."resource_budgets" add constraint "resource_budgets_used_check" CHECK (used >= 0);
alter table only public."resource_budgets" add constraint "resource_budgets_window_kind_check" CHECK (window_kind = ANY (ARRAY['daily'::text, 'monthly'::text, 'rolling'::text, 'capacity'::text]));
alter table only public."resource_budgets" add constraint "resource_budgets_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
alter table only public."rights_decisions" add constraint "rights_decisions_action_check" CHECK (action = ANY (ARRAY['FETCH'::text, 'STORE'::text, 'EMBED'::text, 'SEND_TO_GEMINI'::text, 'DISPLAY'::text, 'EXPORT'::text, 'REDISTRIBUTE'::text, 'SERVE_API'::text, 'SERVE_MCP'::text, 'MONITOR'::text]));
alter table only public."rights_decisions" add constraint "rights_decisions_decision_check" CHECK (decision = ANY (ARRAY['ALLOW'::text, 'ALLOW_WITH_DUTIES'::text, 'DENY'::text, 'REVIEW_REQUIRED'::text]));
alter table only public."rights_decisions" add constraint "rights_decisions_pkey" PRIMARY KEY (id);
alter table only public."rights_decisions" add constraint "rights_decisions_provider_id_fkey" FOREIGN KEY (provider_id) REFERENCES provider_registry(id);
alter table only public."rights_decisions" add constraint "rights_decisions_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
alter table only public."rights_decisions" add constraint "rights_decisions_workspace_id_request_id_key" UNIQUE (workspace_id, request_id);
alter table only public."usage_ledger" add constraint "usage_ledger_cost_microusd_check" CHECK (cost_microusd >= 0);
alter table only public."usage_ledger" add constraint "usage_ledger_input_tokens_check" CHECK (input_tokens >= 0);
alter table only public."usage_ledger" add constraint "usage_ledger_measurement_check" CHECK (measurement = ANY (ARRAY['unknown'::text, 'estimated'::text, 'provider_reported'::text]));
alter table only public."usage_ledger" add constraint "usage_ledger_output_tokens_check" CHECK (output_tokens >= 0);
alter table only public."usage_ledger" add constraint "usage_ledger_pkey" PRIMARY KEY (id);
alter table only public."usage_ledger" add constraint "usage_ledger_state_check" CHECK (state = ANY (ARRAY['not_started'::text, 'pending_reconciliation'::text, 'settled'::text]));
alter table only public."usage_ledger" add constraint "usage_ledger_workspace_id_attempt_id_key" UNIQUE (workspace_id, attempt_id);
alter table only public."usage_ledger" add constraint "usage_ledger_workspace_id_reservation_id_fkey" FOREIGN KEY (workspace_id, reservation_id) REFERENCES usage_reservations(workspace_id, id);
alter table only public."usage_reservations" add constraint "usage_reservations_pkey" PRIMARY KEY (id);
alter table only public."usage_reservations" add constraint "usage_reservations_reserved_queries_check" CHECK (reserved_queries >= 0);
alter table only public."usage_reservations" add constraint "usage_reservations_reserved_tokens_check" CHECK (reserved_tokens >= 0);
alter table only public."usage_reservations" add constraint "usage_reservations_state_check" CHECK (state = ANY (ARRAY['reserved'::text, 'settled'::text, 'pending_reconciliation'::text, 'released'::text]));
alter table only public."usage_reservations" add constraint "usage_reservations_workspace_id_actor_id_operation_id_key" UNIQUE (workspace_id, actor_id, operation_id);
alter table only public."usage_reservations" add constraint "usage_reservations_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
alter table only public."usage_reservations" add constraint "usage_reservations_workspace_id_id_key" UNIQUE (workspace_id, id);
alter table only public."workbench_mutations" add constraint "workbench_mutations_pkey" PRIMARY KEY (workspace_id, actor_id, operation, idempotency_key);
alter table only public."workbench_outbox" add constraint "workbench_outbox_aggregate_id_aggregate_version_event_type_key" UNIQUE (aggregate_id, aggregate_version, event_type);
alter table only public."workbench_outbox" add constraint "workbench_outbox_payload_check" CHECK (octet_length(payload::text) <= 8192);
alter table only public."workbench_outbox" add constraint "workbench_outbox_pkey" PRIMARY KEY (id);
alter table only public."workbench_outbox" add constraint "workbench_outbox_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
alter table only public."workspace_members" add constraint "workspace_members_pkey" PRIMARY KEY (workspace_id, user_id);
alter table only public."workspace_members" add constraint "workspace_members_role_check" CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'editor'::text, 'viewer'::text]));
alter table only public."workspace_members" add constraint "workspace_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table only public."workspace_members" add constraint "workspace_members_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table only public."workspace_policy_versions" add constraint "workspace_policy_versions_pkey" PRIMARY KEY (id);
alter table only public."workspace_policy_versions" add constraint "workspace_policy_versions_policy_check" CHECK (octet_length(policy::text) <= 16384);
alter table only public."workspace_policy_versions" add constraint "workspace_policy_versions_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
alter table only public."workspace_policy_versions" add constraint "workspace_policy_versions_workspace_id_id_key" UNIQUE (workspace_id, id);
alter table only public."workspace_policy_versions" add constraint "workspace_policy_versions_workspace_id_version_key" UNIQUE (workspace_id, version);
alter table only public."workspace_provider_policies" add constraint "workspace_provider_policies_pkey" PRIMARY KEY (workspace_id, provider_id);
alter table only public."workspace_provider_policies" add constraint "workspace_provider_policies_provider_id_fkey" FOREIGN KEY (provider_id) REFERENCES provider_registry(id);
alter table only public."workspace_provider_policies" add constraint "workspace_provider_policies_rights_hash_check" CHECK (rights_hash ~ '^[0-9a-f]{64}$'::text);
alter table only public."workspace_provider_policies" add constraint "workspace_provider_policies_status_check" CHECK (status = ANY (ARRAY['APPROVED'::text, 'APPROVED_WITH_DUTIES'::text, 'APPROVED_METADATA_ONLY'::text, 'RESEARCH_ONLY'::text, 'NONCOMMERCIAL_ONLY'::text, 'DEMO_ONLY'::text, 'LEGAL_REVIEW'::text, 'PRIVACY_REVIEW'::text, 'SECURITY_REVIEW'::text, 'DISABLED'::text, 'DEPRECATED'::text, 'UNKNOWN'::text]));
alter table only public."workspace_provider_policies" add constraint "workspace_provider_policies_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
alter table only public."workspace_settings" add constraint "settings_policy_tenant_fk" FOREIGN KEY (workspace_id, active_policy_id) REFERENCES workspace_policy_versions(workspace_id, id);
alter table only public."workspace_settings" add constraint "workspace_settings_chunk_overlap_check" CHECK (chunk_overlap >= 0 AND chunk_overlap <= 2000);
alter table only public."workspace_settings" add constraint "workspace_settings_chunk_size_check" CHECK (chunk_size >= 100 AND chunk_size <= 8000);
alter table only public."workspace_settings" add constraint "workspace_settings_context_window_messages_check" CHECK (context_window_messages >= 1 AND context_window_messages <= 50);
alter table only public."workspace_settings" add constraint "workspace_settings_hybrid_search_alpha_check" CHECK (hybrid_search_alpha >= 0::double precision AND hybrid_search_alpha <= 1::double precision);
alter table only public."workspace_settings" add constraint "workspace_settings_llm_temperature_check" CHECK (llm_temperature >= 0::double precision AND llm_temperature <= 2::double precision);
alter table only public."workspace_settings" add constraint "workspace_settings_pkey" PRIMARY KEY (workspace_id);
alter table only public."workspace_settings" add constraint "workspace_settings_retention_days_check" CHECK (retention_days >= 0 AND retention_days <= 3650);
alter table only public."workspace_settings" add constraint "workspace_settings_retrieval_top_k_check" CHECK (retrieval_top_k >= 1 AND retrieval_top_k <= 100);
alter table only public."workspace_settings" add constraint "workspace_settings_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table only public."workspace_usage_daily" add constraint "workspace_usage_daily_pkey" PRIMARY KEY (workspace_id, usage_date);
alter table only public."workspace_usage_daily" add constraint "workspace_usage_daily_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table only public."workspaces" add constraint "workspaces_lifecycle_state_check" CHECK (lifecycle_state = ANY (ARRAY['active'::text, 'deleting'::text, 'deleted'::text]));
alter table only public."workspaces" add constraint "workspaces_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES profiles(id) ON DELETE RESTRICT;
alter table only public."workspaces" add constraint "workspaces_pkey" PRIMARY KEY (id);
alter table only public."workspaces" add constraint "workspaces_slug_format" CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'::text);
alter table only public."workspaces" add constraint "workspaces_slug_key" UNIQUE (slug);

CREATE INDEX api_keys_user_id_idx ON public.api_keys USING btree (user_id);
CREATE UNIQUE INDEX api_keys_workspace_user_provider_active_idx ON public.api_keys USING btree (workspace_id, user_id, provider) WHERE (is_active = true);
CREATE UNIQUE INDEX workspace_one_active_provider_key ON public.api_keys USING btree (workspace_id, provider) WHERE is_active;
CREATE INDEX audit_events_user_created_idx ON public.audit_events USING btree (user_id, created_at DESC);
CREATE INDEX audit_events_workspace_created_idx ON public.audit_events USING btree (workspace_id, created_at DESC);
CREATE INDEX budget_reservations_provider_idx ON public.budget_reservations USING btree (provider_id);
CREATE INDEX budget_reservations_workspace_provider_idx ON public.budget_reservations USING btree (workspace_id, provider_id, dimension, state);
CREATE INDEX cache_entries_expiry_idx ON public.cache_entries USING btree (workspace_id, expires_at);
CREATE INDEX chat_messages_session_created_idx ON public.chat_messages USING btree (session_id, created_at);
CREATE INDEX chat_messages_workspace_id_idx ON public.chat_messages USING btree (workspace_id);
CREATE INDEX chat_messages_workspace_run_idx ON public.chat_messages USING btree (workspace_id, run_id);
CREATE UNIQUE INDEX message_turn_order ON public.chat_messages USING btree (workspace_id, session_id, message_order) WHERE (message_order IS NOT NULL);
CREATE UNIQUE INDEX messages_run_role ON public.chat_messages USING btree (run_id, role) WHERE (run_id IS NOT NULL);
CREATE INDEX chat_sessions_user_id_idx ON public.chat_sessions USING btree (user_id);
CREATE INDEX chat_sessions_workspace_user_idx ON public.chat_sessions USING btree (workspace_id, user_id, updated_at DESC);
CREATE INDEX conversation_participants_workspace_user_idx ON public.conversation_participants USING btree (workspace_id, user_id);
CREATE INDEX deletion_receipts_operation_idx ON public.deletion_receipts USING btree (workspace_id, operation_id);
CREATE INDEX deletion_receipts_target_idx ON public.deletion_receipts USING btree (target_id);
CREATE INDEX cleanup_keyset ON public.deletion_targets USING btree (workspace_id, operation_id, id) WHERE (verified_at IS NULL);
CREATE UNIQUE INDEX chunks_version_ordinal_v2 ON public.document_chunks USING btree (workspace_id, version_id, chunk_index) WHERE (version_id IS NOT NULL);
CREATE UNIQUE INDEX document_chunks_legacy_ordinal ON public.document_chunks USING btree (document_id, chunk_index) WHERE (version_id IS NULL);
CREATE INDEX document_chunks_metadata_gin_idx ON public.document_chunks USING gin (metadata);
CREATE INDEX document_chunks_workspace_document_idx ON public.document_chunks USING btree (workspace_id, document_id, chunk_index);
CREATE INDEX document_chunks_workspace_document_version_idx ON public.document_chunks USING btree (workspace_id, document_id, version_id);
CREATE INDEX document_chunks_workspace_embedding_hnsw ON public.document_chunks USING hnsw (embedding vector_cosine_ops) WHERE (embedding IS NOT NULL);
CREATE INDEX document_chunks_workspace_hash_idx ON public.document_chunks USING btree (workspace_id, content_hash);
CREATE INDEX document_uploads_workspace_document_idx ON public.document_uploads USING btree (workspace_id, document_id);
CREATE INDEX documents_uploaded_by_idx ON public.documents USING btree (uploaded_by);
CREATE INDEX documents_workspace_active_version_idx ON public.documents USING btree (workspace_id, id, active_version_id);
CREATE UNIQUE INDEX documents_workspace_sha_active_idx ON public.documents USING btree (workspace_id, sha256) WHERE ((sha256 IS NOT NULL) AND (status <> 'deleted'::text));
CREATE INDEX documents_workspace_status_idx ON public.documents USING btree (workspace_id, status, created_at DESC);
CREATE INDEX documents_workspace_uploaded_by_idx ON public.documents USING btree (workspace_id, uploaded_by);
CREATE INDEX eval_results_run_idx ON public.eval_results USING btree (eval_run_id, created_at);
CREATE INDEX eval_results_workspace_id_idx ON public.eval_results USING btree (workspace_id);
CREATE INDEX eval_runs_user_id_idx ON public.eval_runs USING btree (user_id);
CREATE INDEX eval_runs_workspace_created_idx ON public.eval_runs USING btree (workspace_id, created_at DESC);
CREATE INDEX exports_workspace_state_idx ON public.evidence_exports USING btree (workspace_id, state, created_at);
CREATE INDEX evidence_items_workspace_source_version_idx ON public.evidence_items USING btree (workspace_id, source_version_id);
CREATE INDEX source_versions_supersedes_idx ON public.evidence_source_versions USING btree (workspace_id, supersedes_id);
CREATE INDEX source_versions_workspace_source_idx ON public.evidence_source_versions USING btree (workspace_id, source_id, retrieved_at DESC);
CREATE INDEX evidence_sources_provider_idx ON public.evidence_sources USING btree (provider_id);
CREATE INDEX finding_participants_workspace_user_idx ON public.finding_participants USING btree (workspace_id, user_id);
CREATE INDEX findings_workspace_source_run_idx ON public.findings USING btree (workspace_id, source_run_id);
CREATE INDEX graph_aliases_source_version_idx ON public.graph_aliases USING btree (workspace_id, source_version_id);
CREATE INDEX graph_entities_supersedes_idx ON public.graph_entities USING btree (workspace_id, supersedes_id);
CREATE INDEX graph_entities_workspace_type_idx ON public.graph_entities USING btree (workspace_id, entity_type, canonical_id);
CREATE INDEX graph_relationships_evidence_idx ON public.graph_relationships USING btree (workspace_id, evidence_item_id);
CREATE INDEX graph_relationships_workspace_source_idx ON public.graph_relationships USING btree (workspace_id, source_entity_id, relationship_type);
CREATE INDEX graph_relationships_workspace_target_idx ON public.graph_relationships USING btree (workspace_id, target_entity_id, relationship_type);
CREATE INDEX ingestion_jobs_claimable_idx ON public.ingestion_jobs USING btree (available_at, created_at) WHERE (status = ANY (ARRAY['queued'::text, 'processing'::text]));
CREATE INDEX ingestion_jobs_document_id_idx ON public.ingestion_jobs USING btree (document_id);
CREATE INDEX ingestion_jobs_workspace_document_v2_idx ON public.ingestion_jobs USING btree (workspace_id, document_id);
CREATE INDEX ingestion_jobs_workspace_document_version_idx ON public.ingestion_jobs USING btree (workspace_id, document_id, version_id);
CREATE INDEX ingestion_jobs_workspace_status_idx ON public.ingestion_jobs USING btree (workspace_id, status, created_at DESC);
CREATE INDEX jobs_claim_v2 ON public.ingestion_jobs USING btree (kind, status, available_at, created_at);
CREATE INDEX llm_usage_events_user_id_idx ON public.llm_usage_events USING btree (user_id);
CREATE INDEX llm_usage_events_workspace_created_idx ON public.llm_usage_events USING btree (workspace_id, created_at DESC);
CREATE INDEX materializations_expiry_idx ON public.materializations USING btree (workspace_id, expires_at);
CREATE INDEX materializations_provider_idx ON public.materializations USING btree (provider_id);
CREATE INDEX materializations_source_version_idx ON public.materializations USING btree (workspace_id, source_version_id);
CREATE INDEX monitor_runs_workspace_monitor_idx ON public.monitor_runs USING btree (workspace_id, monitor_id, started_at DESC);
CREATE INDEX monitors_due_idx ON public.monitors USING btree (enabled, next_run_at, tier);
CREATE INDEX monitors_provider_idx ON public.monitors USING btree (provider_id);
CREATE INDEX provider_health_state_workspace_updated_idx ON public.provider_health_state USING btree (workspace_id, updated_at DESC);
CREATE INDEX provider_terms_snapshots_provider_idx ON public.provider_terms_snapshots USING btree (provider_id, checked_at DESC);
CREATE INDEX query_events_workspace_run_idx ON public.query_events USING btree (workspace_id, run_id);
CREATE UNIQUE INDEX query_one_terminal ON public.query_events USING btree (run_id) WHERE (event_type = ANY (ARRAY['run.completed'::text, 'run.failed'::text, 'run.cancelled'::text, 'run.interrupted'::text]));
CREATE INDEX query_sources_workspace_document_version_idx ON public.query_run_sources USING btree (workspace_id, document_id, version_id);
CREATE INDEX query_run_owner_keyset ON public.query_runs USING btree (workspace_id, user_id, created_at, id);
CREATE INDEX query_runs_workspace_job_idx ON public.query_runs USING btree (workspace_id, job_id);
CREATE INDEX query_runs_workspace_reservation_idx ON public.query_runs USING btree (workspace_id, reservation_id);
CREATE INDEX query_runs_workspace_session_idx ON public.query_runs USING btree (workspace_id, session_id);
CREATE INDEX budgets_workspace_provider_idx ON public.resource_budgets USING btree (workspace_id, provider_id, dimension);
CREATE INDEX resource_budgets_provider_idx ON public.resource_budgets USING btree (provider_id);
CREATE INDEX rights_decisions_provider_idx ON public.rights_decisions USING btree (provider_id);
CREATE INDEX rights_decisions_workspace_provider_idx ON public.rights_decisions USING btree (workspace_id, provider_id, decided_at DESC);
CREATE INDEX usage_ledger_workspace_reservation_idx ON public.usage_ledger USING btree (workspace_id, reservation_id);
CREATE INDEX workbench_outbox_workspace_idx ON public.workbench_outbox USING btree (workspace_id);
CREATE INDEX workspace_members_user_id_idx ON public.workspace_members USING btree (user_id);
CREATE INDEX provider_policy_workspace_idx ON public.workspace_provider_policies USING btree (workspace_id);
CREATE INDEX workspace_provider_policies_provider_idx ON public.workspace_provider_policies USING btree (provider_id);
CREATE INDEX workspace_settings_due_retention_idx ON public.workspace_settings USING btree (next_retention_at) WHERE retention_enabled;
CREATE INDEX workspace_settings_policy_idx ON public.workspace_settings USING btree (workspace_id, active_policy_id);
CREATE INDEX workspaces_owner_id_idx ON public.workspaces USING btree (owner_id);

set local check_function_bodies = off;
CREATE OR REPLACE FUNCTION nexusrag_private.can_read_conversation(p_workspace uuid, p_session uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 select exists(select 1 from public.chat_sessions s
 where s.workspace_id=p_workspace and s.id=p_session and s.deleted_at is null
 and public.is_workspace_member(s.workspace_id)
 and (s.user_id=auth.uid() or s.visibility='legacy_workspace' or exists(
 select 1 from public.conversation_participants p where p.workspace_id=s.workspace_id
 and p.session_id=s.id and p.user_id=auth.uid())));
$function$;
CREATE OR REPLACE FUNCTION nexusrag_private.can_read_document_object(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
 select
  current_setting('request.jwt.claim.role',true)='service_role'
  or exists(
   select 1
   from public.document_versions v
   join public.documents d on d.workspace_id=v.workspace_id and d.id=v.document_id
   join public.workspaces w on w.id=v.workspace_id
   join public.workspace_members m on m.workspace_id=v.workspace_id
   where v.original_bucket='documents'
    and v.original_key=p_name
    and m.user_id=(select auth.uid())
    and w.lifecycle_state='active'
    and d.lifecycle_state='active'
    and v.publication_state='ready'
  )
$function$;
CREATE OR REPLACE FUNCTION nexusrag_private.can_write_document_object(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
 select
  current_setting('request.jwt.claim.role',true)='service_role'
  or exists(
   select 1
   from public.document_uploads u
   join public.workspaces w on w.id=u.workspace_id
   join public.workspace_members m on m.workspace_id=u.workspace_id
   where u.original_bucket='documents'
    and u.original_key=p_name
    and u.actor_id=(select auth.uid())
    and m.user_id=(select auth.uid())
    and m.role in('owner','admin','editor')
    and w.lifecycle_state='active'
    and u.state='receiving'
    and u.write_token is not null
    and u.expected_bytes between 1 and 25000000
    and u.expires_at>clock_timestamp()
  )
$function$;
CREATE OR REPLACE FUNCTION nexusrag_private.enforce_document_identity_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.uploaded_by is distinct from old.uploaded_by
     or new.filename is distinct from old.filename
     or new.original_filename is distinct from old.original_filename
     or new.storage_bucket is distinct from old.storage_bucket
     or new.storage_path is distinct from old.storage_path
     or new.sha256 is distinct from old.sha256 then
    raise exception 'Document identity and storage fields are immutable.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION nexusrag_private.enforce_workspace_identity_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.owner_id is distinct from old.owner_id
     or new.plan is distinct from old.plan then
    raise exception 'Workspace identity, ownership, and plan fields are immutable.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION nexusrag_private.enforce_workspace_member_invariants()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_role text;
  workspace_owner uuid;
  target_workspace uuid;
  request_role text;
begin
  request_role := coalesce(current_setting('request.jwt.claim.role', true), '');
  if request_role = 'service_role' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  target_workspace := coalesce(new.workspace_id, old.workspace_id);
  select w.owner_id into workspace_owner
  from public.workspaces w
  where w.id = target_workspace;

  -- The parent owner_id is NOT NULL. A missing parent can therefore occur
  -- only while its foreign-key cascade is removing child membership rows.
  if tg_op = 'DELETE' and workspace_owner is null then
    return old;
  end if;

  actor_role := nexusrag_private.workspace_role(target_workspace);

  if tg_op in ('UPDATE', 'DELETE')
     and (old.user_id = workspace_owner or old.role = 'owner') then
    raise exception 'The workspace owner membership cannot be changed or removed.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT'
     and new.role = 'owner'
     and not (
       new.user_id = workspace_owner
       and (select auth.uid()) = workspace_owner
     ) then
    raise exception 'Only the workspace owner can hold the owner role.'
      using errcode = '42501';
  end if;

  if actor_role = 'owner' then
    if tg_op <> 'DELETE' and new.role = 'owner' then
      raise exception 'Owner membership must be created only for the workspace owner.'
        using errcode = '42501';
    end if;
  elsif actor_role = 'admin' then
    if (tg_op in ('UPDATE', 'DELETE') and old.role in ('owner', 'admin'))
       or (tg_op <> 'DELETE' and new.role in ('owner', 'admin')) then
      raise exception 'Administrators cannot manage owners or administrators.'
        using errcode = '42501';
    end if;
  elsif not (
    tg_op = 'INSERT'
    and new.user_id = workspace_owner
    and new.role = 'owner'
    and (select auth.uid()) = workspace_owner
  ) then
    raise exception 'Insufficient workspace member permissions.'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION nexusrag_private.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
    updated_at = now();
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION nexusrag_private.owns_workspace(target_workspace uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.workspaces w
    where w.id = target_workspace
      and w.owner_id = (select auth.uid())
  )
$function$;
CREATE OR REPLACE FUNCTION nexusrag_private.workspace_role(target_workspace uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = target_workspace
    and wm.user_id = (select auth.uid())
  limit 1
$function$;
CREATE OR REPLACE FUNCTION public.activate_workspace_key(p_workspace uuid, p_actor uuid, p_provider text, p_ciphertext text, p_label text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare key_id uuid;next_version bigint; begin perform 1 from public.workspaces where id=p_workspace and lifecycle_state='active' for update; if not found or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_actor and role in ('owner','admin')) then raise exception 'Credential access denied' using errcode='42501';end if; if p_provider<>'gemini' or length(p_ciphertext)>8192 then raise exception 'Unsupported credential';end if; select coalesce(max(credential_version),0)+1 into next_version from public.api_keys where workspace_id=p_workspace and provider=p_provider; update public.api_keys set is_active=false,revoked_at=clock_timestamp() where workspace_id=p_workspace and provider=p_provider and is_active; insert into public.api_keys(workspace_id,user_id,provider,encrypted_key,key_prefix,is_active,credential_version,encryption_key_version) values(p_workspace,p_actor,p_provider,p_ciphertext,p_label,true,next_version,'fernet-v1') returning id into key_id; update public.workspaces set capability_revision=capability_revision+1 where id=p_workspace; return key_id; end;$function$;
CREATE OR REPLACE FUNCTION public.append_chat_turn(p_workspace uuid, p_session uuid, p_actor uuid, p_question text, p_answer text, p_sources jsonb, p_metadata jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare s public.chat_sessions%rowtype; begin select * into strict s from public.chat_sessions where workspace_id=p_workspace and id=p_session for update; if s.deleted_at is not null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_actor) or not (s.user_id=p_actor or exists(select 1 from public.conversation_participants where workspace_id=p_workspace and session_id=p_session and user_id=p_actor and permission='contribute')) then raise exception 'Conversation access denied' using errcode='42501'; end if; insert into public.chat_messages(workspace_id,session_id,role,content,sources,metadata) values(p_workspace,p_session,'user',p_question,'[]','{}'),(p_workspace,p_session,'assistant',p_answer,p_sources,p_metadata); end; $function$;
CREATE OR REPLACE FUNCTION public.assert_workbench_lease(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint)
 RETURNS ingestion_jobs
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare j public.ingestion_jobs%rowtype; begin select * into strict j from public.ingestion_jobs where id=p_job and workspace_id=p_workspace for update; if j.status<>'processing' or j.lease_owner is distinct from p_owner or j.lease_generation<>p_generation or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() or j.version_id is distinct from p_version or j.lifecycle_epoch<>p_epoch or j.cancellation_requested_at is not null or not exists(select 1 from public.workspaces where id=p_workspace and lifecycle_state='active') or (j.document_id is not null and not exists(select 1 from public.documents where id=j.document_id and workspace_id=p_workspace and lifecycle_state='active' and lifecycle_epoch=p_epoch)) then raise exception 'Lease ownership or lifecycle changed' using errcode='40001'; end if; return j; end; $function$;
CREATE OR REPLACE FUNCTION public.bump_capability_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ begin update public.workspaces set capability_revision=capability_revision+1 where id=coalesce(new.workspace_id,old.workspace_id); return coalesce(new,old); end; $function$;
CREATE OR REPLACE FUNCTION public.claim_expired_document_uploads(p_limit integer DEFAULT 100)
 RETURNS TABLE(upload_id uuid, workspace_id uuid, bucket_id text, object_name text)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then
  raise exception 'NR:FORBIDDEN' using errcode='42501';
 end if;
 if p_limit not between 1 and 500 then
  raise exception 'NR:INVALID_SCOPE' using errcode='22023';
 end if;
 return query
 with candidates as(
  select u.id
  from public.document_uploads u
  where u.expires_at<=clock_timestamp()
   and u.state in('allocated','receiving','stored','failed','cancelled')
   and u.cleanup_state<>'verified'
  order by u.expires_at,u.id
  for update skip locked
  limit p_limit
 ),updated as(
  update public.document_uploads u
  set state=case when u.state in('allocated','receiving','stored') then 'cancelled' else u.state end,
      cleanup_state='pending',failed_at=coalesce(u.failed_at,clock_timestamp())
  from candidates c
  where u.id=c.id
  returning u.id,u.workspace_id,u.original_bucket,u.original_key
 )
 select id,updated.workspace_id,original_bucket,original_key from updated;
end;$function$;
CREATE OR REPLACE FUNCTION public.claim_ingestion_job(p_worker_id text, p_lease_seconds integer DEFAULT 300, p_workspace_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF ingestion_jobs
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  selected_job public.ingestion_jobs%rowtype;
begin
  if nullif(trim(p_worker_id), '') is null then
    raise exception 'worker id is required' using errcode = '22023';
  end if;

  select job.*
  into selected_job
  from public.ingestion_jobs job
  where (
      (job.status = 'queued' and job.available_at <= now())
      or (
        job.status = 'processing'
        and job.lease_expires_at is not null
        and job.lease_expires_at <= now()
      )
    )
    and job.attempts < job.max_attempts
    and (p_workspace_id is null or job.workspace_id = p_workspace_id)
  order by job.available_at asc, job.created_at asc
  for update skip locked
  limit 1;

  if selected_job.id is null then
    return;
  end if;

  return query
  update public.ingestion_jobs
  set status = 'processing',
      stage = 'claimed',
      progress = greatest(progress, 1),
      attempts = attempts + 1,
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 3600))),
      started_at = coalesce(started_at, now()),
      completed_at = null,
      error_message = null
  where id = selected_job.id
  returning *;
end;
$function$;
CREATE OR REPLACE FUNCTION public.claim_retention_schedules(p_worker_id text, p_limit integer DEFAULT 100, p_lease_seconds integer DEFAULT 900)
 RETURNS SETOF workspace_settings
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if nullif(trim(p_worker_id), '') is null then
    raise exception 'worker id is required' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select settings.workspace_id
    from public.workspace_settings settings
    where settings.retention_enabled
      and settings.retention_days > 0
      and settings.next_retention_at is not null
      and settings.next_retention_at <= now()
      and (
        settings.retention_lease_expires_at is null
        or settings.retention_lease_expires_at <= now()
      )
    order by settings.next_retention_at asc
    for update skip locked
    limit greatest(1, least(p_limit, 500))
  )
  update public.workspace_settings settings
  set retention_lease_owner = p_worker_id,
      retention_lease_expires_at =
        now() + make_interval(secs => greatest(60, least(p_lease_seconds, 3600)))
  from candidates
  where settings.workspace_id = candidates.workspace_id
  returning settings.*;
end;
$function$;
CREATE OR REPLACE FUNCTION public.claim_workbench_job(p_owner text, p_kinds text[], p_lease_seconds integer DEFAULT 300)
 RETURNS SETOF ingestion_jobs
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare candidate uuid;begin if p_lease_seconds not between 30 and 300 or length(p_owner)<1 or coalesce(cardinality(p_kinds),0)<1 then raise exception 'Invalid lease request';end if;update public.ingestion_jobs set status=case when cancellation_requested_at is null then 'failed' else 'cancelled' end,error_code='LEASE_EXHAUSTED',completed_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,lease_generation=lease_generation+1 where status='processing' and lease_expires_at<=clock_timestamp()and(attempts>=max_attempts or cancellation_requested_at is not null);select j.id into candidate from public.ingestion_jobs j join public.workspaces w on w.id=j.workspace_id left join public.documents d on d.id=j.document_id and d.workspace_id=j.workspace_id where j.kind=any(p_kinds)and(j.kind<>'ingestion' or j.version_id is not null)and w.lifecycle_state='active' and(j.document_id is null or(d.lifecycle_state='active' and d.lifecycle_epoch=j.lifecycle_epoch))and j.cancellation_requested_at is null and j.attempts<j.max_attempts and j.available_at<=clock_timestamp()and(j.status in('queued','retry_wait')or(j.status='processing' and j.lease_expires_at<=clock_timestamp()))order by j.available_at,j.created_at,j.id for update of j skip locked limit 1;if candidate is null then return;end if;return query update public.ingestion_jobs set status='processing',lease_owner=p_owner,lease_generation=lease_generation+1,attempts=attempts+1,heartbeat_at=clock_timestamp(),lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),started_at=coalesce(started_at,clock_timestamp())where id=candidate returning *;end;$function$;
CREATE OR REPLACE FUNCTION public.clear_private_session(p_workspace uuid, p_session uuid, p_actor uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare n bigint; begin perform 1 from public.chat_sessions s where s.workspace_id=p_workspace and s.id=p_session and s.user_id=p_actor and exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_actor) for update; if not found then raise exception 'Only the owner can clear this conversation' using errcode='42501'; end if; update public.chat_sessions set deleted_at=now(),title=null,revision=revision+1 where workspace_id=p_workspace and id=p_session; delete from public.chat_messages where workspace_id=p_workspace and session_id=p_session; get diagnostics n=row_count; return n; end; $function$;
CREATE OR REPLACE FUNCTION public.clear_terminal_ingestion_job_lease()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.status in ('completed', 'failed') then
    new.lease_owner := null;
    new.lease_expires_at := null;
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.evaluate_provider_rights(p_workspace uuid, p_provider text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$declare pr public.provider_registry%rowtype;wp public.workspace_provider_policies%rowtype;decision text;duties text[]='{}';reason text;begin if p_action not in('FETCH','STORE','EMBED','SEND_TO_GEMINI','DISPLAY','EXPORT','REDISTRIBUTE','SERVE_API','SERVE_MCP','MONITOR')then raise exception 'NR:INVALID_SCOPE';end if;select * into pr from public.provider_registry where id=p_provider;if not found or pr.status in('UNKNOWN','DISABLED','DEPRECATED')then return jsonb_build_object('decision','DENY','state','RIGHTS_BLOCKED','reason_code','PROVIDER_NOT_APPROVED');end if;select * into wp from public.workspace_provider_policies where workspace_id=p_workspace and provider_id=p_provider;if not found or wp.status in('UNKNOWN','DISABLED','DEPRECATED')then return jsonb_build_object('decision','DENY','state','RIGHTS_BLOCKED','reason_code','WORKSPACE_POLICY_NOT_APPROVED');end if;if p_action=any(wp.prohibited_actions)then decision='DENY';reason='ACTION_PROHIBITED';elsif p_action=any(wp.review_actions)or wp.status in('LEGAL_REVIEW','PRIVACY_REVIEW','SECURITY_REVIEW')then decision='REVIEW_REQUIRED';reason='HUMAN_REVIEW_REQUIRED';elsif not p_action=any(wp.allowed_actions)then decision='DENY';reason='ACTION_NOT_ALLOWLISTED';elsif wp.status='APPROVED_WITH_DUTIES' or cardinality(wp.duties)>0 then decision='ALLOW_WITH_DUTIES';reason='DUTIES_REQUIRED';duties=wp.duties;elsif wp.status in('APPROVED','APPROVED_METADATA_ONLY','RESEARCH_ONLY','NONCOMMERCIAL_ONLY','DEMO_ONLY')then decision='ALLOW';reason='APPROVED';else decision='DENY';reason='STATUS_FAIL_CLOSED';end if;return jsonb_build_object('decision',decision,'state',case when decision='DENY' then 'RIGHTS_BLOCKED' when decision='REVIEW_REQUIRED' then 'REVIEW_REQUIRED' else 'READY' end,'reason_code',reason,'duties',duties,'provider_revision',pr.revision,'workspace_policy_version',wp.policy_version,'rights_hash',wp.rights_hash);end;$function$;
CREATE OR REPLACE FUNCTION public.finish_workbench_job(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint, p_success boolean, p_retryable boolean, p_error_code text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare j public.ingestion_jobs%rowtype;next_status text; begin j=public.assert_workbench_lease(p_job,p_workspace,p_owner,p_generation,p_version,p_epoch); next_status=case when p_success then 'completed' when p_retryable and j.attempts<j.max_attempts then 'retry_wait' else 'failed' end; update public.ingestion_jobs set status=next_status,error_code=left(p_error_code,64),available_at=clock_timestamp()+make_interval(secs=>least(300,5*power(2,least(j.attempts,6))::int)),lease_owner=null,lease_expires_at=null,completed_at=case when next_status='retry_wait' then null else clock_timestamp() end where id=p_job; return next_status; end; $function$;
CREATE OR REPLACE FUNCTION public.has_workspace_role(target_workspace uuid, allowed_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(nexusrag_private.workspace_role(target_workspace) = any(allowed_roles), false)
$function$;
CREATE OR REPLACE FUNCTION public.is_workspace_member(target_workspace uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select nexusrag_private.workspace_role(target_workspace) is not null
$function$;
CREATE OR REPLACE FUNCTION public.match_document_chunks(query_embedding vector, match_workspace_id uuid, match_count integer DEFAULT 10, match_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(id uuid, workspace_id uuid, document_id uuid, chunk_id text, content text, content_hash text, page_number integer, chunk_index integer, filename text, metadata jsonb, score double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  select
    dc.id,
    dc.workspace_id,
    dc.document_id,
    coalesce(dc.metadata->>'chunk_id', dc.qdrant_point_id, dc.id::text) as chunk_id,
    dc.content,
    dc.content_hash,
    dc.page_number,
    dc.chunk_index,
    coalesce(dc.metadata->>'filename', d.filename) as filename,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) as score
  from public.document_chunks dc
  left join public.documents d
    on d.id = dc.document_id
   and d.workspace_id = dc.workspace_id
  where dc.workspace_id = match_workspace_id
    and dc.embedding is not null
    and (
      not (match_filters ? 'document_id')
      or dc.document_id = (match_filters->>'document_id')::uuid
    )
    and (
      not (match_filters ? 'document_ids')
      or dc.document_id::text in (
        select value from jsonb_array_elements_text(match_filters->'document_ids') as value
      )
    )
    and (
      not (match_filters ? 'filename')
      or d.filename = match_filters->>'filename'
      or dc.metadata->>'filename' = match_filters->>'filename'
    )
    and (
      not (match_filters ? 'file_types')
      or lower(coalesce(dc.metadata->>'file_type', '')) in (
        select lower(value) from jsonb_array_elements_text(match_filters->'file_types') as value
      )
    )
    and (
      not (match_filters ? 'uploaded_by')
      or d.uploaded_by::text = match_filters->>'uploaded_by'
      or dc.metadata->>'uploaded_by' = match_filters->>'uploaded_by'
    )
    and (
      not (match_filters ? 'uploaded_after_epoch')
      or extract(epoch from d.created_at)::bigint >= (match_filters->>'uploaded_after_epoch')::bigint
    )
    and (
      not (match_filters ? 'uploaded_before_epoch')
      or extract(epoch from d.created_at)::bigint <= (match_filters->>'uploaded_before_epoch')::bigint
    )
    and (
      not (match_filters ? 'metadata')
      or dc.metadata @> (match_filters->'metadata')
    )
    and (
      not (match_filters ? 'min_page')
      or coalesce(dc.page_number, 0) >= (match_filters->>'min_page')::int
    )
    and (
      not (match_filters ? 'max_page')
      or coalesce(dc.page_number, 0) <= (match_filters->>'max_page')::int
    )
  order by dc.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 10), 100));
$function$;
CREATE OR REPLACE FUNCTION public.owns_workspace(target_workspace uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select nexusrag_private.owns_workspace(target_workspace)
$function$;
CREATE OR REPLACE FUNCTION public.reconcile_workspace_usage(p_workspace_id uuid, p_usage_date date DEFAULT NULL::date)
 RETURNS SETOF workspace_usage_daily
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  target_date date := coalesce(p_usage_date, current_date);
begin
  insert into public.workspace_usage_daily (
    workspace_id,
    usage_date,
    query_count,
    input_tokens,
    output_tokens,
    total_tokens,
    successful_calls,
    failed_calls,
    estimated_cost_microusd,
    reconciled_at
  )
  select
    p_workspace_id,
    target_date,
    count(*),
    coalesce(sum(input_tokens), 0),
    coalesce(sum(output_tokens), 0),
    coalesce(sum(input_tokens), 0) + coalesce(sum(output_tokens), 0),
    count(*) filter (where success),
    count(*) filter (where not success),
    coalesce(sum(cost_microusd), 0),
    now()
  from public.llm_usage_events
  where workspace_id = p_workspace_id
    and created_at >= target_date::timestamptz
    and created_at < (target_date + 1)::timestamptz
  on conflict (workspace_id, usage_date) do update set
    query_count = excluded.query_count,
    input_tokens = excluded.input_tokens,
    output_tokens = excluded.output_tokens,
    total_tokens = excluded.total_tokens,
    successful_calls = excluded.successful_calls,
    failed_calls = excluded.failed_calls,
    estimated_cost_microusd = excluded.estimated_cost_microusd,
    reconciled_at = excluded.reconciled_at;

  return query
  select *
  from public.workspace_usage_daily
  where workspace_id = p_workspace_id
    and usage_date = target_date;
end;
$function$;
CREATE OR REPLACE FUNCTION public.record_rights_decision(p_workspace uuid, p_provider text, p_action text, p_actor uuid, p_request text)
 RETURNS rights_decisions
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare result jsonb;row public.rights_decisions%rowtype;begin select * into row from public.rights_decisions where workspace_id=p_workspace and request_id=p_request;if found then if row.provider_id<>p_provider or row.action<>p_action then raise exception 'NR:VERSION_CONFLICT';end if;return row;end if;result=public.evaluate_provider_rights(p_workspace,p_provider,p_action);insert into public.rights_decisions(workspace_id,provider_id,action,decision,provider_revision,workspace_policy_version,rights_hash,duties,reason_code,actor_id,request_id)values(p_workspace,p_provider,p_action,result->>'decision',coalesce((result->>'provider_revision')::bigint,0),(result->>'workspace_policy_version')::bigint,coalesce(result->>'rights_hash',repeat('0',64)),coalesce(array(select jsonb_array_elements_text(result->'duties')),'{}'),result->>'reason_code',p_actor,p_request)returning * into row;return row;end;$function$;
CREATE OR REPLACE FUNCTION public.release_metered_capacity(p_workspace uuid, p_reservation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare r public.budget_reservations%rowtype;begin select * into strict r from public.budget_reservations where workspace_id=p_workspace and id=p_reservation for update;if r.state='RELEASED'then return jsonb_build_object('state','READY','reused',true);end if;if r.state<>'RESERVED'then raise exception 'NR:VERSION_CONFLICT';end if;update public.resource_budgets set reserved=reserved-r.amount,revision=revision+1,updated_at=clock_timestamp()where(scope_key='global' or scope_key='workspace:'||p_workspace::text)and provider_id=r.provider_id and dimension=r.dimension and reserved>=r.amount;if not found then raise exception 'NR:PERSISTENCE_UNAVAILABLE';end if;update public.budget_reservations set state='RELEASED',measured=0,settled_at=clock_timestamp()where id=r.id;return jsonb_build_object('state','READY','reused',false);end;$function$;
CREATE OR REPLACE FUNCTION public.renew_workbench_job(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$ begin perform public.assert_workbench_lease(p_job,p_workspace,p_owner,p_generation,p_version,p_epoch); update public.ingestion_jobs set heartbeat_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '300 seconds' where id=p_job; return true; end; $function$;
CREATE OR REPLACE FUNCTION public.requeue_ingestion_job(p_job_id uuid, p_worker_id text, p_error_message text, p_retry_seconds integer DEFAULT 30)
 RETURNS SETOF ingestion_jobs
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  return query
  update public.ingestion_jobs
  set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
      stage = case when attempts >= max_attempts then 'failed' else 'retry_scheduled' end,
      progress = case when attempts >= max_attempts then 100 else 0 end,
      error_message = left(coalesce(p_error_message, 'Worker processing failed.'), 2000),
      last_error_at = now(),
      available_at = now() + make_interval(secs => greatest(1, least(p_retry_seconds, 86400))),
      lease_owner = null,
      lease_expires_at = null,
      completed_at = case when attempts >= max_attempts then now() else null end
  where id = p_job_id
    and status = 'processing'
    and lease_owner = p_worker_id
  returning *;
end;
$function$;
CREATE OR REPLACE FUNCTION public.reserve_metered_capacity(p_workspace uuid, p_provider text, p_dimension text, p_amount bigint, p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare g public.resource_budgets%rowtype;w public.resource_budgets%rowtype;r public.budget_reservations%rowtype;ratio numeric;state text='READY';begin if p_amount<=0 or length(p_key)not between 1 and 128 then raise exception 'NR:INVALID_SCOPE';end if;select * into r from public.budget_reservations where workspace_id=p_workspace and idempotency_key=p_key;if found then if r.provider_id<>p_provider or r.dimension<>p_dimension or r.amount<>p_amount then raise exception 'NR:VERSION_CONFLICT';end if;return jsonb_build_object('reservation_id',r.id,'state',r.state,'reset_at',r.reset_at,'reused',true);end if;select * into strict g from public.resource_budgets where scope_key='global' and provider_id=p_provider and dimension=p_dimension for update;select * into strict w from public.resource_budgets where scope_key='workspace:'||p_workspace::text and workspace_id=p_workspace and provider_id=p_provider and dimension=p_dimension for update;if g.state not in('READY','QUOTA_NEAR_LIMIT','DEGRADED')or w.state not in('READY','QUOTA_NEAR_LIMIT','DEGRADED')then return jsonb_build_object('state',case when g.state<>'READY' then g.state else w.state end,'reset_at',least(g.reset_at,w.reset_at));end if;if g.used+g.reserved+p_amount>g.hard_limit or w.used+w.reserved+p_amount>w.hard_limit then return jsonb_build_object('state','QUOTA_EXHAUSTED','reset_at',least(g.reset_at,w.reset_at));end if;update public.resource_budgets set reserved=reserved+p_amount,revision=revision+1,updated_at=clock_timestamp()where(scope_key='global' or scope_key='workspace:'||p_workspace::text)and provider_id=p_provider and dimension=p_dimension;ratio=greatest((g.used+g.reserved+p_amount)::numeric/nullif(g.hard_limit,0),(w.used+w.reserved+p_amount)::numeric/nullif(w.hard_limit,0));if ratio>=.95 then state='DEGRADED';elsif ratio>=.85 then state='QUOTA_NEAR_LIMIT';end if;insert into public.budget_reservations(workspace_id,provider_id,dimension,amount,idempotency_key,reset_at)values(p_workspace,p_provider,p_dimension,p_amount,p_key,least(g.reset_at,w.reset_at))returning * into r;return jsonb_build_object('reservation_id',r.id,'state',state,'reset_at',r.reset_at,'reused',false);exception when no_data_found then return jsonb_build_object('state','MIGRATION_REQUIRED','reason_code','BUDGET_NOT_CONFIGURED');end;$function$;
CREATE OR REPLACE FUNCTION public.reserve_query_capacity(p_workspace uuid, p_actor uuid, p_operation uuid, p_tokens bigint, p_query_limit bigint, p_token_limit bigint)
 RETURNS usage_reservations
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare existing public.usage_reservations%rowtype;queries bigint;tokens bigint;legacy_queries bigint;legacy_tokens bigint;period date=(now() at time zone 'UTC')::date; begin perform 1 from public.workspaces where id=p_workspace and lifecycle_state='active' for update; if not found or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_actor) then raise exception 'Workspace access denied' using errcode='42501';end if; select * into existing from public.usage_reservations where workspace_id=p_workspace and actor_id=p_actor and operation_id=p_operation; if found then if existing.reserved_tokens<>p_tokens then raise exception 'Reservation identity conflict' using errcode='40001';end if; return existing; end if; if p_tokens<=0 then raise exception 'Invalid reservation';end if; select coalesce(sum(reserved_queries),0),coalesce(sum(reserved_tokens),0) into queries,tokens from public.usage_reservations where workspace_id=p_workspace and charge_period=period and state<>'released'; select count(*),coalesce(sum(input_tokens+output_tokens),0) into legacy_queries,legacy_tokens from public.llm_usage_events where workspace_id=p_workspace and created_at>=period::timestamptz; if (p_query_limit is not null and queries+legacy_queries+1>p_query_limit) or (p_token_limit is not null and tokens+legacy_tokens+p_tokens>p_token_limit) then raise exception 'Tenant quota exceeded' using errcode='P0001';end if; insert into public.usage_reservations(workspace_id,actor_id,operation_id,reserved_queries,reserved_tokens,state,expires_at) values(p_workspace,p_actor,p_operation,1,p_tokens,'reserved',clock_timestamp()+interval '15 minutes') returning * into existing; return existing; end;$function$;
CREATE OR REPLACE FUNCTION public.revoke_workspace_key(p_workspace uuid, p_actor uuid, p_provider text)
 RETURNS SETOF api_keys
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$ begin perform 1 from public.workspaces where id=p_workspace for update; if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_actor and role in ('owner','admin')) then raise exception 'Credential access denied' using errcode='42501';end if; update public.workspaces set capability_revision=capability_revision+1 where id=p_workspace; return query update public.api_keys set is_active=false,revoked_at=clock_timestamp() where workspace_id=p_workspace and provider=p_provider and is_active returning *; end;$function$;
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.settle_metered_capacity(p_workspace uuid, p_reservation uuid, p_measured bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare r public.budget_reservations%rowtype;begin select * into strict r from public.budget_reservations where workspace_id=p_workspace and id=p_reservation for update;if r.state='SETTLED'then return jsonb_build_object('state','READY','measured',r.measured,'reused',true);end if;if r.state<>'RESERVED' or p_measured<0 or p_measured>r.amount then update public.budget_reservations set state='RECONCILIATION_REQUIRED' where id=r.id;return jsonb_build_object('state','REVIEW_REQUIRED','reason_code','MEASUREMENT_EXCEEDS_RESERVATION');end if;update public.resource_budgets set reserved=reserved-r.amount,used=used+p_measured,revision=revision+1,updated_at=clock_timestamp()where(scope_key='global' or scope_key='workspace:'||p_workspace::text)and provider_id=r.provider_id and dimension=r.dimension and reserved>=r.amount;if not found then raise exception 'NR:PERSISTENCE_UNAVAILABLE';end if;update public.budget_reservations set state='SETTLED',measured=p_measured,settled_at=clock_timestamp()where id=r.id;return jsonb_build_object('state','READY','measured',p_measured,'reused',false);end;$function$;
CREATE OR REPLACE FUNCTION public.tombstone_document(p_workspace uuid, p_document uuid, p_actor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare operation uuid;epoch bigint; begin if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_actor and role in ('owner','admin','editor')) then raise exception 'Document mutation denied' using errcode='42501';end if; perform 1 from public.documents where workspace_id=p_workspace and id=p_document and lifecycle_state='active' for update; if not found then raise exception 'Document unavailable or deletion already begun' using errcode='40001';end if; update public.documents set lifecycle_state='deleting',lifecycle_epoch=lifecycle_epoch+1,revision=revision+1 where workspace_id=p_workspace and id=p_document returning lifecycle_epoch into epoch; update public.ingestion_jobs set cancellation_requested_at=clock_timestamp(),lease_generation=lease_generation+1 where workspace_id=p_workspace and document_id=p_document and status in ('processing','queued','retry_wait'); insert into public.deletion_operations(workspace_id,resource_id,tombstone_epoch) values(p_workspace,p_document,epoch) returning id into operation; insert into public.deletion_targets(workspace_id,operation_id,kind,resource_id,bucket,object_key) select p_workspace,operation,'original',id,original_bucket,original_key from public.document_versions where workspace_id=p_workspace and document_id=p_document; insert into public.deletion_targets(workspace_id,operation_id,kind,resource_id,inventory) select p_workspace,operation,'version_index',id,jsonb_build_object('index_generation',index_generation,'embedding_space_id',embedding_space_id) from public.document_versions where workspace_id=p_workspace and document_id=p_document; insert into public.deletion_targets(workspace_id,operation_id,kind,resource_id) values(p_workspace,operation,'chunks',p_document),(p_workspace,operation,'derived_content_review',p_document),(p_workspace,operation,'outstanding_remote_writes',p_document); insert into public.workbench_outbox(workspace_id,aggregate_id,aggregate_version,event_type) values(p_workspace,p_document,epoch,'document.tombstoned'); return operation; end;$function$;
CREATE OR REPLACE FUNCTION public.update_workspace_policy(p_workspace uuid, p_values jsonb, p_expected_version bigint)
 RETURNS SETOF workspace_settings
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare s public.workspace_settings%rowtype; next_id uuid; payload jsonb; begin select * into strict s from public.workspace_settings where workspace_id=p_workspace for update; if s.policy_version<>p_expected_version then raise exception 'Policy version conflict' using errcode='40001'; end if; if exists(select 1 from jsonb_object_keys(p_values) k where k not in ('llm_temperature','retrieval_top_k','enable_reranking','enable_contextual_enrichment','context_window_messages','enable_semantic_chunking')) then raise exception 'Unsupported policy field' using errcode='22023'; end if; payload=(to_jsonb(s)||p_values)-'active_policy_id'; insert into public.workspace_policy_versions(workspace_id,version,policy) values(p_workspace,s.policy_version+1,payload) returning id into next_id; return query update public.workspace_settings set llm_temperature=coalesce((p_values->>'llm_temperature')::float,llm_temperature),retrieval_top_k=coalesce((p_values->>'retrieval_top_k')::int,retrieval_top_k),enable_reranking=coalesce((p_values->>'enable_reranking')::boolean,enable_reranking),enable_contextual_enrichment=coalesce((p_values->>'enable_contextual_enrichment')::boolean,enable_contextual_enrichment),context_window_messages=coalesce((p_values->>'context_window_messages')::int,context_window_messages),enable_semantic_chunking=coalesce((p_values->>'enable_semantic_chunking')::boolean,enable_semantic_chunking),active_policy_id=next_id,policy_version=policy_version+1 where workspace_id=p_workspace returning *; end; $function$;
CREATE OR REPLACE FUNCTION public.uuid_or_null(value text)
 RETURNS uuid
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  return value::uuid;
exception when others then
  return null;
end;
$function$;
CREATE OR REPLACE FUNCTION public.workbench_abort_upload(p_context jsonb, p_upload uuid, p_write_token uuid, p_may_have_object boolean)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare u public.document_uploads%rowtype;begin perform public.workbench_authorize(p_context,'document.mutate');select * into strict u from public.document_uploads where workspace_id=(p_context->>'workspace_id')::uuid and actor_id=(p_context->>'user_id')::uuid and id=p_upload for update;if u.state<>'receiving' or u.write_token is distinct from p_write_token then raise exception 'NR:VERSION_CONFLICT';end if;update public.document_uploads set state='failed',failed_at=clock_timestamp(),cleanup_state=case when p_may_have_object then 'pending' else 'verified' end,cleanup_verified_at=case when not p_may_have_object then clock_timestamp()end where id=u.id;if not p_may_have_object and not u.replacement then update public.documents set lifecycle_state='deleted',revision=revision+1 where workspace_id=u.workspace_id and id=u.document_id and active_version_id is null and not exists(select 1 from public.document_versions where workspace_id=u.workspace_id and document_id=u.document_id);end if;end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_admit_run(p_context jsonb, p_request jsonb, p_key text, p_hash text, p_tokens bigint, p_query_limit bigint, p_token_limit bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare r public.query_runs%rowtype;ws uuid=(p_context->>'workspace_id')::uuid;actor uuid=(p_context->>'user_id')::uuid;sid uuid;rid uuid=gen_random_uuid();jid uuid;reservation public.usage_reservations%rowtype;source_ids uuid[];expected integer;begin perform 1 from public.workspaces where id=ws for update;perform public.workbench_authorize(p_context,'query');select * into r from public.query_runs where workspace_id=ws and user_id=actor and idempotency_key=p_key;if found then if r.payload_hash<>p_hash then raise exception 'NR:VERSION_CONFLICT' using errcode='40001';end if;if not public.workbench_session_access(ws,r.session_id,actor,'read')then raise exception 'NR:FORBIDDEN';end if;return jsonb_build_object('run_id',r.id,'session_id',r.session_id,'state',r.state,'reused',true);end if;if length(p_key)not between 1 and 128 or p_request->>'mode' not in('ask','compare','extract','summarize')then raise exception 'NR:INVALID_SCOPE';end if;if p_request->'scope'->>'kind'='documents' then select array_agg(value::uuid)into source_ids from jsonb_array_elements_text(p_request->'scope'->'document_ids');if coalesce(cardinality(source_ids),0)=0 then raise exception 'NR:INVALID_SCOPE';end if;else if p_request->'scope'->>'kind'<>'workspace' then raise exception 'NR:INVALID_SCOPE';end if;select array_agg(id)into source_ids from public.documents where workspace_id=ws and lifecycle_state='active' and active_version_id is not null;end if;if coalesce(cardinality(source_ids),0)=0 or cardinality(source_ids)>100 then raise exception 'NR:INVALID_SCOPE';end if;select count(*)into expected from public.documents d join public.document_versions v on v.id=d.active_version_id and v.workspace_id=d.workspace_id and v.document_id=d.id where d.workspace_id=ws and d.id=any(source_ids)and d.lifecycle_state='active' and v.publication_state='ready';if expected<>cardinality(source_ids)then raise exception 'NR:INVALID_SCOPE';end if;sid=(p_request->>'session_id')::uuid;if sid is null then insert into public.chat_sessions(workspace_id,user_id,title,visibility)values(ws,actor,left(p_request->>'question',160),'private')returning id into sid;else perform 1 from public.chat_sessions where id=sid and workspace_id=ws for update;if not public.workbench_session_access(ws,sid,actor,'append')then raise exception 'NR:FORBIDDEN';end if;end if;reservation=public.reserve_query_capacity(ws,actor,rid,p_tokens,p_query_limit,p_token_limit);insert into public.ingestion_jobs(workspace_id,kind,payload,max_attempts)values(ws,'queries',jsonb_build_object('run_id',rid),1)returning id into jid;insert into public.query_runs(id,workspace_id,user_id,session_id,job_id,reservation_id,idempotency_key,payload_hash,request,context,deadline)values(rid,ws,actor,sid,jid,reservation.id,p_key,p_hash,p_request,p_context,(p_context->>'deadline')::timestamptz)returning * into r;insert into public.query_run_sources(workspace_id,run_id,document_id,version_id,lifecycle_epoch)select ws,rid,id,active_version_id,lifecycle_epoch from public.documents where workspace_id=ws and id=any(source_ids);perform public.workbench_emit(rid,'run.accepted',jsonb_build_object('stage','accepted'));return jsonb_build_object('run_id',r.id,'session_id',r.session_id,'state',r.state,'reused',false);end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_append_event(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint, p_event uuid, p_type text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare r public.query_runs%rowtype;begin perform public.assert_workbench_lease(p_job,p_workspace,p_owner,p_generation,p_version,p_epoch);select * into strict r from public.query_runs where workspace_id=p_workspace and job_id=p_job for update;perform public.workbench_run_access(r.context,r.id,'append');if r.state<>'running' or r.cancellation_requested_at is not null then raise exception 'NR:CANCELLED';end if;if p_type not in('stage.changed','evidence.selected','answer.delta')then raise exception 'NR:INVALID_SCOPE';end if;return public.workbench_emit(r.id,p_type,p_payload,p_event);end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_authorize(p_context jsonb, p_operation text DEFAULT 'read'::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare w public.workspaces%rowtype;member_role text;settings_row public.workspace_settings%rowtype; begin select * into strict w from public.workspaces where id=(p_context->>'workspace_id')::uuid; if w.lifecycle_state<>'active' then raise exception 'NR:WORKSPACE_UNAVAILABLE' using errcode='42501';end if; select role into member_role from public.workspace_members where workspace_id=w.id and user_id=(p_context->>'user_id')::uuid; if member_role is null then raise exception 'NR:FORBIDDEN' using errcode='42501';end if; if w.capability_revision<>(p_context->>'membership_revision')::bigint then raise exception 'NR:VERSION_CONFLICT' using errcode='40001';end if; if (p_context->>'deadline')::timestamptz<=clock_timestamp() then raise exception 'NR:AUTH_REQUIRED' using errcode='42501';end if; select * into strict settings_row from public.workspace_settings where workspace_id=w.id; if settings_row.active_policy_id is distinct from (p_context->>'policy_id')::uuid or settings_row.policy_version<>(p_context->>'policy_version')::bigint then raise exception 'NR:VERSION_CONFLICT' using errcode='40001';end if; if p_operation='document.mutate' and member_role not in ('editor','admin','owner') then raise exception 'NR:FORBIDDEN' using errcode='42501';end if; if p_operation in ('settings.manage','credentials.manage','members.manage') and member_role not in ('admin','owner') then raise exception 'NR:FORBIDDEN' using errcode='42501';end if; if p_operation not in ('read','query','document.mutate','settings.manage','credentials.manage','members.manage') then raise exception 'NR:FORBIDDEN' using errcode='42501';end if; end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_begin_upload(p_context jsonb, p_command jsonb, p_key text, p_hash text, p_bucket text, p_max_documents bigint, p_max_storage_bytes bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare u public.document_uploads%rowtype;d public.documents%rowtype;ws uuid=(p_context->>'workspace_id')::uuid;actor uuid=(p_context->>'user_id')::uuid;did uuid;vid uuid=gen_random_uuid();reserved bigint;doc_count bigint; begin perform 1 from public.workspaces where id=ws for update; perform public.workbench_authorize(p_context,'document.mutate'); select * into u from public.document_uploads where workspace_id=ws and actor_id=actor and begin_key=p_key; if found then if u.begin_hash<>p_hash then raise exception 'NR:VERSION_CONFLICT' using errcode='40001';end if;return to_jsonb(u);end if; if length(p_key) not between 1 and 128 or p_bucket='' then raise exception 'NR:INVALID_SCOPE' using errcode='22023';end if; select count(*) into doc_count from public.documents where workspace_id=ws and lifecycle_state<>'deleted'; select coalesce(sum(original_bytes),0) into reserved from public.document_versions where workspace_id=ws; select reserved+coalesce(sum(expected_bytes),0) into reserved from public.document_uploads where workspace_id=ws and(state in('allocated','receiving','stored')or(state in('failed','cancelled')and cleanup_state='pending')); if reserved+(p_command->>'byte_size')::bigint>p_max_storage_bytes then raise exception 'NR:TENANT_QUOTA_EXCEEDED';end if; if p_command->>'replacement_document_id' is not null then did=(p_command->>'replacement_document_id')::uuid;select * into strict d from public.documents where workspace_id=ws and id=did and lifecycle_state='active' for update; if exists(select 1 from public.document_uploads where workspace_id=ws and document_id=did and state in('allocated','receiving','stored'))or exists(select 1 from public.ingestion_jobs where workspace_id=ws and document_id=did and status in('queued','processing','retry_wait'))then raise exception 'NR:VERSION_CONFLICT' using errcode='40001';end if; else if doc_count+1>p_max_documents then raise exception 'NR:TENANT_QUOTA_EXCEEDED';end if;did=gen_random_uuid();insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,content_type,status)values(did,ws,actor,p_command->>'filename',p_command->>'filename',p_command->>'content_type','queued')returning * into d;end if; insert into public.document_uploads(workspace_id,actor_id,document_id,version_id,replacement,lifecycle_epoch,filename,content_type,expected_bytes,original_bucket,original_key,begin_key,begin_hash)values(ws,actor,did,vid,p_command->>'replacement_document_id' is not null,d.lifecycle_epoch,p_command->>'filename',p_command->>'content_type',(p_command->>'byte_size')::bigint,p_bucket,ws::text||'/'||did::text||'/'||vid::text||'/original',p_key,p_hash)returning * into u; return to_jsonb(u);end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_cancel_run(p_context jsonb, p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare r public.query_runs%rowtype;begin select * into strict r from public.query_runs where workspace_id=(p_context->>'workspace_id')::uuid and id=p_run;perform 1 from public.ingestion_jobs where id=r.job_id for update;r=public.workbench_run_authorize(p_context,p_run,'read');if r.user_id<>(p_context->>'user_id')::uuid and not exists(select 1 from public.chat_sessions where id=r.session_id and user_id=(p_context->>'user_id')::uuid)then raise exception 'NR:FORBIDDEN';end if;update public.query_runs set cancellation_requested_at=clock_timestamp()where id=r.id;update public.ingestion_jobs set cancellation_requested_at=clock_timestamp()where id=r.job_id;return public.workbench_terminalize(r.id,'cancelled','CANCELLED','Cancellation requested. Committed provider charges cannot be reversed.');end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_claim_upload(p_context jsonb, p_upload uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare u public.document_uploads%rowtype;begin perform public.workbench_authorize(p_context,'document.mutate');select * into strict u from public.document_uploads where workspace_id=(p_context->>'workspace_id')::uuid and id=p_upload and actor_id=(p_context->>'user_id')::uuid for update;if u.state<>'allocated' or u.expires_at<=clock_timestamp()then raise exception 'NR:VERSION_CONFLICT' using errcode='40001';end if;update public.document_uploads set state='receiving',write_token=gen_random_uuid()where id=u.id returning * into u;return to_jsonb(u);end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_complete_upload(p_context jsonb, p_upload uuid, p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare u public.document_uploads%rowtype;jid uuid;begin perform public.workbench_authorize(p_context,'document.mutate');select * into strict u from public.document_uploads where workspace_id=(p_context->>'workspace_id')::uuid and id=p_upload and actor_id=(p_context->>'user_id')::uuid for update;if u.state='completed' then if u.complete_key<>p_key then raise exception 'NR:VERSION_CONFLICT' using errcode='40001';end if;return jsonb_build_object('upload_id',u.id,'document_id',u.document_id,'version_id',u.version_id,'job_id',u.job_id,'state',(select status from public.ingestion_jobs where id=u.job_id));end if;if u.state<>'stored' or u.original_verified_at is null or u.expires_at<=clock_timestamp()then raise exception 'NR:VERSION_CONFLICT' using errcode='40001';end if;perform 1 from public.documents where workspace_id=u.workspace_id and id=u.document_id and lifecycle_state='active' and lifecycle_epoch=u.lifecycle_epoch for update;if not found then raise exception 'NR:WORKSPACE_UNAVAILABLE';end if;insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,original_verified_at,parser_version,chunker_version,lifecycle_epoch)values(u.version_id,u.workspace_id,u.document_id,u.original_bucket,u.original_key,u.original_hash,u.original_bytes,u.original_verified_at,'workbench-fidelity-v1','utf8-bound-v1',u.lifecycle_epoch);insert into public.ingestion_jobs(workspace_id,document_id,version_id,lifecycle_epoch,kind,payload)values(u.workspace_id,u.document_id,u.version_id,u.lifecycle_epoch,'ingestion',jsonb_build_object('actor_id',u.actor_id,'filename',u.filename))returning id into jid;update public.document_uploads set state='completed',complete_key=p_key,job_id=jid where id=u.id;return jsonb_build_object('upload_id',u.id,'document_id',u.document_id,'version_id',u.version_id,'job_id',jid,'state','queued');end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_conversation(p_context jsonb, p_operation text, p_id uuid, p_title text, p_revision bigint, p_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare ws uuid=(p_context->>'workspace_id')::uuid;actor uuid=(p_context->>'user_id')::uuid;s public.chat_sessions%rowtype;m public.workbench_mutations%rowtype;h text;r record;begin perform public.workbench_authorize(p_context,'read');if p_operation='create' then if length(p_key)not between 1 and 128 or p_key is null or length(trim(p_title))not between 1 and 160 then raise exception 'NR:INVALID_SCOPE';end if;perform 1 from public.workspaces where id=ws for update;h=encode(sha256(convert_to(p_title,'UTF8')),'hex');select * into m from public.workbench_mutations where workspace_id=ws and actor_id=actor and operation='conversation.create' and idempotency_key=p_key;if found then if m.payload_hash<>h then raise exception 'NR:VERSION_CONFLICT';end if;if not public.workbench_session_access(ws,(m.response->>'id')::uuid,actor,'read')then raise exception 'NR:FORBIDDEN';end if;return m.response;end if;insert into public.chat_sessions(workspace_id,user_id,title,visibility)values(ws,actor,p_title,'private')returning * into s;insert into public.workbench_mutations values(ws,actor,'conversation.create',p_key,h,to_jsonb(s),clock_timestamp());return to_jsonb(s);end if;if not public.workbench_session_access(ws,p_id,actor,'read')then raise exception 'NR:FORBIDDEN';end if;if p_operation='delete' then for r in select job_id from public.query_runs where workspace_id=ws and session_id=p_id and state in('accepted','running')order by job_id loop perform 1 from public.ingestion_jobs where id=r.job_id for update;end loop;end if;select * into strict s from public.chat_sessions where workspace_id=ws and id=p_id and deleted_at is null for update;if s.user_id is distinct from actor then raise exception 'NR:FORBIDDEN';end if;if p_operation='rename' then if s.revision is distinct from p_revision then raise exception 'NR:VERSION_CONFLICT';end if;if length(trim(p_title))not between 1 and 160 then raise exception 'NR:INVALID_SCOPE';end if;update public.chat_sessions set title=p_title,revision=revision+1 where id=p_id returning * into s;elsif p_operation='delete' then for r in select id from public.query_runs where workspace_id=ws and session_id=p_id and state in('accepted','running')loop perform public.workbench_terminalize(r.id,'cancelled','CANCELLED','Conversation deleted by its owner.');end loop;delete from public.chat_messages where workspace_id=ws and session_id=p_id;update public.query_events set payload='{}',redacted_at=clock_timestamp()where workspace_id=ws and run_id in(select id from public.query_runs where workspace_id=ws and session_id=p_id);update public.query_runs set request=jsonb_set(request,'{question}','"[deleted]"'::jsonb),final_answer=null where workspace_id=ws and session_id=p_id;update public.chat_sessions set title=null,deleted_at=clock_timestamp(),revision=revision+1 where id=p_id returning * into s;else raise exception 'NR:INVALID_SCOPE';end if;return to_jsonb(s);end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_emit(p_run uuid, p_type text, p_payload jsonb, p_event uuid DEFAULT gen_random_uuid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare r public.query_runs%rowtype;e public.query_events%rowtype;h text;begin select * into strict r from public.query_runs where id=p_run for update;h=encode(sha256(convert_to(jsonb_build_object('type',p_type,'payload',p_payload)::text,'UTF8')),'hex');select * into e from public.query_events where run_id=p_run and event_id=p_event;if found then if e.event_hash<>h then raise exception 'NR:VERSION_CONFLICT';end if;else if exists(select 1 from public.query_events where run_id=p_run and event_type in('run.completed','run.failed','run.cancelled','run.interrupted'))then raise exception 'NR:VERSION_CONFLICT';end if;insert into public.query_events(workspace_id,run_id,sequence,event_id,event_hash,event_type,attempt_id,payload)values(r.workspace_id,r.id,r.next_sequence,p_event,h,p_type,r.attempt_id,p_payload)returning * into e;update public.query_runs set next_sequence=next_sequence+1 where id=r.id;end if;return jsonb_build_object('protocol_version',2,'run_id',e.run_id,'session_id',r.session_id,'attempt_id',e.attempt_id,'sequence',e.sequence,'type',e.event_type,'occurred_at',e.occurred_at,'payload',e.payload);end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_evidence(p_context jsonb, p_run uuid, p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare result jsonb;begin perform public.workbench_run_access(p_context,p_run,'read');if cardinality(p_ids)>100 then raise exception 'NR:RESOURCE_LIMIT_EXCEEDED';end if;select coalesce(jsonb_agg(jsonb_build_object('workspace_id',c.workspace_id,'document_id',c.document_id,'version_id',c.version_id,'chunk_id',c.id,'original_text',c.original_text,'original_content_hash',c.original_content_hash,'location',c.location,'extraction',c.metadata->'extraction')order by array_position(p_ids,c.id)),'[]')into result from public.document_chunks c join public.query_run_sources s on s.workspace_id=c.workspace_id and s.document_id=c.document_id and s.version_id=c.version_id where s.run_id=p_run and c.id=any(p_ids);return result;end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_fail_run(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint, p_code text, p_state text, p_message text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare r public.query_runs%rowtype;begin perform public.assert_workbench_lease(p_job,p_workspace,p_owner,p_generation,p_version,p_epoch);select * into strict r from public.query_runs where workspace_id=p_workspace and job_id=p_job for update;return public.workbench_terminalize(r.id,p_state,p_code,p_message);end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_finding(p_context jsonb, p_operation text, p_id uuid, p_command jsonb, p_revision bigint, p_key text, p_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare ws uuid=(p_context->>'workspace_id')::uuid;actor uuid=(p_context->>'user_id')::uuid;f public.findings%rowtype;v public.finding_versions%rowtype;r public.query_runs%rowtype;permission text;result jsonb;quotes jsonb;unavailable boolean;target uuid;begin perform public.workbench_authorize(p_context,'read');if p_operation='create' then perform 1 from public.workspaces where id=ws for update;select * into f from public.findings where workspace_id=ws and owner_id=actor and create_key=p_key;if found then if f.payload_hash<>p_hash or f.deleted_at is not null then raise exception 'NR:VERSION_CONFLICT';end if;return to_jsonb(f);end if;if p_command->>'run_id' is not null then r=public.workbench_run_access(p_context,(p_command->>'run_id')::uuid,'read');if r.state<>'completed' then raise exception 'NR:VERSION_CONFLICT';end if;end if;insert into public.findings(workspace_id,owner_id,title,source_run_id,create_key,payload_hash)values(ws,actor,p_command->>'title',r.id,p_key,p_hash)returning * into f;insert into public.finding_versions(workspace_id,finding_id,revision,author_id,title,authored_markdown,generated_markdown)values(ws,f.id,1,actor,f.title,coalesce(p_command->>'authored_markdown',''),r.final_answer->>'markdown');return to_jsonb(f);end if;select * into strict f from public.findings where workspace_id=ws and id=p_id and deleted_at is null for update;select * into strict v from public.finding_versions where workspace_id=ws and finding_id=p_id and revision=f.revision;permission=case when f.owner_id=actor then 'owner' else(select p.permission from public.finding_participants p where workspace_id=ws and finding_id=p_id and user_id=actor)end;if permission is null then raise exception 'NR:FORBIDDEN';end if;if p_operation in('share','unshare','delete')and permission<>'owner' then raise exception 'NR:FORBIDDEN';end if;if p_operation in('edit','review')and permission not in('owner','contribute')then raise exception 'NR:FORBIDDEN';end if;if p_operation in('edit','review')and f.revision is distinct from p_revision then raise exception 'NR:VERSION_CONFLICT';end if;if p_operation='edit' then insert into public.finding_versions(workspace_id,finding_id,revision,author_id,title,authored_markdown,generated_markdown)values(ws,p_id,f.revision+1,actor,p_command->>'title',p_command->>'authored_markdown',v.generated_markdown);update public.findings set revision=revision+1,title=p_command->>'title',updated_at=clock_timestamp()where id=p_id returning * into f;return to_jsonb(f);elsif p_operation='review' then if v.author_id=actor then raise exception 'NR:FORBIDDEN';end if;insert into public.finding_reviews(workspace_id,finding_id,revision,reviewer_id,decision,comment)values(ws,p_id,f.revision,actor,p_command->>'decision',coalesce(p_command->>'comment',''))on conflict(workspace_id,finding_id,revision,reviewer_id)do update set decision=excluded.decision,comment=excluded.comment,created_at=clock_timestamp();elsif p_operation in('share','unshare')then target=(p_command->>'user_id')::uuid;if target=actor or not exists(select 1 from public.workspace_members where workspace_id=ws and user_id=target)then raise exception 'NR:INVALID_SCOPE';end if;if p_operation='unshare' then delete from public.finding_participants where workspace_id=ws and finding_id=p_id and user_id=target;else insert into public.finding_participants values(ws,p_id,target,p_command->>'permission')on conflict(workspace_id,finding_id,user_id)do update set permission=excluded.permission;end if;elsif p_operation='delete' then update public.findings set deleted_at=clock_timestamp(),title='[deleted]' where id=p_id;update public.finding_versions set authored_markdown='',generated_markdown=null,title='[deleted]',redacted_at=clock_timestamp()where workspace_id=ws and finding_id=p_id;delete from public.finding_reviews where workspace_id=ws and finding_id=p_id;return jsonb_build_object('id',p_id,'state','deleted');elsif p_operation not in('read','versions')then raise exception 'NR:INVALID_SCOPE';end if;select * into r from public.query_runs where workspace_id=ws and id=f.source_run_id;unavailable=f.source_run_id is not null and not public.workbench_sources_available(f.source_run_id);select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'document_id',c.document_id,'version_id',c.version_id,'original_text',case when not unavailable then c.original_text end,'location',case when not unavailable then c.location end,'available',not unavailable,'freshness',case when unavailable then 'unavailable' when d.active_version_id<>c.version_id then 'stale' else 'current' end)),'[]')into quotes from public.document_chunks c join public.documents d on d.workspace_id=c.workspace_id and d.id=c.document_id where c.workspace_id=ws and c.id in(select(value->>'id')::uuid from jsonb_array_elements(coalesce(r.final_answer->'citations','[]')));select coalesce(jsonb_agg(to_jsonb(rv)order by created_at),'[]')into result from public.finding_reviews rv where workspace_id=ws and finding_id=p_id and revision=f.revision;return to_jsonb(f)||jsonb_build_object('permission',permission,'authored_markdown',v.authored_markdown,'generated_markdown',case when unavailable then null else v.generated_markdown end,'source_unavailable',unavailable,'evidence',quotes,'reviews',result,'participants',case when permission='owner' then(select coalesce(jsonb_agg(to_jsonb(p)),'[]')from public.finding_participants p where workspace_id=ws and finding_id=p_id)else '[]'::jsonb end);end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_finish_run(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint, p_answer jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare r public.query_runs%rowtype;accounting text;cit jsonb;usage jsonb;begin perform public.assert_workbench_lease(p_job,p_workspace,p_owner,p_generation,p_version,p_epoch);select * into strict r from public.query_runs where workspace_id=p_workspace and job_id=p_job for update;perform public.workbench_run_access(r.context,r.id,'append');if r.state<>'running' or r.cancellation_requested_at is not null then raise exception 'NR:CANCELLED';end if;if octet_length(p_answer::text)>1000000 or length(p_answer->>'markdown')>262144 then raise exception 'NR:RESOURCE_LIMIT_EXCEEDED';end if;for cit in select value from jsonb_array_elements(p_answer->'citations')loop if not exists(select 1 from public.document_chunks c join public.query_run_sources s on s.workspace_id=c.workspace_id and s.version_id=c.version_id where s.run_id=r.id and c.id=(cit->>'id')::uuid and c.original_content_hash=cit->'evidence'->>'original_content_hash')then raise exception 'NR:INVALID_SCOPE';end if;end loop;select case when count(*)=0 then 'not_started' when bool_and(state='settled')then 'settled' else 'pending_reconciliation' end,jsonb_build_object('input_tokens',case when count(input_tokens)=count(*)and count(*)>0 then sum(input_tokens)end,'output_tokens',case when count(output_tokens)=count(*)and count(*)>0 then sum(output_tokens)end,'cost_microusd',case when count(cost_microusd)=count(*)and count(*)>0 then sum(cost_microusd)end)into accounting,usage from public.usage_ledger where reservation_id=r.reservation_id;insert into public.chat_messages(workspace_id,session_id,role,content,run_id,sources,metadata,message_order)values(p_workspace,r.session_id,'user',r.request->>'question',r.id,'[]','{}',r.turn_order*2),(p_workspace,r.session_id,'assistant',p_answer->>'markdown',r.id,p_answer->'citations',jsonb_build_object('answerability',p_answer->>'answerability','support_method',p_answer->>'support_method'),r.turn_order*2+1);update public.query_runs set final_answer=p_answer,accounting_state=accounting,persistence_state='committed',state='completed',completed_at=clock_timestamp()where id=r.id;update public.usage_reservations set state=case when accounting='not_started' then 'settled' else accounting end,reserved_tokens=case when accounting='not_started' then 0 else reserved_tokens end where id=r.reservation_id;perform public.workbench_emit(r.id,'answer.final',p_answer);if accounting<>'not_started' then perform public.workbench_emit(r.id,'usage.updated',usage||jsonb_build_object('accounting',accounting));end if;perform public.workbench_emit(r.id,'run.completed',jsonb_build_object('code','OK','message','Answer and accounting state committed.','accounting',accounting));update public.ingestion_jobs set status='completed',progress=100,completed_at=clock_timestamp(),lease_owner=null,lease_expires_at=null where id=p_job;return jsonb_build_object('run_id',r.id,'state','completed');end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_initialize_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$declare pointer uuid;begin if new.active_policy_id is null then insert into public.workspace_policy_versions(workspace_id,version,policy)values(new.workspace_id,new.policy_version,(to_jsonb(new)-'active_policy_id')||jsonb_build_object('allow_external_provider',false))on conflict(workspace_id,version)do nothing;select id into strict pointer from public.workspace_policy_versions where workspace_id=new.workspace_id and version=new.policy_version;new.active_policy_id=pointer;end if;return new;end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_job_action(p_context jsonb, p_job uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare j public.ingestion_jobs%rowtype;v public.document_versions%rowtype;begin perform public.workbench_authorize(p_context,'document.mutate');select * into strict j from public.ingestion_jobs where workspace_id=(p_context->>'workspace_id')::uuid and id=p_job for update;if j.kind<>'ingestion' or j.version_id is null then raise exception 'NR:INVALID_SCOPE';end if;select * into strict v from public.document_versions where workspace_id=j.workspace_id and id=j.version_id for update;if not exists(select 1 from public.documents where workspace_id=j.workspace_id and id=j.document_id and lifecycle_state='active' and lifecycle_epoch=j.lifecycle_epoch)then raise exception 'NR:INVALID_SCOPE';end if;if p_action='retry' then if j.status not in('failed','cancelled')or v.publication_state='ready' then raise exception 'NR:VERSION_CONFLICT';end if;update public.ingestion_jobs set status='queued',attempts=0,available_at=clock_timestamp(),lease_generation=lease_generation+1,lease_owner=null,lease_expires_at=null,cancellation_requested_at=null,completed_at=null,error_code=null,progress=0,stage='queued' where id=p_job;update public.document_versions set publication_state='staged',failure_code=null where id=v.id;elsif p_action='cancel' then if j.status='completed' then raise exception 'NR:VERSION_CONFLICT';end if;update public.ingestion_jobs set status='cancelled',cancellation_requested_at=clock_timestamp(),lease_generation=lease_generation+1,lease_owner=null,lease_expires_at=null,completed_at=clock_timestamp(),error_code='CANCELLED' where id=p_job;update public.document_versions set publication_state='cancelled',failure_code='CANCELLED' where id=v.id and publication_state<>'ready';else raise exception 'NR:INVALID_SCOPE';end if;select * into j from public.ingestion_jobs where id=p_job;return to_jsonb(j)-'payload'-'lease_owner';end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_message_projection(p_message chat_messages, p_for_run uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$declare available boolean;begin available=p_message.run_id is not null and public.workbench_sources_available(p_message.run_id);if p_for_run is not null and available then available=not exists(select 1 from public.query_run_sources old where old.run_id=p_message.run_id and not exists(select 1 from public.query_run_sources current where current.run_id=p_for_run and current.workspace_id=old.workspace_id and current.document_id=old.document_id and current.version_id=old.version_id and current.lifecycle_epoch=old.lifecycle_epoch));end if;return jsonb_build_object('id',p_message.id,'run_id',p_message.run_id,'role',p_message.role,'created_at',p_message.created_at,'message_order',p_message.message_order,'available',coalesce(available,false),'content',case when available then p_message.content else '[Source-dependent or unverified legacy content withheld.]' end,'sources',case when available then p_message.sources else '[]'::jsonb end,'metadata',case when available then jsonb_build_object('answerability',p_message.metadata->>'answerability','support_method',p_message.metadata->>'support_method')else '{}'::jsonb end);end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_publish_version(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint, p_receipt jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare j public.ingestion_jobs%rowtype;v public.document_versions%rowtype;total bigint;begin j=public.assert_workbench_lease(p_job,p_workspace,p_owner,p_generation,p_version,p_epoch);select * into strict v from public.document_versions where workspace_id=p_workspace and id=p_version for update;select count(*)into total from public.document_chunks where workspace_id=p_workspace and version_id=p_version;if v.staged_by_generation<>p_generation or v.publication_state<>'processing' or v.staged_manifest_hash is distinct from p_receipt->>'manifest_hash' or total=0 or total<>(v.extraction_manifest->>'expected_chunks')::bigint or total<>(p_receipt->>'verified_vectors')::bigint or p_receipt->>'index_generation' is distinct from v.index_generation or coalesce((p_receipt->>'hashes_valid')::boolean,false)is not true then raise exception 'NR:INGESTION_FAILED';end if;update public.document_versions set publication_state='ready',published_at=clock_timestamp()where workspace_id=p_workspace and id=p_version;update public.documents set active_version_id=p_version,status='ready',chunk_count=total,file_size_bytes=v.original_bytes,storage_bucket=v.original_bucket,storage_path=v.original_key,sha256=v.original_hash,revision=revision+1,error_message=null where workspace_id=p_workspace and id=j.document_id and lifecycle_state='active' and lifecycle_epoch=p_epoch;if not found then raise exception 'NR:VERSION_CONFLICT';end if;insert into public.workbench_outbox(workspace_id,aggregate_id,aggregate_version,event_type,payload)select p_workspace,id,revision,'document.published',jsonb_build_object('version_id',p_version)from public.documents where id=j.document_id;update public.ingestion_jobs set status='completed',progress=100,stage='published',completed_at=clock_timestamp(),lease_owner=null,lease_expires_at=null where id=p_job;return jsonb_build_object('document_id',j.document_id,'version_id',p_version,'state','ready','chunks',total);end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_read(p_context jsonb, p_resource text, p_id uuid DEFAULT NULL::uuid, p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_latest boolean DEFAULT false, p_search text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare ws uuid=(p_context->>'workspace_id')::uuid;actor uuid=(p_context->>'user_id')::uuid;items jsonb;tail uuid;q text;r public.query_runs%rowtype;begin perform public.workbench_authorize(p_context,'read');if p_limit not between 1 and 100 or length(p_search)>200 then raise exception 'NR:INVALID_SCOPE';end if;if p_resource='runs' and p_id is not null then r=public.workbench_run_authorize(p_context,p_id,'read');if public.workbench_sources_available(r.id)then items=to_jsonb(r)-'context';else items=(to_jsonb(r)-'context'-'final_answer')||jsonb_build_object('source_unavailable',true,'request',jsonb_set(r.request,'{question}','"[Source unavailable]"'::jsonb));end if;return jsonb_build_object('items',jsonb_build_array(items),'next_after',null);end if;if p_resource='documents' then q='select (to_jsonb(d)-''storage_path''-''storage_bucket'')||jsonb_build_object(''availability'',case when d.lifecycle_state=''active'' and d.active_version_id is not null then ''available'' else ''unavailable'' end,''job'',(select to_jsonb(j)-''payload''-''lease_owner'' from public.ingestion_jobs j where j.workspace_id=d.workspace_id and j.document_id=d.id and j.kind=''ingestion'' order by j.created_at desc,j.id desc limit 1)) as item,d.id from public.documents d where workspace_id=$1 and lifecycle_state<>''deleted'' and ($3 is null or id=$3) and ($4 is null or id>$4) and ($7='''' or strpos(lower(filename),lower($7))>0) order by id limit $5+1';elsif p_resource='uploads' then q='select to_jsonb(u) as item,u.id from public.document_uploads u where workspace_id=$1 and actor_id=$2 and ($3 is null or id=$3) and ($4 is null or id>$4) order by id limit $5+1';elsif p_resource='jobs' then q='select to_jsonb(j)-''payload''-''lease_owner'' as item,j.id from public.ingestion_jobs j where workspace_id=$1 and id=$3 and (kind=''ingestion'' or exists(select 1 from public.query_runs r where r.job_id=j.id and public.workbench_session_access($1,r.session_id,$2,''read'')))';elsif p_resource='versions' then if not exists(select 1 from public.documents where workspace_id=ws and id=p_id and lifecycle_state='active')then raise exception 'NR:INVALID_SCOPE';end if;q='select (to_jsonb(v)-''original_bucket''-''original_key''-''extraction_manifest'')||jsonb_build_object(''extraction_manifest'',extraction_manifest-''datasets'') as item,v.id from public.document_versions v where workspace_id=$1 and document_id=$3 and ($4 is null or id>$4) order by id limit $5+1';elsif p_resource='chunks' then if not exists(select 1 from public.document_versions v join public.documents d on d.workspace_id=v.workspace_id and d.id=v.document_id where v.workspace_id=ws and v.id=p_id and d.lifecycle_state='active' and v.publication_state='ready')then raise exception 'NR:INVALID_SCOPE';end if;q='select jsonb_build_object(''id'',id,''workspace_id'',workspace_id,''document_id'',document_id,''version_id'',version_id,''original_text'',original_text,''original_content_hash'',original_content_hash,''location'',location,''extraction'',metadata->''extraction'') as item,id from public.document_chunks where workspace_id=$1 and version_id=$3 and ($4 is null or id>$4) order by id limit $5+1';elsif p_resource='conversations' then q='select to_jsonb(s) as item,s.id from public.chat_sessions s where workspace_id=$1 and public.workbench_session_access($1,id,$2,''read'') and ($3 is null or id=$3) and ($4 is null or id>$4) order by id limit $5+1';elsif p_resource='messages' then if not public.workbench_session_access(ws,p_id,actor,'read')then raise exception 'NR:FORBIDDEN';end if;if p_latest then select coalesce(jsonb_agg(public.workbench_message_projection(t::public.chat_messages)order by coalesce(message_order,0),created_at,id),'[]')into items from(select * from public.chat_messages m where workspace_id=ws and session_id=p_id and(p_after is null or(coalesce(m.message_order,0),m.created_at,m.id)<(select coalesce(message_order,0),created_at,id from public.chat_messages where workspace_id=ws and session_id=p_id and id=p_after))order by coalesce(message_order,0)desc,created_at desc,id desc limit p_limit+1)t;if jsonb_array_length(items)>p_limit then items=items-0;tail=(items->0->>'id')::uuid;end if;else select coalesce(jsonb_agg(public.workbench_message_projection(t::public.chat_messages)order by coalesce(message_order,0),created_at,id),'[]')into items from(select * from public.chat_messages m where workspace_id=ws and session_id=p_id and(p_after is null or(coalesce(m.message_order,0),m.created_at,m.id)>(select coalesce(message_order,0),created_at,id from public.chat_messages where workspace_id=ws and session_id=p_id and id=p_after))order by coalesce(message_order,0),created_at,id limit p_limit+1)t;if jsonb_array_length(items)>p_limit then items=items-p_limit;tail=(items->(p_limit-1)->>'id')::uuid;end if;end if;return jsonb_build_object('items',items,'next_after',tail);elsif p_resource='runs' then q='select jsonb_build_object(''id'',id,''session_id'',session_id,''state'',state,''created_at'',created_at,''accounting_state'',accounting_state) as item,id from public.query_runs where workspace_id=$1 and public.workbench_session_access($1,session_id,$2,''read'') and ($4 is null or id>$4) order by id limit $5+1';elsif p_resource='findings' then q='select to_jsonb(f) as item,f.id from public.findings f where workspace_id=$1 and deleted_at is null and (owner_id=$2 or exists(select 1 from public.finding_participants where workspace_id=$1 and finding_id=f.id and user_id=$2)) and ($4 is null or id>$4) order by id limit $5+1';else raise exception 'NR:INVALID_SCOPE';end if;execute 'select coalesce(jsonb_agg(item order by id),''[]'') from ('||q||') t' into items using ws,actor,p_id,p_after,p_limit,p_latest,p_search;if jsonb_array_length(items)>p_limit then items=items-p_limit;tail=(items->(p_limit-1)->>'id')::uuid;end if;return jsonb_build_object('items',items,'next_after',tail);end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_record_upload(p_context jsonb, p_upload uuid, p_receipt jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare u public.document_uploads%rowtype;begin perform public.workbench_authorize(p_context,'document.mutate');select * into strict u from public.document_uploads where workspace_id=(p_context->>'workspace_id')::uuid and id=p_upload and actor_id=(p_context->>'user_id')::uuid for update;if u.state<>'receiving' or u.write_token is distinct from(p_receipt->>'write_token')::uuid or u.expected_bytes<>(p_receipt->>'original_bytes')::bigint or u.expires_at<=clock_timestamp()or p_receipt->>'original_hash'!~'^[0-9a-f]{64}$' then raise exception 'NR:VERSION_CONFLICT' using errcode='40001';end if;if not exists(select 1 from public.documents where workspace_id=u.workspace_id and id=u.document_id and lifecycle_state='active' and lifecycle_epoch=u.lifecycle_epoch)then raise exception 'NR:WORKSPACE_UNAVAILABLE';end if;update public.document_uploads set state='stored',original_hash=p_receipt->>'original_hash',original_bytes=(p_receipt->>'original_bytes')::bigint,original_verified_at=clock_timestamp()where id=u.id;end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_recover_uploads()
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare affected bigint;begin update public.document_uploads set failed_at=clock_timestamp(),cleanup_state=case when state='allocated' then 'verified' else 'pending' end,cleanup_verified_at=case when state='allocated' then clock_timestamp()end,state='failed' where expires_at<=clock_timestamp()and state in('allocated','receiving','stored');get diagnostics affected=row_count;update public.documents d set lifecycle_state='deleted',revision=revision+1 where d.active_version_id is null and d.lifecycle_state='active' and not exists(select 1 from public.document_versions v where v.workspace_id=d.workspace_id and v.document_id=d.id)and exists(select 1 from public.document_uploads u where u.workspace_id=d.workspace_id and u.document_id=d.id and u.state='failed' and u.cleanup_state='verified')and not exists(select 1 from public.document_uploads u where u.workspace_id=d.workspace_id and u.document_id=d.id and(u.state in('allocated','receiving','stored')or u.cleanup_state='pending'));return affected;end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_run_access(p_context jsonb, p_run uuid, p_operation text DEFAULT 'read'::text)
 RETURNS query_runs
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare r public.query_runs%rowtype;begin r=public.workbench_run_authorize(p_context,p_run,p_operation);if not public.workbench_sources_available(p_run)then raise exception 'NR:INVALID_SCOPE';end if;return r;end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_run_authorize(p_context jsonb, p_run uuid, p_operation text DEFAULT 'read'::text)
 RETURNS query_runs
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare r public.query_runs%rowtype;begin perform public.workbench_authorize(p_context,'read');select * into strict r from public.query_runs where workspace_id=(p_context->>'workspace_id')::uuid and id=p_run;if not public.workbench_session_access(r.workspace_id,r.session_id,(p_context->>'user_id')::uuid,p_operation)then raise exception 'NR:FORBIDDEN';end if;return r;end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_run_events(p_context jsonb, p_run uuid, p_after bigint, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare r public.query_runs%rowtype;events jsonb;available boolean;begin r=public.workbench_run_authorize(p_context,p_run,'read');available=public.workbench_sources_available(p_run);update public.query_runs set last_observed_at=clock_timestamp()where id=p_run and user_id=(p_context->>'user_id')::uuid;if p_after<0 or p_limit not between 1 and 100 then raise exception 'NR:INVALID_SCOPE';end if;select coalesce(jsonb_agg(jsonb_build_object('protocol_version',2,'run_id',e.run_id,'session_id',r.session_id,'attempt_id',e.attempt_id,'sequence',e.sequence,'type',e.event_type,'occurred_at',e.occurred_at,'payload',case when available then e.payload when e.event_type='answer.delta' then jsonb_build_object('text','')when e.event_type='evidence.selected' then jsonb_build_object('evidence','[]'::jsonb)when e.event_type='answer.final' then jsonb_build_object('markdown','Source unavailable; answer withheld.','answerability','insufficient','support_method','unverified','citations','[]'::jsonb,'claims','[]'::jsonb,'coverage','[]'::jsonb,'structured',null)else e.payload end)order by e.sequence),'[]')into events from(select * from public.query_events where run_id=p_run and sequence>p_after order by sequence limit p_limit)e;return jsonb_build_object('events',events,'state',r.state,'last_sequence',r.next_sequence-1,'source_unavailable',not available);end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_schedule()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare item record;n int=0;begin perform public.workbench_recover_uploads();for item in select r.id,r.job_id from public.query_runs r join public.ingestion_jobs j on j.id=r.job_id join public.workspaces w on w.id=r.workspace_id where r.state in('accepted','running')and(r.deadline<=clock_timestamp()or r.last_observed_at<clock_timestamp()-interval '15 seconds' or j.status in('failed','cancelled')or(j.status='processing' and j.lease_expires_at<=clock_timestamp())or w.lifecycle_state<>'active' or w.capability_revision<>(r.context->>'membership_revision')::bigint or not public.workbench_sources_available(r.id))order by r.created_at limit 100 loop perform 1 from public.ingestion_jobs where id=item.job_id for update skip locked;if found then perform 1 from public.query_runs where id=item.id for update;if exists(select 1 from public.query_runs r join public.ingestion_jobs j on j.id=r.job_id join public.workspaces w on w.id=r.workspace_id where r.id=item.id and r.state in('accepted','running')and(r.deadline<=clock_timestamp()or r.last_observed_at<clock_timestamp()-interval '15 seconds' or j.status in('failed','cancelled')or(j.status='processing' and j.lease_expires_at<=clock_timestamp())or w.lifecycle_state<>'active' or w.capability_revision<>(r.context->>'membership_revision')::bigint or not public.workbench_sources_available(r.id)))then perform public.workbench_terminalize(item.id,'interrupted','CANCELLED','Lease, observation grace or authorization expired; explicit retry required.');n=n+1;end if;end if;end loop;update public.ingestion_jobs set status='failed',error_code='LEASE_EXHAUSTED',completed_at=clock_timestamp(),lease_generation=lease_generation+1,lease_owner=null,lease_expires_at=null where kind='ingestion' and status='processing' and lease_expires_at<=clock_timestamp()and attempts>=max_attempts;update public.document_versions v set publication_state=case when j.status='cancelled' then 'cancelled' else 'failed' end,failure_code=j.error_code from public.ingestion_jobs j where j.workspace_id=v.workspace_id and j.version_id=v.id and j.status in('failed','cancelled')and v.publication_state not in('ready','failed','cancelled');return jsonb_build_object('recovered_runs',n,'retention','No new automatic deletion policy introduced');end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_session_access(p_workspace uuid, p_session uuid, p_actor uuid, p_operation text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$select exists(select 1 from public.chat_sessions s join public.workspace_members m on m.workspace_id=s.workspace_id and m.user_id=p_actor where s.workspace_id=p_workspace and s.id=p_session and s.deleted_at is null and(s.user_id=p_actor or(p_operation='read' and s.visibility='legacy_workspace')or(p_operation in('read','append')and exists(select 1 from public.conversation_participants p where p.workspace_id=s.workspace_id and p.session_id=s.id and p.user_id=p_actor and(p_operation='read' or p.permission='contribute')))));$function$;
CREATE OR REPLACE FUNCTION public.workbench_settings(p_context jsonb, p_values jsonb DEFAULT NULL::jsonb, p_revision bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare s public.workspace_settings%rowtype;policy jsonb;next_id uuid;ws uuid=(p_context->>'workspace_id')::uuid;begin perform public.workbench_authorize(p_context,case when p_values is null then 'read' else 'settings.manage' end);select * into strict s from public.workspace_settings where workspace_id=ws for update;select p.policy into strict policy from public.workspace_policy_versions p where p.workspace_id=ws and p.id=s.active_policy_id;if p_values is not null then if s.policy_version is distinct from p_revision then raise exception 'NR:VERSION_CONFLICT';end if;if exists(select 1 from jsonb_object_keys(p_values)k where k not in('allow_external_provider','default_model','output_tokens','final_evidence_k'))then raise exception 'NR:INVALID_SCOPE';end if;policy=policy||p_values;insert into public.workspace_policy_versions(workspace_id,version,policy)values(ws,s.policy_version+1,policy)returning id into next_id;update public.workspace_settings set active_policy_id=next_id,policy_version=policy_version+1 where workspace_id=ws returning * into s;update public.workspaces set capability_revision=capability_revision+1 where id=ws;end if;return jsonb_build_object('policy_id',s.active_policy_id,'revision',s.policy_version,'policy',policy);end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_source(p_context jsonb, p_document uuid, p_version uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare result jsonb;begin perform public.workbench_authorize(p_context,'read');select to_jsonb(v)||jsonb_build_object('filename',d.filename,'content_type',d.content_type)into result from public.document_versions v join public.documents d on d.workspace_id=v.workspace_id and d.id=v.document_id where v.workspace_id=(p_context->>'workspace_id')::uuid and v.id=p_version and d.id=p_document and d.lifecycle_state='active' and v.publication_state='ready';if result is null then raise exception 'NR:INVALID_SCOPE';end if;return result;end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_source_spaces(p_context jsonb, p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare result jsonb;begin perform public.workbench_run_access(p_context,p_run,'read');select coalesce(jsonb_agg(jsonb_build_object('document_id',s.document_id,'version_id',s.version_id,'embedding_space_id',v.embedding_space_id,'index_generation',v.index_generation,'complete',v.extraction_manifest->'complete')),'[]')into result from public.query_run_sources s join public.document_versions v on v.workspace_id=s.workspace_id and v.document_id=s.document_id and v.id=s.version_id where s.run_id=p_run;return result;end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_sources_available(p_run uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$select exists(select 1 from public.query_run_sources where run_id=p_run)and not exists(select 1 from public.query_run_sources s left join public.documents d on d.workspace_id=s.workspace_id and d.id=s.document_id left join public.document_versions v on v.workspace_id=s.workspace_id and v.document_id=s.document_id and v.id=s.version_id where s.run_id=p_run and(d.id is null or v.id is null or d.lifecycle_state<>'active' or d.lifecycle_epoch<>s.lifecycle_epoch or v.publication_state<>'ready'));$function$;
CREATE OR REPLACE FUNCTION public.workbench_stage_chunks(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint, p_chunks jsonb, p_space text, p_index text, p_manifest jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare j public.ingestion_jobs%rowtype;item jsonb;total bigint;h text;begin j=public.assert_workbench_lease(p_job,p_workspace,p_owner,p_generation,p_version,p_epoch);if j.kind<>'ingestion' or jsonb_array_length(p_chunks)not between 1 and 10000 or octet_length(p_chunks::text)>32000000 then raise exception 'NR:RESOURCE_LIMIT_EXCEEDED';end if;perform 1 from public.document_versions where workspace_id=p_workspace and id=p_version and publication_state<>'ready' for update;if not found then raise exception 'NR:VERSION_CONFLICT';end if;delete from public.document_chunks where workspace_id=p_workspace and version_id=p_version;for item in select value from jsonb_array_elements(p_chunks)loop if(item->>'workspace_id')::uuid<>p_workspace or(item->>'document_id')::uuid<>j.document_id or(item->>'version_id')::uuid<>p_version or octet_length(item->>'original_text')>32768 or item->>'original_content_hash'<>encode(sha256(convert_to(item->>'original_text','UTF8')),'hex')then raise exception 'NR:INVALID_SCOPE';end if;insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,content_hash,original_text,original_content_hash,enrichment_text,location,embedding_space_id,qdrant_point_id,metadata)values((item->>'chunk_id')::uuid,p_workspace,j.document_id,p_version,(item->>'ordinal')::int,item->>'original_text',item->>'original_content_hash',item->>'original_text',item->>'original_content_hash',item->>'retrieval_text',item->'location',p_space,item->>'chunk_id',jsonb_build_object('extraction',item->'extraction'));end loop;select count(*),encode(sha256(convert_to(string_agg(id::text||':'||original_content_hash,',' order by chunk_index),'UTF8')),'hex')into total,h from public.document_chunks where workspace_id=p_workspace and version_id=p_version;update public.document_versions set publication_state='processing',embedding_space_id=p_space,index_generation=p_index,extraction_manifest=p_manifest||jsonb_build_object('expected_chunks',total),staged_by_generation=p_generation,staged_manifest_hash=h where id=p_version and workspace_id=p_workspace;return jsonb_build_object('count',total,'manifest_hash',h);end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_start_run(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare j public.ingestion_jobs%rowtype;r public.query_runs%rowtype;sources jsonb;history jsonb;begin j=public.assert_workbench_lease(p_job,p_workspace,p_owner,p_generation,p_version,p_epoch);select * into strict r from public.query_runs where workspace_id=p_workspace and job_id=p_job for update;perform public.workbench_run_access(r.context,r.id,'append');if r.state<>'accepted' or r.deadline<=clock_timestamp()then raise exception 'NR:VERSION_CONFLICT';end if;update public.query_runs set state='running' where id=r.id returning * into r;perform public.workbench_emit(r.id,'run.started',jsonb_build_object('stage','accepted'));select coalesce(jsonb_agg(to_jsonb(s)),'[]')into sources from public.query_run_sources s where run_id=r.id;select coalesce(jsonb_agg(item order by message_order,created_at,id),'[]')into history from(select public.workbench_message_projection(m,r.id)as item,coalesce(m.message_order,0)as message_order,m.created_at,m.id from public.chat_messages m where workspace_id=p_workspace and session_id=r.session_id order by coalesce(m.message_order,0)desc,m.created_at desc,m.id desc limit 20)h where(item->>'available')::boolean;return to_jsonb(r)||jsonb_build_object('sources',sources,'history',history);end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_terminalize(p_run uuid, p_state text, p_code text, p_message text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare r public.query_runs%rowtype;accounting text;begin select * into strict r from public.query_runs where id=p_run for update;if r.state in('completed','failed','interrupted','cancelled')then return jsonb_build_object('run_id',r.id,'state',r.state);end if;if p_state not in('failed','interrupted','cancelled')then raise exception 'NR:INVALID_SCOPE';end if;accounting=case when exists(select 1 from public.usage_ledger where reservation_id=r.reservation_id)then 'pending_reconciliation' else 'not_started' end;update public.query_runs set state=p_state,completed_at=clock_timestamp(),accounting_state=accounting where id=r.id;update public.usage_reservations set state=case when accounting='not_started' then 'released' else 'pending_reconciliation' end where id=r.reservation_id;perform public.workbench_emit(r.id,'run.'||p_state,jsonb_build_object('code',p_code,'message',left(p_message,512),'accounting',accounting));update public.ingestion_jobs set status=case when p_state='cancelled' then 'cancelled' else 'failed' end,error_code=p_code,completed_at=clock_timestamp(),lease_generation=lease_generation+1,lease_owner=null,lease_expires_at=null where id=r.job_id;return jsonb_build_object('run_id',r.id,'state',p_state);end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_usage(p_context jsonb, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare ws uuid=(p_context->>'workspace_id')::uuid;begin_date date;result jsonb;capacity jsonb;begin perform public.workbench_authorize(p_context,'read');if p_days not between 1 and 90 then raise exception 'NR:INVALID_SCOPE';end if;begin_date=(clock_timestamp()at time zone 'UTC')::date-(p_days-1);select jsonb_build_object('provider_attempts',count(*),'pending_attempts',count(*)filter(where state='pending_reconciliation'),'input_tokens',case when count(*)=count(input_tokens)then coalesce(sum(input_tokens),0)end,'output_tokens',case when count(*)=count(output_tokens)then coalesce(sum(output_tokens),0)end,'cost_microusd',case when count(*)=count(cost_microusd)then coalesce(sum(cost_microusd),0)end)into result from public.usage_ledger where workspace_id=ws and created_at>=begin_date::timestamp at time zone 'UTC';select jsonb_build_object('admitted_operations',count(*),'reserved_tokens',coalesce(sum(reserved_tokens)filter(where state<>'released'),0),'active_or_pending_reservations',count(*)filter(where state in('reserved','pending_reconciliation')))into capacity from public.usage_reservations where workspace_id=ws and charge_period>=begin_date;return result||capacity||jsonb_build_object('period_start',begin_date,'period_end',(clock_timestamp()at time zone 'UTC')::date,'timezone','UTC','basis','v2 durable ledger and reservations; not a reconciled provider invoice','legacy_usage_included',false);end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_usage_attempt(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint, p_attempt uuid, p_policy jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare r public.query_runs%rowtype;begin perform public.assert_workbench_lease(p_job,p_workspace,p_owner,p_generation,p_version,p_epoch);select * into strict r from public.query_runs where workspace_id=p_workspace and job_id=p_job for update;perform public.workbench_run_access(r.context,r.id,'append');if r.state<>'running' or r.cancellation_requested_at is not null then raise exception 'NR:CANCELLED';end if;if not exists(select 1 from public.api_keys where workspace_id=p_workspace and id=(p_policy->>'credential_version')::uuid and is_active and revoked_at is null)or p_policy->>'funding_principal'<>'workspace' then raise exception 'NR:PROVIDER_AUTH_INVALID';end if;if exists(select 1 from public.usage_ledger where reservation_id=r.reservation_id and attempt_id<>p_attempt)then raise exception 'NR:VERSION_CONFLICT';end if;insert into public.usage_ledger(workspace_id,actor_id,reservation_id,attempt_id,provider,model,funding_principal)values(p_workspace,r.user_id,r.reservation_id,p_attempt,p_policy->>'provider',p_policy->>'model','workspace')on conflict(workspace_id,attempt_id)do nothing;update public.query_runs set accounting_state='pending_reconciliation' where id=r.id;update public.usage_reservations set state='pending_reconciliation' where id=r.reservation_id;return p_attempt;end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_usage_settle(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint, p_attempt uuid, p_usage jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare r public.query_runs%rowtype;begin perform public.assert_workbench_lease(p_job,p_workspace,p_owner,p_generation,p_version,p_epoch);select * into strict r from public.query_runs where workspace_id=p_workspace and job_id=p_job for update;update public.usage_ledger set input_tokens=(p_usage->>'input_tokens')::bigint,output_tokens=(p_usage->>'output_tokens')::bigint,cost_microusd=(p_usage->>'cost_microusd')::bigint,measurement=p_usage->>'measurement',price_table_version=p_usage->>'price_table_version',state=case when p_usage->>'input_tokens' is not null and p_usage->>'output_tokens' is not null and p_usage->>'cost_microusd' is not null and p_usage->>'price_table_version' is not null then 'settled' else 'pending_reconciliation' end where workspace_id=p_workspace and reservation_id=r.reservation_id and attempt_id=p_attempt;if not found then raise exception 'NR:PERSISTENCE_UNAVAILABLE';end if;end;$function$;
CREATE OR REPLACE FUNCTION public.workbench_worker_version(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$declare j public.ingestion_jobs%rowtype;result jsonb;begin j=public.assert_workbench_lease(p_job,p_workspace,p_owner,p_generation,p_version,p_epoch);if j.kind<>'ingestion' or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=(j.payload->>'actor_id')::uuid and role in('owner','admin','editor'))then raise exception 'NR:FORBIDDEN';end if;select to_jsonb(v)||jsonb_build_object('filename',j.payload->>'filename','uploaded_by',d.uploaded_by)into result from public.document_versions v join public.documents d on d.workspace_id=v.workspace_id and d.id=v.document_id where v.workspace_id=p_workspace and v.id=p_version and v.document_id=j.document_id;return result;end;$function$;
CREATE OR REPLACE FUNCTION public.workspace_role(target_workspace uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select nexusrag_private.workspace_role(target_workspace)
$function$;
set local check_function_bodies = on;

drop trigger if exists "on_auth_user_created" on "auth"."users";
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION nexusrag_private.handle_new_user();
drop trigger if exists "chat_sessions_set_updated_at" on "public"."chat_sessions";
CREATE TRIGGER chat_sessions_set_updated_at BEFORE UPDATE ON public."chat_sessions" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists "documents_enforce_identity_immutable" on "public"."documents";
CREATE TRIGGER documents_enforce_identity_immutable BEFORE UPDATE ON public."documents" FOR EACH ROW EXECUTE FUNCTION nexusrag_private.enforce_document_identity_immutable();
drop trigger if exists "documents_set_updated_at" on "public"."documents";
CREATE TRIGGER documents_set_updated_at BEFORE UPDATE ON public."documents" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists "eval_runs_set_updated_at" on "public"."eval_runs";
CREATE TRIGGER eval_runs_set_updated_at BEFORE UPDATE ON public."eval_runs" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists "clear_terminal_ingestion_job_lease" on "public"."ingestion_jobs";
CREATE TRIGGER clear_terminal_ingestion_job_lease BEFORE UPDATE ON public."ingestion_jobs" FOR EACH ROW EXECUTE FUNCTION clear_terminal_ingestion_job_lease();
drop trigger if exists "ingestion_jobs_set_updated_at" on "public"."ingestion_jobs";
CREATE TRIGGER ingestion_jobs_set_updated_at BEFORE UPDATE ON public."ingestion_jobs" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists "profiles_set_updated_at" on "public"."profiles";
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public."profiles" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists "membership_revision_changed" on "public"."workspace_members";
CREATE TRIGGER membership_revision_changed AFTER INSERT OR DELETE OR UPDATE ON public."workspace_members" FOR EACH ROW EXECUTE FUNCTION bump_capability_revision();
drop trigger if exists "workspace_members_enforce_invariants" on "public"."workspace_members";
CREATE TRIGGER workspace_members_enforce_invariants BEFORE INSERT OR DELETE OR UPDATE ON public."workspace_members" FOR EACH ROW EXECUTE FUNCTION nexusrag_private.enforce_workspace_member_invariants();
drop trigger if exists "workspace_initialize_policy" on "public"."workspace_settings";
CREATE TRIGGER workspace_initialize_policy BEFORE INSERT ON public."workspace_settings" FOR EACH ROW EXECUTE FUNCTION workbench_initialize_policy();
drop trigger if exists "workspace_settings_set_updated_at" on "public"."workspace_settings";
CREATE TRIGGER workspace_settings_set_updated_at BEFORE UPDATE ON public."workspace_settings" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists "workspaces_enforce_identity_immutable" on "public"."workspaces";
CREATE TRIGGER workspaces_enforce_identity_immutable BEFORE UPDATE ON public."workspaces" FOR EACH ROW EXECUTE FUNCTION nexusrag_private.enforce_workspace_identity_immutable();
drop trigger if exists "workspaces_set_updated_at" on "public"."workspaces";
CREATE TRIGGER workspaces_set_updated_at BEFORE UPDATE ON public."workspaces" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

alter table public."api_keys" enable row level security;
alter table public."audit_events" enable row level security;
alter table public."budget_reservations" enable row level security;
alter table public."cache_entries" enable row level security;
alter table public."chat_messages" enable row level security;
alter table public."chat_sessions" enable row level security;
alter table public."conversation_participants" enable row level security;
alter table public."deletion_operations" enable row level security;
alter table public."deletion_receipts" enable row level security;
alter table public."deletion_targets" enable row level security;
alter table public."document_chunks" enable row level security;
alter table public."document_uploads" enable row level security;
alter table public."document_versions" enable row level security;
alter table public."documents" enable row level security;
alter table public."eval_results" enable row level security;
alter table public."eval_runs" enable row level security;
alter table public."evidence_exports" enable row level security;
alter table public."evidence_items" enable row level security;
alter table public."evidence_source_versions" enable row level security;
alter table public."evidence_sources" enable row level security;
alter table public."finding_participants" enable row level security;
alter table public."finding_reviews" enable row level security;
alter table public."finding_versions" enable row level security;
alter table public."findings" enable row level security;
alter table public."graph_aliases" enable row level security;
alter table public."graph_entities" enable row level security;
alter table public."graph_relationships" enable row level security;
alter table public."ingestion_jobs" enable row level security;
alter table public."llm_usage_events" enable row level security;
alter table public."materializations" enable row level security;
alter table public."monitor_runs" enable row level security;
alter table public."monitors" enable row level security;
alter table public."profiles" enable row level security;
alter table public."provider_health_state" enable row level security;
alter table public."provider_registry" enable row level security;
alter table public."provider_terms_snapshots" enable row level security;
alter table public."query_events" enable row level security;
alter table public."query_run_sources" enable row level security;
alter table public."query_runs" enable row level security;
alter table public."resource_budgets" enable row level security;
alter table public."rights_decisions" enable row level security;
alter table public."usage_ledger" enable row level security;
alter table public."usage_reservations" enable row level security;
alter table public."workbench_mutations" enable row level security;
alter table public."workbench_outbox" enable row level security;
alter table public."workspace_members" enable row level security;
alter table public."workspace_policy_versions" enable row level security;
alter table public."workspace_provider_policies" enable row level security;
alter table public."workspace_settings" enable row level security;
alter table public."workspace_usage_daily" enable row level security;
alter table public."workspaces" enable row level security;

drop policy if exists "api_keys_delete_owner_or_admin" on "public"."api_keys";
create policy "api_keys_delete_owner_or_admin" on "public"."api_keys" as permissive for delete to authenticated using (((user_id = ( SELECT auth.uid() AS uid)) OR has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text])));
drop policy if exists "api_keys_insert_owner_or_admin" on "public"."api_keys";
create policy "api_keys_insert_owner_or_admin" on "public"."api_keys" as permissive for insert to authenticated with check (((user_id = ( SELECT auth.uid() AS uid)) AND has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'editor'::text])));
drop policy if exists "api_keys_select_owner_or_admin" on "public"."api_keys";
create policy "api_keys_select_owner_or_admin" on "public"."api_keys" as permissive for select to authenticated using (((user_id = ( SELECT auth.uid() AS uid)) OR has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text])));
drop policy if exists "api_keys_update_owner_or_admin" on "public"."api_keys";
create policy "api_keys_update_owner_or_admin" on "public"."api_keys" as permissive for update to authenticated using (((user_id = ( SELECT auth.uid() AS uid)) OR has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text]))) with check (((user_id = ( SELECT auth.uid() AS uid)) OR has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text])));
drop policy if exists "audit_events_insert_members" on "public"."audit_events";
create policy "audit_events_insert_members" on "public"."audit_events" as permissive for insert to authenticated with check (((workspace_id IS NULL) OR is_workspace_member(workspace_id)));
drop policy if exists "audit_events_select_admins" on "public"."audit_events";
create policy "audit_events_select_admins" on "public"."audit_events" as permissive for select to authenticated using (((workspace_id IS NOT NULL) AND has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text])));
drop policy if exists "nexusrag_explicit_client_deny" on "public"."budget_reservations";
create policy "nexusrag_explicit_client_deny" on "public"."budget_reservations" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."cache_entries";
create policy "nexusrag_explicit_client_deny" on "public"."cache_entries" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "chat_messages_insert_editors" on "public"."chat_messages";
create policy "chat_messages_insert_editors" on "public"."chat_messages" as permissive for insert to authenticated with check (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'editor'::text]));
drop policy if exists "chat_messages_read_authorized" on "public"."chat_messages";
create policy "chat_messages_read_authorized" on "public"."chat_messages" as permissive for select to authenticated using (nexusrag_private.can_read_conversation(workspace_id, session_id));
drop policy if exists "chat_sessions_insert_editors" on "public"."chat_sessions";
create policy "chat_sessions_insert_editors" on "public"."chat_sessions" as permissive for insert to authenticated with check (((user_id = ( SELECT auth.uid() AS uid)) AND has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'editor'::text])));
drop policy if exists "chat_sessions_read_authorized" on "public"."chat_sessions";
create policy "chat_sessions_read_authorized" on "public"."chat_sessions" as permissive for select to authenticated using (nexusrag_private.can_read_conversation(workspace_id, id));
drop policy if exists "chat_sessions_update_owners" on "public"."chat_sessions";
create policy "chat_sessions_update_owners" on "public"."chat_sessions" as permissive for update to authenticated using (((user_id = ( SELECT auth.uid() AS uid)) OR has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text]))) with check (is_workspace_member(workspace_id));
drop policy if exists "nexusrag_explicit_client_deny" on "public"."conversation_participants";
create policy "nexusrag_explicit_client_deny" on "public"."conversation_participants" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."deletion_operations";
create policy "nexusrag_explicit_client_deny" on "public"."deletion_operations" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."deletion_receipts";
create policy "nexusrag_explicit_client_deny" on "public"."deletion_receipts" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."deletion_targets";
create policy "nexusrag_explicit_client_deny" on "public"."deletion_targets" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "document_chunks_delete_editors" on "public"."document_chunks";
create policy "document_chunks_delete_editors" on "public"."document_chunks" as permissive for delete to authenticated using (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'editor'::text]));
drop policy if exists "document_chunks_insert_editors" on "public"."document_chunks";
create policy "document_chunks_insert_editors" on "public"."document_chunks" as permissive for insert to authenticated with check (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'editor'::text]));
drop policy if exists "document_chunks_select_members" on "public"."document_chunks";
create policy "document_chunks_select_members" on "public"."document_chunks" as permissive for select to authenticated using (is_workspace_member(workspace_id));
drop policy if exists "document_chunks_update_editors" on "public"."document_chunks";
create policy "document_chunks_update_editors" on "public"."document_chunks" as permissive for update to authenticated using (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'editor'::text])) with check (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'editor'::text]));
drop policy if exists "nexusrag_explicit_client_deny" on "public"."document_uploads";
create policy "nexusrag_explicit_client_deny" on "public"."document_uploads" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."document_versions";
create policy "nexusrag_explicit_client_deny" on "public"."document_versions" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "documents_delete_editors" on "public"."documents";
create policy "documents_delete_editors" on "public"."documents" as permissive for delete to authenticated using (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'editor'::text]));
drop policy if exists "documents_insert_editors" on "public"."documents";
create policy "documents_insert_editors" on "public"."documents" as permissive for insert to authenticated with check (((uploaded_by = ( SELECT auth.uid() AS uid)) AND has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'editor'::text])));
drop policy if exists "documents_select_members" on "public"."documents";
create policy "documents_select_members" on "public"."documents" as permissive for select to authenticated using (is_workspace_member(workspace_id));
drop policy if exists "documents_update_editors" on "public"."documents";
create policy "documents_update_editors" on "public"."documents" as permissive for update to authenticated using (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'editor'::text])) with check (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'editor'::text]));
drop policy if exists "eval_results_delete_admins" on "public"."eval_results";
create policy "eval_results_delete_admins" on "public"."eval_results" as permissive for delete to authenticated using (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text]));
drop policy if exists "eval_results_insert_admins" on "public"."eval_results";
create policy "eval_results_insert_admins" on "public"."eval_results" as permissive for insert to authenticated with check (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text]));
drop policy if exists "eval_results_select_members" on "public"."eval_results";
create policy "eval_results_select_members" on "public"."eval_results" as permissive for select to authenticated using (is_workspace_member(workspace_id));
drop policy if exists "eval_results_update_admins" on "public"."eval_results";
create policy "eval_results_update_admins" on "public"."eval_results" as permissive for update to authenticated using (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text])) with check (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text]));
drop policy if exists "eval_runs_delete_admins" on "public"."eval_runs";
create policy "eval_runs_delete_admins" on "public"."eval_runs" as permissive for delete to authenticated using (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text]));
drop policy if exists "eval_runs_insert_admins" on "public"."eval_runs";
create policy "eval_runs_insert_admins" on "public"."eval_runs" as permissive for insert to authenticated with check (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text]));
drop policy if exists "eval_runs_select_members" on "public"."eval_runs";
create policy "eval_runs_select_members" on "public"."eval_runs" as permissive for select to authenticated using (is_workspace_member(workspace_id));
drop policy if exists "eval_runs_update_admins" on "public"."eval_runs";
create policy "eval_runs_update_admins" on "public"."eval_runs" as permissive for update to authenticated using (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text])) with check (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text]));
drop policy if exists "nexusrag_explicit_client_deny" on "public"."evidence_exports";
create policy "nexusrag_explicit_client_deny" on "public"."evidence_exports" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."evidence_items";
create policy "nexusrag_explicit_client_deny" on "public"."evidence_items" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."evidence_source_versions";
create policy "nexusrag_explicit_client_deny" on "public"."evidence_source_versions" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."evidence_sources";
create policy "nexusrag_explicit_client_deny" on "public"."evidence_sources" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."finding_participants";
create policy "nexusrag_explicit_client_deny" on "public"."finding_participants" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."finding_reviews";
create policy "nexusrag_explicit_client_deny" on "public"."finding_reviews" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."finding_versions";
create policy "nexusrag_explicit_client_deny" on "public"."finding_versions" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."findings";
create policy "nexusrag_explicit_client_deny" on "public"."findings" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."graph_aliases";
create policy "nexusrag_explicit_client_deny" on "public"."graph_aliases" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."graph_entities";
create policy "nexusrag_explicit_client_deny" on "public"."graph_entities" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."graph_relationships";
create policy "nexusrag_explicit_client_deny" on "public"."graph_relationships" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "ingestion_jobs_insert_editors" on "public"."ingestion_jobs";
create policy "ingestion_jobs_insert_editors" on "public"."ingestion_jobs" as permissive for insert to authenticated with check (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'editor'::text]));
drop policy if exists "ingestion_jobs_select_members" on "public"."ingestion_jobs";
create policy "ingestion_jobs_select_members" on "public"."ingestion_jobs" as permissive for select to authenticated using (is_workspace_member(workspace_id));
drop policy if exists "ingestion_jobs_update_editors" on "public"."ingestion_jobs";
create policy "ingestion_jobs_update_editors" on "public"."ingestion_jobs" as permissive for update to authenticated using (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'editor'::text])) with check (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'editor'::text]));
drop policy if exists "llm_usage_events_insert_members" on "public"."llm_usage_events";
create policy "llm_usage_events_insert_members" on "public"."llm_usage_events" as permissive for insert to authenticated with check (is_workspace_member(workspace_id));
drop policy if exists "llm_usage_events_select_admins" on "public"."llm_usage_events";
create policy "llm_usage_events_select_admins" on "public"."llm_usage_events" as permissive for select to authenticated using (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text]));
drop policy if exists "nexusrag_explicit_client_deny" on "public"."materializations";
create policy "nexusrag_explicit_client_deny" on "public"."materializations" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."monitor_runs";
create policy "nexusrag_explicit_client_deny" on "public"."monitor_runs" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."monitors";
create policy "nexusrag_explicit_client_deny" on "public"."monitors" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "profiles_select_own" on "public"."profiles";
create policy "profiles_select_own" on "public"."profiles" as permissive for select to authenticated using ((id = ( SELECT auth.uid() AS uid)));
drop policy if exists "profiles_update_own" on "public"."profiles";
create policy "profiles_update_own" on "public"."profiles" as permissive for update to authenticated using ((id = ( SELECT auth.uid() AS uid))) with check ((id = ( SELECT auth.uid() AS uid)));
drop policy if exists "provider_health_select_members" on "public"."provider_health_state";
create policy "provider_health_select_members" on "public"."provider_health_state" as permissive for select to authenticated using (is_workspace_member(workspace_id));
drop policy if exists "nexusrag_explicit_client_deny" on "public"."provider_registry";
create policy "nexusrag_explicit_client_deny" on "public"."provider_registry" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."provider_terms_snapshots";
create policy "nexusrag_explicit_client_deny" on "public"."provider_terms_snapshots" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."query_events";
create policy "nexusrag_explicit_client_deny" on "public"."query_events" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."query_run_sources";
create policy "nexusrag_explicit_client_deny" on "public"."query_run_sources" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."query_runs";
create policy "nexusrag_explicit_client_deny" on "public"."query_runs" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."resource_budgets";
create policy "nexusrag_explicit_client_deny" on "public"."resource_budgets" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."rights_decisions";
create policy "nexusrag_explicit_client_deny" on "public"."rights_decisions" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."usage_ledger";
create policy "nexusrag_explicit_client_deny" on "public"."usage_ledger" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."usage_reservations";
create policy "nexusrag_explicit_client_deny" on "public"."usage_reservations" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."workbench_mutations";
create policy "nexusrag_explicit_client_deny" on "public"."workbench_mutations" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."workbench_outbox";
create policy "nexusrag_explicit_client_deny" on "public"."workbench_outbox" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "workspace_members_delete_admins" on "public"."workspace_members";
create policy "workspace_members_delete_admins" on "public"."workspace_members" as permissive for delete to authenticated using ((((workspace_role(workspace_id) = 'owner'::text) AND (role <> 'owner'::text)) OR ((workspace_role(workspace_id) = 'admin'::text) AND (role = ANY (ARRAY['editor'::text, 'viewer'::text])))));
drop policy if exists "workspace_members_insert_admins" on "public"."workspace_members";
create policy "workspace_members_insert_admins" on "public"."workspace_members" as permissive for insert to authenticated with check (((owns_workspace(workspace_id) AND ((role = ANY (ARRAY['admin'::text, 'editor'::text, 'viewer'::text])) OR ((user_id = ( SELECT auth.uid() AS uid)) AND (role = 'owner'::text)))) OR ((workspace_role(workspace_id) = 'admin'::text) AND (role = ANY (ARRAY['editor'::text, 'viewer'::text])))));
drop policy if exists "workspace_members_select_members" on "public"."workspace_members";
create policy "workspace_members_select_members" on "public"."workspace_members" as permissive for select to authenticated using (is_workspace_member(workspace_id));
drop policy if exists "workspace_members_update_admins" on "public"."workspace_members";
create policy "workspace_members_update_admins" on "public"."workspace_members" as permissive for update to authenticated using ((((workspace_role(workspace_id) = 'owner'::text) AND (role <> 'owner'::text)) OR ((workspace_role(workspace_id) = 'admin'::text) AND (role = ANY (ARRAY['editor'::text, 'viewer'::text]))))) with check ((((workspace_role(workspace_id) = 'owner'::text) AND (role = ANY (ARRAY['admin'::text, 'editor'::text, 'viewer'::text]))) OR ((workspace_role(workspace_id) = 'admin'::text) AND (role = ANY (ARRAY['editor'::text, 'viewer'::text])))));
drop policy if exists "nexusrag_explicit_client_deny" on "public"."workspace_policy_versions";
create policy "nexusrag_explicit_client_deny" on "public"."workspace_policy_versions" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "nexusrag_explicit_client_deny" on "public"."workspace_provider_policies";
create policy "nexusrag_explicit_client_deny" on "public"."workspace_provider_policies" as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists "workspace_settings_delete_admins" on "public"."workspace_settings";
create policy "workspace_settings_delete_admins" on "public"."workspace_settings" as permissive for delete to authenticated using (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text]));
drop policy if exists "workspace_settings_insert_admins" on "public"."workspace_settings";
create policy "workspace_settings_insert_admins" on "public"."workspace_settings" as permissive for insert to authenticated with check (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text]));
drop policy if exists "workspace_settings_select_members" on "public"."workspace_settings";
create policy "workspace_settings_select_members" on "public"."workspace_settings" as permissive for select to authenticated using (is_workspace_member(workspace_id));
drop policy if exists "workspace_settings_update_admins" on "public"."workspace_settings";
create policy "workspace_settings_update_admins" on "public"."workspace_settings" as permissive for update to authenticated using (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text])) with check (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text]));
drop policy if exists "workspace_usage_daily_select_admins" on "public"."workspace_usage_daily";
create policy "workspace_usage_daily_select_admins" on "public"."workspace_usage_daily" as permissive for select to authenticated using (has_workspace_role(workspace_id, ARRAY['owner'::text, 'admin'::text]));
drop policy if exists "workspaces_delete_owners" on "public"."workspaces";
create policy "workspaces_delete_owners" on "public"."workspaces" as permissive for delete to authenticated using (has_workspace_role(id, ARRAY['owner'::text]));
drop policy if exists "workspaces_insert_owner" on "public"."workspaces";
create policy "workspaces_insert_owner" on "public"."workspaces" as permissive for insert to authenticated with check ((owner_id = ( SELECT auth.uid() AS uid)));
drop policy if exists "workspaces_select_members" on "public"."workspaces";
create policy "workspaces_select_members" on "public"."workspaces" as permissive for select to authenticated using (is_workspace_member(id));
drop policy if exists "workspaces_update_admins" on "public"."workspaces";
create policy "workspaces_update_admins" on "public"."workspaces" as permissive for update to authenticated using (has_workspace_role(id, ARRAY['owner'::text, 'admin'::text])) with check (has_workspace_role(id, ARRAY['owner'::text, 'admin'::text]));
drop policy if exists "nexusrag_documents_insert" on "storage"."objects";
create policy "nexusrag_documents_insert" on "storage"."objects" as permissive for insert to authenticated with check (((bucket_id = 'documents'::text) AND nexusrag_private.can_write_document_object(name)));
drop policy if exists "nexusrag_documents_select" on "storage"."objects";
create policy "nexusrag_documents_select" on "storage"."objects" as permissive for select to authenticated using (((bucket_id = 'documents'::text) AND nexusrag_private.can_read_document_object(name)));
drop policy if exists "nexusrag_documents_update" on "storage"."objects";
create policy "nexusrag_documents_update" on "storage"."objects" as permissive for update to authenticated using (((bucket_id = 'documents'::text) AND nexusrag_private.can_write_document_object(name))) with check (((bucket_id = 'documents'::text) AND nexusrag_private.can_write_document_object(name)));

insert into storage.buckets(id,name,public,file_size_limit) values ('documents','documents',false,25000000) on conflict(id) do update set name=excluded.name,public=false,file_size_limit=excluded.file_size_limit;

revoke all privileges on all tables in schema public from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on all tables in schema public to service_role;
revoke all privileges on all sequences in schema public from anon, authenticated;
grant usage, select, update on all sequences in schema public to service_role;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema nexusrag_private to authenticated, service_role;
revoke all on schema nexusrag_private from public, anon;

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema nexusrag_private from public, anon, authenticated;
grant execute on function "nexusrag_private"."can_read_conversation"(p_workspace uuid, p_session uuid) to authenticated;
grant execute on function "nexusrag_private"."can_read_conversation"(p_workspace uuid, p_session uuid) to service_role;
grant execute on function "nexusrag_private"."can_read_document_object"(p_name text) to authenticated;
grant execute on function "nexusrag_private"."can_read_document_object"(p_name text) to service_role;
grant execute on function "nexusrag_private"."can_write_document_object"(p_name text) to authenticated;
grant execute on function "nexusrag_private"."can_write_document_object"(p_name text) to service_role;
grant execute on function "nexusrag_private"."owns_workspace"(target_workspace uuid) to authenticated;
grant execute on function "nexusrag_private"."owns_workspace"(target_workspace uuid) to service_role;
grant execute on function "nexusrag_private"."workspace_role"(target_workspace uuid) to authenticated;
grant execute on function "nexusrag_private"."workspace_role"(target_workspace uuid) to service_role;
grant execute on function "public"."activate_workspace_key"(p_workspace uuid, p_actor uuid, p_provider text, p_ciphertext text, p_label text) to service_role;
grant execute on function "public"."append_chat_turn"(p_workspace uuid, p_session uuid, p_actor uuid, p_question text, p_answer text, p_sources jsonb, p_metadata jsonb) to service_role;
grant execute on function "public"."assert_workbench_lease"(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint) to service_role;
grant execute on function "public"."bump_capability_revision"() to service_role;
grant execute on function "public"."claim_expired_document_uploads"(p_limit integer) to service_role;
grant execute on function "public"."claim_retention_schedules"(p_worker_id text, p_limit integer, p_lease_seconds integer) to service_role;
grant execute on function "public"."claim_workbench_job"(p_owner text, p_kinds text[], p_lease_seconds integer) to service_role;
grant execute on function "public"."clear_private_session"(p_workspace uuid, p_session uuid, p_actor uuid) to service_role;
grant execute on function "public"."clear_terminal_ingestion_job_lease"() to service_role;
grant execute on function "public"."evaluate_provider_rights"(p_workspace uuid, p_provider text, p_action text) to service_role;
grant execute on function "public"."finish_workbench_job"(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint, p_success boolean, p_retryable boolean, p_error_code text) to service_role;
grant execute on function "public"."has_workspace_role"(target_workspace uuid, allowed_roles text[]) to authenticated;
grant execute on function "public"."has_workspace_role"(target_workspace uuid, allowed_roles text[]) to service_role;
grant execute on function "public"."is_workspace_member"(target_workspace uuid) to authenticated;
grant execute on function "public"."is_workspace_member"(target_workspace uuid) to service_role;
grant execute on function "public"."match_document_chunks"(query_embedding vector, match_workspace_id uuid, match_count integer, match_filters jsonb) to authenticated;
grant execute on function "public"."match_document_chunks"(query_embedding vector, match_workspace_id uuid, match_count integer, match_filters jsonb) to service_role;
grant execute on function "public"."owns_workspace"(target_workspace uuid) to authenticated;
grant execute on function "public"."owns_workspace"(target_workspace uuid) to service_role;
grant execute on function "public"."reconcile_workspace_usage"(p_workspace_id uuid, p_usage_date date) to service_role;
grant execute on function "public"."record_rights_decision"(p_workspace uuid, p_provider text, p_action text, p_actor uuid, p_request text) to service_role;
grant execute on function "public"."release_metered_capacity"(p_workspace uuid, p_reservation uuid) to service_role;
grant execute on function "public"."renew_workbench_job"(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint) to service_role;
grant execute on function "public"."requeue_ingestion_job"(p_job_id uuid, p_worker_id text, p_error_message text, p_retry_seconds integer) to service_role;
grant execute on function "public"."reserve_metered_capacity"(p_workspace uuid, p_provider text, p_dimension text, p_amount bigint, p_key text) to service_role;
grant execute on function "public"."reserve_query_capacity"(p_workspace uuid, p_actor uuid, p_operation uuid, p_tokens bigint, p_query_limit bigint, p_token_limit bigint) to service_role;
grant execute on function "public"."revoke_workspace_key"(p_workspace uuid, p_actor uuid, p_provider text) to service_role;
grant execute on function "public"."set_updated_at"() to service_role;
grant execute on function "public"."settle_metered_capacity"(p_workspace uuid, p_reservation uuid, p_measured bigint) to service_role;
grant execute on function "public"."tombstone_document"(p_workspace uuid, p_document uuid, p_actor uuid) to service_role;
grant execute on function "public"."update_workspace_policy"(p_workspace uuid, p_values jsonb, p_expected_version bigint) to service_role;
grant execute on function "public"."uuid_or_null"(value text) to authenticated;
grant execute on function "public"."uuid_or_null"(value text) to service_role;
grant execute on function "public"."workbench_abort_upload"(p_context jsonb, p_upload uuid, p_write_token uuid, p_may_have_object boolean) to service_role;
grant execute on function "public"."workbench_admit_run"(p_context jsonb, p_request jsonb, p_key text, p_hash text, p_tokens bigint, p_query_limit bigint, p_token_limit bigint) to service_role;
grant execute on function "public"."workbench_append_event"(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint, p_event uuid, p_type text, p_payload jsonb) to service_role;
grant execute on function "public"."workbench_authorize"(p_context jsonb, p_operation text) to service_role;
grant execute on function "public"."workbench_begin_upload"(p_context jsonb, p_command jsonb, p_key text, p_hash text, p_bucket text, p_max_documents bigint, p_max_storage_bytes bigint) to service_role;
grant execute on function "public"."workbench_cancel_run"(p_context jsonb, p_run uuid) to service_role;
grant execute on function "public"."workbench_claim_upload"(p_context jsonb, p_upload uuid) to service_role;
grant execute on function "public"."workbench_complete_upload"(p_context jsonb, p_upload uuid, p_key text) to service_role;
grant execute on function "public"."workbench_conversation"(p_context jsonb, p_operation text, p_id uuid, p_title text, p_revision bigint, p_key text) to service_role;
grant execute on function "public"."workbench_emit"(p_run uuid, p_type text, p_payload jsonb, p_event uuid) to service_role;
grant execute on function "public"."workbench_evidence"(p_context jsonb, p_run uuid, p_ids uuid[]) to service_role;
grant execute on function "public"."workbench_fail_run"(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint, p_code text, p_state text, p_message text) to service_role;
grant execute on function "public"."workbench_finding"(p_context jsonb, p_operation text, p_id uuid, p_command jsonb, p_revision bigint, p_key text, p_hash text) to service_role;
grant execute on function "public"."workbench_finish_run"(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint, p_answer jsonb) to service_role;
grant execute on function "public"."workbench_initialize_policy"() to service_role;
grant execute on function "public"."workbench_job_action"(p_context jsonb, p_job uuid, p_action text) to service_role;
grant execute on function "public"."workbench_message_projection"(p_message chat_messages, p_for_run uuid) to service_role;
grant execute on function "public"."workbench_publish_version"(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint, p_receipt jsonb) to service_role;
grant execute on function "public"."workbench_read"(p_context jsonb, p_resource text, p_id uuid, p_after uuid, p_limit integer, p_latest boolean, p_search text) to service_role;
grant execute on function "public"."workbench_record_upload"(p_context jsonb, p_upload uuid, p_receipt jsonb) to service_role;
grant execute on function "public"."workbench_recover_uploads"() to service_role;
grant execute on function "public"."workbench_run_access"(p_context jsonb, p_run uuid, p_operation text) to service_role;
grant execute on function "public"."workbench_run_authorize"(p_context jsonb, p_run uuid, p_operation text) to service_role;
grant execute on function "public"."workbench_run_events"(p_context jsonb, p_run uuid, p_after bigint, p_limit integer) to service_role;
grant execute on function "public"."workbench_schedule"() to service_role;
grant execute on function "public"."workbench_session_access"(p_workspace uuid, p_session uuid, p_actor uuid, p_operation text) to service_role;
grant execute on function "public"."workbench_settings"(p_context jsonb, p_values jsonb, p_revision bigint) to service_role;
grant execute on function "public"."workbench_source"(p_context jsonb, p_document uuid, p_version uuid) to service_role;
grant execute on function "public"."workbench_source_spaces"(p_context jsonb, p_run uuid) to service_role;
grant execute on function "public"."workbench_sources_available"(p_run uuid) to service_role;
grant execute on function "public"."workbench_stage_chunks"(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint, p_chunks jsonb, p_space text, p_index text, p_manifest jsonb) to service_role;
grant execute on function "public"."workbench_start_run"(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint) to service_role;
grant execute on function "public"."workbench_terminalize"(p_run uuid, p_state text, p_code text, p_message text) to service_role;
grant execute on function "public"."workbench_usage"(p_context jsonb, p_days integer) to service_role;
grant execute on function "public"."workbench_usage_attempt"(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint, p_attempt uuid, p_policy jsonb) to service_role;
grant execute on function "public"."workbench_usage_settle"(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint, p_attempt uuid, p_usage jsonb) to service_role;
grant execute on function "public"."workbench_worker_version"(p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint) to service_role;
grant execute on function "public"."workspace_role"(target_workspace uuid) to authenticated;
grant execute on function "public"."workspace_role"(target_workspace uuid) to service_role;
grant execute on all functions in schema public to service_role;
grant execute on all functions in schema nexusrag_private to service_role;

do $$ declare n integer; begin select count(*) into n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r' and c.relname = any(array['api_keys','audit_events','budget_reservations','cache_entries','chat_messages','chat_sessions','conversation_participants','deletion_operations','deletion_receipts','deletion_targets','document_chunks','document_uploads','document_versions','documents','eval_results','eval_runs','evidence_exports','evidence_items','evidence_source_versions','evidence_sources','finding_participants','finding_reviews','finding_versions','findings','graph_aliases','graph_entities','graph_relationships','ingestion_jobs','llm_usage_events','materializations','monitor_runs','monitors','profiles','provider_health_state','provider_registry','provider_terms_snapshots','query_events','query_run_sources','query_runs','resource_budgets','rights_decisions','usage_ledger','usage_reservations','workbench_mutations','workbench_outbox','workspace_members','workspace_policy_versions','workspace_provider_policies','workspace_settings','workspace_usage_daily','workspaces' ]); if n <> 51 then raise exception 'NexusRAG baseline expected 51 public tables, found %',n; end if; end $$;
do $$ begin if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity and c.relname = any(array['api_keys','audit_events','budget_reservations','cache_entries','chat_messages','chat_sessions','conversation_participants','deletion_operations','deletion_receipts','deletion_targets','document_chunks','document_uploads','document_versions','documents','eval_results','eval_runs','evidence_exports','evidence_items','evidence_source_versions','evidence_sources','finding_participants','finding_reviews','finding_versions','findings','graph_aliases','graph_entities','graph_relationships','ingestion_jobs','llm_usage_events','materializations','monitor_runs','monitors','profiles','provider_health_state','provider_registry','provider_terms_snapshots','query_events','query_run_sources','query_runs','resource_budgets','rights_decisions','usage_ledger','usage_reservations','workbench_mutations','workbench_outbox','workspace_members','workspace_policy_versions','workspace_provider_policies','workspace_settings','workspace_usage_daily','workspaces' ])) then raise exception 'NexusRAG baseline requires RLS on every application table'; end if; end $$;
commit;
