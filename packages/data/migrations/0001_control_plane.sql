PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY, checksum TEXT NOT NULL CHECK(length(checksum)=64), applied_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY CHECK(length(id)=36), lifecycle_state TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle_state IN ('active','deleting','deleted')),
  lifecycle_epoch INTEGER NOT NULL DEFAULT 1 CHECK(lifecycle_epoch>0), capability_revision INTEGER NOT NULL DEFAULT 1 CHECK(capability_revision>0),
  active_policy_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('viewer','editor','admin','owner')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','revoked')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(workspace_id,user_id),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE IF NOT EXISTS documents (
  workspace_id TEXT NOT NULL, id TEXT NOT NULL, filename TEXT NOT NULL, lifecycle_state TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle_state IN ('active','deleting','deleted')),
  lifecycle_epoch INTEGER NOT NULL DEFAULT 1 CHECK(lifecycle_epoch>0), active_version_id TEXT, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(workspace_id,id),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE IF NOT EXISTS document_versions (
  workspace_id TEXT NOT NULL, document_id TEXT NOT NULL, id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('uploading','staged','processing','indexed','ready','failed','cancelled')),
  original_bucket TEXT NOT NULL, original_key TEXT NOT NULL, original_hash TEXT CHECK(original_hash IS NULL OR length(original_hash)=64), original_bytes INTEGER CHECK(original_bytes IS NULL OR original_bytes>=0),
  embedding_fingerprint TEXT, index_generation TEXT, extraction_manifest TEXT, created_at TEXT NOT NULL, published_at TEXT,
  PRIMARY KEY(workspace_id,document_id,id), FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_original_object ON document_versions(original_bucket,original_key);
CREATE TABLE IF NOT EXISTS object_manifests (
  workspace_id TEXT NOT NULL, upload_id TEXT NOT NULL, document_id TEXT NOT NULL, version_id TEXT NOT NULL, bucket TEXT NOT NULL, object_key TEXT NOT NULL,
  expected_bytes INTEGER NOT NULL CHECK(expected_bytes>=0), actual_bytes INTEGER, expected_hash TEXT, actual_hash TEXT, state TEXT NOT NULL CHECK(state IN ('allocated','receiving','verified','aborted','cleanup_pending','deleted')),
  lifecycle_epoch INTEGER NOT NULL CHECK(lifecycle_epoch>0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(workspace_id,upload_id),
  FOREIGN KEY(workspace_id,document_id,version_id) REFERENCES document_versions(workspace_id,document_id,id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE IF NOT EXISTS jobs (
  workspace_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, resource_id TEXT NOT NULL, lifecycle_epoch INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','processing','retry_wait','completed','failed','cancelled')), attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL CHECK(max_attempts>0), run_after TEXT NOT NULL, lease_owner TEXT, lease_generation INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TEXT, heartbeat_at TEXT, cancellation_requested_at TEXT, error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,id), FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL, aggregate_version INTEGER NOT NULL,
  event_type TEXT NOT NULL, payload TEXT NOT NULL CHECK(length(payload)<=65536), state TEXT NOT NULL CHECK(state IN ('pending','delivering','delivered','failed')),
  next_attempt_at TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, delivered_at TEXT,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE IF NOT EXISTS idempotency_records (
  workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, operation TEXT NOT NULL, idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  resource_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY(workspace_id,actor_id,operation,idempotency_key)
) STRICT;
CREATE TABLE IF NOT EXISTS query_runs (
  workspace_id TEXT NOT NULL, id TEXT NOT NULL, user_id TEXT NOT NULL, session_id TEXT NOT NULL, payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  mode TEXT NOT NULL CHECK(mode IN ('ask','compare','extract','summarize')), scope_json TEXT NOT NULL, snapshot_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('accepted','running','completed','failed','cancelled','interrupted')), policy_version INTEGER NOT NULL,
  lifecycle_epoch INTEGER NOT NULL, deadline TEXT NOT NULL, terminal_sequence INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,id), FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE IF NOT EXISTS query_events (
  workspace_id TEXT NOT NULL, run_id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence>0), attempt_id TEXT NOT NULL, event_type TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(length(payload)<=262144), occurred_at TEXT NOT NULL, PRIMARY KEY(workspace_id,run_id,sequence),
  FOREIGN KEY(workspace_id,run_id) REFERENCES query_runs(workspace_id,id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE IF NOT EXISTS index_generations (
  workspace_id TEXT NOT NULL, id TEXT NOT NULL, vector_index TEXT NOT NULL, vector_namespace TEXT NOT NULL, sparse_schema_version INTEGER NOT NULL,
  embedding_fingerprint TEXT NOT NULL, source_manifest_hash TEXT NOT NULL CHECK(length(source_manifest_hash)=64), expected_count INTEGER NOT NULL,
  acknowledged_count INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL CHECK(state IN ('building','verifying','ready','active','quarantined','failed')),
  created_at TEXT NOT NULL, activated_at TEXT, PRIMARY KEY(workspace_id,id), FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE IF NOT EXISTS deletion_operations (
  workspace_id TEXT NOT NULL, id TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, tombstone_epoch INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','processing','partial','verified','failed')), created_at TEXT NOT NULL, verified_at TEXT,
  PRIMARY KEY(workspace_id,id), FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE IF NOT EXISTS deletion_targets (
  workspace_id TEXT NOT NULL, operation_id TEXT NOT NULL, target_kind TEXT NOT NULL, target_identity TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','deleted','verified','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0, last_error_code TEXT, verified_at TEXT, PRIMARY KEY(workspace_id,operation_id,target_kind,target_identity),
  FOREIGN KEY(workspace_id,operation_id) REFERENCES deletion_operations(workspace_id,id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE IF NOT EXISTS document_chunks (
  workspace_id TEXT NOT NULL, document_id TEXT NOT NULL, version_id TEXT NOT NULL, id TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK(ordinal>=0),
  original_text TEXT NOT NULL, original_content_hash TEXT NOT NULL CHECK(length(original_content_hash)=64), enrichment_text TEXT,
  location_json TEXT NOT NULL, extraction_json TEXT NOT NULL, point_id TEXT NOT NULL CHECK(length(point_id)=64), lifecycle_epoch INTEGER NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY(workspace_id,document_id,version_id,id), UNIQUE(workspace_id,document_id,version_id,ordinal), UNIQUE(point_id),
  FOREIGN KEY(workspace_id,document_id,version_id) REFERENCES document_versions(workspace_id,document_id,id) ON DELETE RESTRICT
) STRICT;
CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(original_text, content='document_chunks', content_rowid='rowid', tokenize='unicode61');
CREATE TABLE IF NOT EXISTS exact_terms (
  workspace_id TEXT NOT NULL, document_id TEXT NOT NULL, version_id TEXT NOT NULL, chunk_id TEXT NOT NULL, term TEXT NOT NULL,
  term_kind TEXT NOT NULL CHECK(term_kind IN ('identifier','number','date','code','unicode')), PRIMARY KEY(workspace_id,document_id,version_id,chunk_id,term,term_kind),
  FOREIGN KEY(workspace_id,document_id,version_id,chunk_id) REFERENCES document_chunks(workspace_id,document_id,version_id,id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_exact_terms_scope ON exact_terms(workspace_id,term,term_kind,document_id,version_id);
CREATE TABLE IF NOT EXISTS usage_reservations (
  workspace_id TEXT NOT NULL, id TEXT NOT NULL, actor_id TEXT NOT NULL, operation_id TEXT NOT NULL, reserved_tokens INTEGER NOT NULL CHECK(reserved_tokens>=0),
  settled_tokens INTEGER CHECK(settled_tokens IS NULL OR settled_tokens>=0), state TEXT NOT NULL CHECK(state IN ('reserved','settled','pending_reconciliation','released','expired')),
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(workspace_id,id), FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE IF NOT EXISTS usage_events (
  workspace_id TEXT NOT NULL, operation_id TEXT NOT NULL, attempt_id TEXT NOT NULL, stage TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  funding_principal TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, cost_microcurrency INTEGER, price_version TEXT,
  accounting_state TEXT NOT NULL CHECK(accounting_state IN ('known','estimated','pending','unknown')), created_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,operation_id,attempt_id,stage), FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT
) STRICT;
