// Generated from the connected Supabase schema. Do not edit manually.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      api_keys: {
        Row: {
          created_at: string
          credential_version: number
          encrypted_key: string
          encryption_key_version: string
          id: string
          is_active: boolean
          key_prefix: string | null
          last_used_at: string | null
          provider: string
          revoked_at: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          credential_version?: number
          encrypted_key: string
          encryption_key_version?: string
          id?: string
          is_active?: boolean
          key_prefix?: string | null
          last_used_at?: string | null
          provider: string
          revoked_at?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          credential_version?: number
          encrypted_key?: string
          encryption_key_version?: string
          id?: string
          is_active?: boolean
          key_prefix?: string | null
          last_used_at?: string | null
          provider?: string
          revoked_at?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json
          resource_id: string | null
          resource_type: string | null
          user_agent: string | null
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          resource_id?: string | null
          resource_type?: string | null
          user_agent?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          resource_id?: string | null
          resource_type?: string | null
          user_agent?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_reservations: {
        Row: {
          amount: number
          created_at: string
          dimension: string
          id: string
          idempotency_key: string
          measured: number | null
          provider_id: string
          reset_at: string | null
          settled_at: string | null
          state: string
          workspace_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          dimension: string
          id?: string
          idempotency_key: string
          measured?: number | null
          provider_id: string
          reset_at?: string | null
          settled_at?: string | null
          state?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          dimension?: string
          id?: string
          idempotency_key?: string
          measured?: number | null
          provider_id?: string
          reset_at?: string | null
          settled_at?: string | null
          state?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_reservations_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_reservations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cache_entries: {
        Row: {
          authorization_revision: number
          cache_key: string
          created_at: string
          expires_at: string
          model_revision: string
          operation: string
          payload: Json
          prompt_version: string
          rights_hash: string
          source_version_hashes: string[]
          workspace_id: string
          workspace_policy_hash: string
        }
        Insert: {
          authorization_revision: number
          cache_key: string
          created_at?: string
          expires_at: string
          model_revision: string
          operation: string
          payload: Json
          prompt_version: string
          rights_hash: string
          source_version_hashes: string[]
          workspace_id: string
          workspace_policy_hash: string
        }
        Update: {
          authorization_revision?: number
          cache_key?: string
          created_at?: string
          expires_at?: string
          model_revision?: string
          operation?: string
          payload?: Json
          prompt_version?: string
          rights_hash?: string
          source_version_hashes?: string[]
          workspace_id?: string
          workspace_policy_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "cache_entries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          message_order: number | null
          metadata: Json
          role: string
          run_id: string | null
          session_id: string
          sources: Json
          workspace_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          message_order?: number | null
          metadata?: Json
          role: string
          run_id?: string | null
          session_id: string
          sources?: Json
          workspace_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          message_order?: number | null
          metadata?: Json
          role?: string
          run_id?: string | null
          session_id?: string
          sources?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_run_tenant_fk"
            columns: ["workspace_id", "run_id"]
            isOneToOne: false
            referencedRelation: "query_runs"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "messages_tenant_session_fk"
            columns: ["workspace_id", "session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      chat_sessions: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          revision: number
          title: string | null
          updated_at: string
          user_id: string | null
          visibility: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          revision?: number
          title?: string | null
          updated_at?: string
          user_id?: string | null
          visibility?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          revision?: number
          title?: string | null
          updated_at?: string
          user_id?: string | null
          visibility?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          permission: string
          session_id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          permission: string
          session_id: string
          user_id: string
          workspace_id: string
        }
        Update: {
          permission?: string
          session_id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_workspace_id_session_id_fkey"
            columns: ["workspace_id", "session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "conversation_participants_workspace_id_user_id_fkey"
            columns: ["workspace_id", "user_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "user_id"]
          },
        ]
      }
      deletion_operations: {
        Row: {
          created_at: string
          id: string
          resource_id: string
          state: string
          tombstone_epoch: number
          verified_at: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          resource_id: string
          state?: string
          tombstone_epoch: number
          verified_at?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          resource_id?: string
          state?: string
          tombstone_epoch?: number
          verified_at?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      deletion_receipts: {
        Row: {
          id: string
          operation_id: string
          provider: string
          receipt_hash: string
          target_id: string
          verified_at: string
          workspace_id: string
        }
        Insert: {
          id?: string
          operation_id: string
          provider: string
          receipt_hash: string
          target_id: string
          verified_at: string
          workspace_id: string
        }
        Update: {
          id?: string
          operation_id?: string
          provider?: string
          receipt_hash?: string
          target_id?: string
          verified_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deletion_receipts_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "deletion_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deletion_receipts_workspace_id_operation_id_fkey"
            columns: ["workspace_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "deletion_operations"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      deletion_targets: {
        Row: {
          attempts: number
          bucket: string | null
          failure_code: string | null
          id: string
          inventory: Json
          kind: string
          next_attempt_at: string
          object_key: string | null
          operation_id: string
          resource_id: string | null
          verified_at: string | null
          workspace_id: string
        }
        Insert: {
          attempts?: number
          bucket?: string | null
          failure_code?: string | null
          id?: string
          inventory?: Json
          kind: string
          next_attempt_at?: string
          object_key?: string | null
          operation_id: string
          resource_id?: string | null
          verified_at?: string | null
          workspace_id: string
        }
        Update: {
          attempts?: number
          bucket?: string | null
          failure_code?: string | null
          id?: string
          inventory?: Json
          kind?: string
          next_attempt_at?: string
          object_key?: string | null
          operation_id?: string
          resource_id?: string | null
          verified_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deletion_targets_workspace_id_operation_id_fkey"
            columns: ["workspace_id", "operation_id"]
            isOneToOne: false
            referencedRelation: "deletion_operations"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      document_chunks: {
        Row: {
          chunk_index: number
          content: string
          content_hash: string | null
          created_at: string
          document_id: string
          embedding: string | null
          embedding_space_id: string | null
          enrichment_text: string | null
          id: string
          location: Json | null
          metadata: Json
          original_content_hash: string | null
          original_text: string | null
          page_number: number | null
          qdrant_point_id: string | null
          section_title: string | null
          token_count: number | null
          version_id: string | null
          workspace_id: string
        }
        Insert: {
          chunk_index: number
          content: string
          content_hash?: string | null
          created_at?: string
          document_id: string
          embedding?: string | null
          embedding_space_id?: string | null
          enrichment_text?: string | null
          id?: string
          location?: Json | null
          metadata?: Json
          original_content_hash?: string | null
          original_text?: string | null
          page_number?: number | null
          qdrant_point_id?: string | null
          section_title?: string | null
          token_count?: number | null
          version_id?: string | null
          workspace_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          content_hash?: string | null
          created_at?: string
          document_id?: string
          embedding?: string | null
          embedding_space_id?: string | null
          enrichment_text?: string | null
          id?: string
          location?: Json | null
          metadata?: Json
          original_content_hash?: string | null
          original_text?: string | null
          page_number?: number | null
          qdrant_point_id?: string | null
          section_title?: string | null
          token_count?: number | null
          version_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chunk_version_tenant_fk"
            columns: ["workspace_id", "document_id", "version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["workspace_id", "document_id", "id"]
          },
          {
            foreignKeyName: "chunks_tenant_document_fk"
            columns: ["workspace_id", "document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_chunks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      document_uploads: {
        Row: {
          actor_id: string
          begin_hash: string
          begin_key: string
          cleanup_state: string
          cleanup_verified_at: string | null
          complete_key: string | null
          content_type: string
          created_at: string
          document_id: string
          expected_bytes: number
          expires_at: string
          failed_at: string | null
          filename: string
          id: string
          job_id: string | null
          lifecycle_epoch: number
          original_bucket: string
          original_bytes: number | null
          original_hash: string | null
          original_key: string
          original_verified_at: string | null
          replacement: boolean
          state: string
          version_id: string
          workspace_id: string
          write_token: string | null
        }
        Insert: {
          actor_id: string
          begin_hash: string
          begin_key: string
          cleanup_state?: string
          cleanup_verified_at?: string | null
          complete_key?: string | null
          content_type: string
          created_at?: string
          document_id: string
          expected_bytes: number
          expires_at?: string
          failed_at?: string | null
          filename: string
          id?: string
          job_id?: string | null
          lifecycle_epoch: number
          original_bucket: string
          original_bytes?: number | null
          original_hash?: string | null
          original_key: string
          original_verified_at?: string | null
          replacement?: boolean
          state?: string
          version_id?: string
          workspace_id: string
          write_token?: string | null
        }
        Update: {
          actor_id?: string
          begin_hash?: string
          begin_key?: string
          cleanup_state?: string
          cleanup_verified_at?: string | null
          complete_key?: string | null
          content_type?: string
          created_at?: string
          document_id?: string
          expected_bytes?: number
          expires_at?: string
          failed_at?: string | null
          filename?: string
          id?: string
          job_id?: string | null
          lifecycle_epoch?: number
          original_bucket?: string
          original_bytes?: number | null
          original_hash?: string | null
          original_key?: string
          original_verified_at?: string | null
          replacement?: boolean
          state?: string
          version_id?: string
          workspace_id?: string
          write_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_uploads_workspace_id_document_id_fkey"
            columns: ["workspace_id", "document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "document_uploads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      document_versions: {
        Row: {
          chunker_version: string
          created_at: string
          document_id: string
          embedding_space_id: string | null
          extraction_manifest: Json
          failure_code: string | null
          id: string
          index_generation: string | null
          lifecycle_epoch: number
          original_bucket: string
          original_bytes: number
          original_hash: string
          original_key: string
          original_verified_at: string
          parser_version: string
          publication_state: string
          published_at: string | null
          staged_by_generation: number | null
          staged_manifest_hash: string | null
          workspace_id: string
        }
        Insert: {
          chunker_version: string
          created_at?: string
          document_id: string
          embedding_space_id?: string | null
          extraction_manifest?: Json
          failure_code?: string | null
          id?: string
          index_generation?: string | null
          lifecycle_epoch: number
          original_bucket: string
          original_bytes: number
          original_hash: string
          original_key: string
          original_verified_at: string
          parser_version: string
          publication_state?: string
          published_at?: string | null
          staged_by_generation?: number | null
          staged_manifest_hash?: string | null
          workspace_id: string
        }
        Update: {
          chunker_version?: string
          created_at?: string
          document_id?: string
          embedding_space_id?: string | null
          extraction_manifest?: Json
          failure_code?: string | null
          id?: string
          index_generation?: string | null
          lifecycle_epoch?: number
          original_bucket?: string
          original_bytes?: number
          original_hash?: string
          original_key?: string
          original_verified_at?: string
          parser_version?: string
          publication_state?: string
          published_at?: string | null
          staged_by_generation?: number | null
          staged_manifest_hash?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_workspace_id_document_id_fkey"
            columns: ["workspace_id", "document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      documents: {
        Row: {
          active_version_id: string | null
          chunk_count: number
          content_type: string | null
          created_at: string
          error_message: string | null
          file_size_bytes: number
          filename: string
          id: string
          lifecycle_epoch: number
          lifecycle_state: string
          original_filename: string
          page_count: number
          revision: number
          sha256: string | null
          status: string
          storage_bucket: string
          storage_path: string | null
          updated_at: string
          uploaded_by: string
          workspace_id: string
        }
        Insert: {
          active_version_id?: string | null
          chunk_count?: number
          content_type?: string | null
          created_at?: string
          error_message?: string | null
          file_size_bytes?: number
          filename: string
          id?: string
          lifecycle_epoch?: number
          lifecycle_state?: string
          original_filename: string
          page_count?: number
          revision?: number
          sha256?: string | null
          status?: string
          storage_bucket?: string
          storage_path?: string | null
          updated_at?: string
          uploaded_by: string
          workspace_id: string
        }
        Update: {
          active_version_id?: string | null
          chunk_count?: number
          content_type?: string | null
          created_at?: string
          error_message?: string | null
          file_size_bytes?: number
          filename?: string
          id?: string
          lifecycle_epoch?: number
          lifecycle_state?: string
          original_filename?: string
          page_count?: number
          revision?: number
          sha256?: string | null
          status?: string
          storage_bucket?: string
          storage_path?: string | null
          updated_at?: string
          uploaded_by?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "active_version_tenant_fk"
            columns: ["workspace_id", "id", "active_version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["workspace_id", "document_id", "id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      eval_results: {
        Row: {
          answer: string | null
          created_at: string
          eval_run_id: string
          expected_answer: string | null
          expected_sources: Json
          id: string
          metrics: Json
          passed: boolean | null
          question: string
          sources: Json
          workspace_id: string
        }
        Insert: {
          answer?: string | null
          created_at?: string
          eval_run_id: string
          expected_answer?: string | null
          expected_sources?: Json
          id?: string
          metrics?: Json
          passed?: boolean | null
          question: string
          sources?: Json
          workspace_id: string
        }
        Update: {
          answer?: string | null
          created_at?: string
          eval_run_id?: string
          expected_answer?: string | null
          expected_sources?: Json
          id?: string
          metrics?: Json
          passed?: boolean | null
          question?: string
          sources?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eval_results_eval_run_id_fkey"
            columns: ["eval_run_id"]
            isOneToOne: false
            referencedRelation: "eval_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eval_results_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      eval_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          metrics: Json
          mode: string
          name: string
          status: string
          updated_at: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          metrics?: Json
          mode?: string
          name: string
          status?: string
          updated_at?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          metrics?: Json
          mode?: string
          name?: string
          status?: string
          updated_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eval_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eval_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_exports: {
        Row: {
          attribution: string[]
          created_at: string
          expires_at: string | null
          format: string
          id: string
          manifest_hash: string | null
          requested_by: string
          state: string
          workspace_id: string
        }
        Insert: {
          attribution?: string[]
          created_at?: string
          expires_at?: string | null
          format: string
          id?: string
          manifest_hash?: string | null
          requested_by: string
          state?: string
          workspace_id: string
        }
        Update: {
          attribution?: string[]
          created_at?: string
          expires_at?: string | null
          format?: string
          id?: string
          manifest_hash?: string | null
          requested_by?: string
          state?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_exports_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_items: {
        Row: {
          attribution: string[]
          claim_state: string
          confidence: number
          created_at: string
          evidence_type: string
          exact_hash: string
          id: string
          locator: Json
          source_version_id: string
          workspace_id: string
        }
        Insert: {
          attribution?: string[]
          claim_state: string
          confidence: number
          created_at?: string
          evidence_type: string
          exact_hash: string
          id?: string
          locator: Json
          source_version_id: string
          workspace_id: string
        }
        Update: {
          attribution?: string[]
          claim_state?: string
          confidence?: number
          created_at?: string
          evidence_type?: string
          exact_hash?: string
          id?: string
          locator?: Json
          source_version_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_items_workspace_id_source_version_id_fkey"
            columns: ["workspace_id", "source_version_id"]
            isOneToOne: false
            referencedRelation: "evidence_source_versions"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      evidence_source_versions: {
        Row: {
          attribution: string[]
          content_hash: string
          id: string
          metadata: Json
          recorded_at: string
          retrieved_at: string
          rights_hash: string
          source_id: string
          supersedes_id: string | null
          valid_from: string | null
          valid_to: string | null
          version_key: string
          workspace_id: string
        }
        Insert: {
          attribution?: string[]
          content_hash: string
          id?: string
          metadata?: Json
          recorded_at?: string
          retrieved_at: string
          rights_hash: string
          source_id: string
          supersedes_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
          version_key: string
          workspace_id: string
        }
        Update: {
          attribution?: string[]
          content_hash?: string
          id?: string
          metadata?: Json
          recorded_at?: string
          retrieved_at?: string
          rights_hash?: string
          source_id?: string
          supersedes_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
          version_key?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_source_versions_workspace_id_source_id_fkey"
            columns: ["workspace_id", "source_id"]
            isOneToOne: false
            referencedRelation: "evidence_sources"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "evidence_source_versions_workspace_id_supersedes_id_fkey"
            columns: ["workspace_id", "supersedes_id"]
            isOneToOne: false
            referencedRelation: "evidence_source_versions"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      evidence_sources: {
        Row: {
          authority: string | null
          canonical_uri: string
          created_at: string
          id: string
          lifecycle_state: string
          provider_id: string | null
          rights_hash: string
          source_kind: string
          title: string
          workspace_id: string
        }
        Insert: {
          authority?: string | null
          canonical_uri: string
          created_at?: string
          id?: string
          lifecycle_state?: string
          provider_id?: string | null
          rights_hash: string
          source_kind: string
          title: string
          workspace_id: string
        }
        Update: {
          authority?: string | null
          canonical_uri?: string
          created_at?: string
          id?: string
          lifecycle_state?: string
          provider_id?: string | null
          rights_hash?: string
          source_kind?: string
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_sources_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_sources_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finding_participants: {
        Row: {
          finding_id: string
          permission: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          finding_id: string
          permission: string
          user_id: string
          workspace_id: string
        }
        Update: {
          finding_id?: string
          permission?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finding_participants_workspace_id_finding_id_fkey"
            columns: ["workspace_id", "finding_id"]
            isOneToOne: false
            referencedRelation: "findings"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "finding_participants_workspace_id_user_id_fkey"
            columns: ["workspace_id", "user_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "user_id"]
          },
        ]
      }
      finding_reviews: {
        Row: {
          comment: string
          created_at: string
          decision: string
          finding_id: string
          id: string
          reviewer_id: string
          revision: number
          workspace_id: string
        }
        Insert: {
          comment: string
          created_at?: string
          decision: string
          finding_id: string
          id?: string
          reviewer_id: string
          revision: number
          workspace_id: string
        }
        Update: {
          comment?: string
          created_at?: string
          decision?: string
          finding_id?: string
          id?: string
          reviewer_id?: string
          revision?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finding_reviews_workspace_id_finding_id_revision_fkey"
            columns: ["workspace_id", "finding_id", "revision"]
            isOneToOne: false
            referencedRelation: "finding_versions"
            referencedColumns: ["workspace_id", "finding_id", "revision"]
          },
        ]
      }
      finding_versions: {
        Row: {
          author_id: string
          authored_markdown: string
          created_at: string
          finding_id: string
          generated_markdown: string | null
          redacted_at: string | null
          revision: number
          title: string
          workspace_id: string
        }
        Insert: {
          author_id: string
          authored_markdown: string
          created_at?: string
          finding_id: string
          generated_markdown?: string | null
          redacted_at?: string | null
          revision: number
          title: string
          workspace_id: string
        }
        Update: {
          author_id?: string
          authored_markdown?: string
          created_at?: string
          finding_id?: string
          generated_markdown?: string | null
          redacted_at?: string | null
          revision?: number
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finding_versions_workspace_id_finding_id_fkey"
            columns: ["workspace_id", "finding_id"]
            isOneToOne: false
            referencedRelation: "findings"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      findings: {
        Row: {
          create_key: string
          created_at: string
          deleted_at: string | null
          id: string
          owner_id: string
          payload_hash: string
          revision: number
          source_run_id: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          create_key: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          owner_id: string
          payload_hash: string
          revision?: number
          source_run_id?: string | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          create_key?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          owner_id?: string
          payload_hash?: string
          revision?: number
          source_run_id?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "findings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "findings_workspace_id_source_run_id_fkey"
            columns: ["workspace_id", "source_run_id"]
            isOneToOne: false
            referencedRelation: "query_runs"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      graph_aliases: {
        Row: {
          alias: string
          entity_id: string
          source_version_id: string
          workspace_id: string
        }
        Insert: {
          alias: string
          entity_id: string
          source_version_id: string
          workspace_id: string
        }
        Update: {
          alias?: string
          entity_id?: string
          source_version_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "graph_aliases_workspace_id_entity_id_fkey"
            columns: ["workspace_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "graph_entities"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "graph_aliases_workspace_id_source_version_id_fkey"
            columns: ["workspace_id", "source_version_id"]
            isOneToOne: false
            referencedRelation: "evidence_source_versions"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      graph_entities: {
        Row: {
          canonical_id: string
          confidence: number
          entity_type: string
          id: string
          jurisdiction: string | null
          recorded_at: string
          resolution_method: string
          review_state: string
          supersedes_id: string | null
          valid_from: string | null
          valid_to: string | null
          workspace_id: string
        }
        Insert: {
          canonical_id: string
          confidence: number
          entity_type: string
          id?: string
          jurisdiction?: string | null
          recorded_at?: string
          resolution_method: string
          review_state?: string
          supersedes_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
          workspace_id: string
        }
        Update: {
          canonical_id?: string
          confidence?: number
          entity_type?: string
          id?: string
          jurisdiction?: string | null
          recorded_at?: string
          resolution_method?: string
          review_state?: string
          supersedes_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "graph_entities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "graph_entities_workspace_id_supersedes_id_fkey"
            columns: ["workspace_id", "supersedes_id"]
            isOneToOne: false
            referencedRelation: "graph_entities"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      graph_relationships: {
        Row: {
          confidence: number
          contradiction_state: string
          evidence_item_id: string
          id: string
          recorded_at: string
          relationship_type: string
          resolution_method: string
          review_state: string
          reviewed_by: string | null
          source_entity_id: string
          target_entity_id: string
          valid_from: string | null
          valid_to: string | null
          workspace_id: string
        }
        Insert: {
          confidence: number
          contradiction_state?: string
          evidence_item_id: string
          id?: string
          recorded_at?: string
          relationship_type: string
          resolution_method: string
          review_state?: string
          reviewed_by?: string | null
          source_entity_id: string
          target_entity_id: string
          valid_from?: string | null
          valid_to?: string | null
          workspace_id: string
        }
        Update: {
          confidence?: number
          contradiction_state?: string
          evidence_item_id?: string
          id?: string
          recorded_at?: string
          relationship_type?: string
          resolution_method?: string
          review_state?: string
          reviewed_by?: string | null
          source_entity_id?: string
          target_entity_id?: string
          valid_from?: string | null
          valid_to?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "graph_relationships_workspace_id_evidence_item_id_fkey"
            columns: ["workspace_id", "evidence_item_id"]
            isOneToOne: false
            referencedRelation: "evidence_items"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "graph_relationships_workspace_id_source_entity_id_fkey"
            columns: ["workspace_id", "source_entity_id"]
            isOneToOne: false
            referencedRelation: "graph_entities"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "graph_relationships_workspace_id_target_entity_id_fkey"
            columns: ["workspace_id", "target_entity_id"]
            isOneToOne: false
            referencedRelation: "graph_entities"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      ingestion_jobs: {
        Row: {
          attempts: number
          available_at: string
          cancellation_requested_at: string | null
          completed_at: string | null
          created_at: string
          document_id: string | null
          error_code: string | null
          error_message: string | null
          heartbeat_at: string | null
          id: string
          kind: string
          last_error_at: string | null
          lease_expires_at: string | null
          lease_generation: number
          lease_owner: string | null
          lifecycle_epoch: number
          max_attempts: number
          payload: Json
          progress: number
          stage: string | null
          started_at: string | null
          status: string
          updated_at: string
          version_id: string | null
          workspace_id: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          cancellation_requested_at?: string | null
          completed_at?: string | null
          created_at?: string
          document_id?: string | null
          error_code?: string | null
          error_message?: string | null
          heartbeat_at?: string | null
          id?: string
          kind?: string
          last_error_at?: string | null
          lease_expires_at?: string | null
          lease_generation?: number
          lease_owner?: string | null
          lifecycle_epoch?: number
          max_attempts?: number
          payload?: Json
          progress?: number
          stage?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          version_id?: string | null
          workspace_id: string
        }
        Update: {
          attempts?: number
          available_at?: string
          cancellation_requested_at?: string | null
          completed_at?: string | null
          created_at?: string
          document_id?: string | null
          error_code?: string | null
          error_message?: string | null
          heartbeat_at?: string | null
          id?: string
          kind?: string
          last_error_at?: string | null
          lease_expires_at?: string | null
          lease_generation?: number
          lease_owner?: string | null
          lifecycle_epoch?: number
          max_attempts?: number
          payload?: Json
          progress?: number
          stage?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          version_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingestion_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_version_tenant_fk"
            columns: ["workspace_id", "document_id", "version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["workspace_id", "document_id", "id"]
          },
          {
            foreignKeyName: "jobs_tenant_document_fk"
            columns: ["workspace_id", "document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      llm_usage_events: {
        Row: {
          cost_microusd: number | null
          created_at: string
          error_code: string | null
          id: string
          input_tokens: number | null
          latency_ms: number | null
          model: string | null
          operation: string | null
          output_tokens: number | null
          provider: string | null
          success: boolean
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          cost_microusd?: number | null
          created_at?: string
          error_code?: string | null
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          operation?: string | null
          output_tokens?: number | null
          provider?: string | null
          success?: boolean
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          cost_microusd?: number | null
          created_at?: string
          error_code?: string | null
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          operation?: string | null
          output_tokens?: number | null
          provider?: string | null
          success?: boolean
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "llm_usage_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "llm_usage_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      materializations: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          materialized_records: number
          provider_id: string
          reconstructible: boolean
          selection_logic: Json
          source_hash: string
          source_version_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          materialized_records: number
          provider_id: string
          reconstructible?: boolean
          selection_logic: Json
          source_hash: string
          source_version_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          materialized_records?: number
          provider_id?: string
          reconstructible?: boolean
          selection_logic?: Json
          source_hash?: string
          source_version_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "materializations_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materializations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materializations_workspace_id_source_version_id_fkey"
            columns: ["workspace_id", "source_version_id"]
            isOneToOne: false
            referencedRelation: "evidence_source_versions"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      monitor_runs: {
        Row: {
          completed_at: string | null
          current_hash: string | null
          id: string
          materiality: string | null
          metadata: Json
          monitor_id: string
          previous_hash: string | null
          started_at: string
          status: string
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          current_hash?: string | null
          id?: string
          materiality?: string | null
          metadata?: Json
          monitor_id: string
          previous_hash?: string | null
          started_at?: string
          status: string
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          current_hash?: string | null
          id?: string
          materiality?: string | null
          metadata?: Json
          monitor_id?: string
          previous_hash?: string | null
          started_at?: string
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monitor_runs_workspace_id_monitor_id_fkey"
            columns: ["workspace_id", "monitor_id"]
            isOneToOne: false
            referencedRelation: "monitors"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      monitors: {
        Row: {
          created_at: string
          enabled: boolean
          etag: string | null
          id: string
          last_content_hash: string | null
          last_modified: string | null
          next_run_at: string | null
          owner_id: string
          provider_id: string
          retrieval_method: string
          state: string
          target_uri: string
          tier: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          etag?: string | null
          id?: string
          last_content_hash?: string | null
          last_modified?: string | null
          next_run_at?: string | null
          owner_id: string
          provider_id: string
          retrieval_method: string
          state?: string
          target_uri: string
          tier: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          etag?: string | null
          id?: string
          last_content_hash?: string | null
          last_modified?: string | null
          next_run_at?: string | null
          owner_id?: string
          provider_id?: string
          retrieval_method?: string
          state?: string
          target_uri?: string
          tier?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monitors_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monitors_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      provider_health_state: {
        Row: {
          circuit_open_until: string | null
          consecutive_failures: number
          last_error_code: string | null
          mode: string
          model: string
          provider: string
          quota_exhausted: boolean
          updated_at: string
          workspace_id: string
        }
        Insert: {
          circuit_open_until?: string | null
          consecutive_failures?: number
          last_error_code?: string | null
          mode: string
          model: string
          provider: string
          quota_exhausted?: boolean
          updated_at?: string
          workspace_id: string
        }
        Update: {
          circuit_open_until?: string | null
          consecutive_failures?: number
          last_error_code?: string | null
          mode?: string
          model?: string
          provider?: string
          quota_exhausted?: boolean
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_health_state_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_registry: {
        Row: {
          attribution: string[]
          authentication: Json
          authority: string
          bulk_path: string | null
          created_at: string
          deprecation: Json
          display_name: string
          documentation_url: string
          fallback: string | null
          freshness: Json
          historical_coverage: Json
          id: string
          incremental_path: string | null
          jurisdiction: string | null
          licence: string | null
          pagination: Json
          paid_migration_path: string | null
          pricing_url: string | null
          privacy: Json
          quota: Json
          review_owner: string | null
          revision: number
          rights: Json
          schema_version: string | null
          self_host_option: string | null
          sensitive_data: Json
          stable_identifiers: string[]
          status: string
          terms_checked_at: string | null
          terms_hash: string | null
          terms_url: string
          updated_at: string
        }
        Insert: {
          attribution?: string[]
          authentication?: Json
          authority: string
          bulk_path?: string | null
          created_at?: string
          deprecation?: Json
          display_name: string
          documentation_url: string
          fallback?: string | null
          freshness?: Json
          historical_coverage?: Json
          id: string
          incremental_path?: string | null
          jurisdiction?: string | null
          licence?: string | null
          pagination?: Json
          paid_migration_path?: string | null
          pricing_url?: string | null
          privacy?: Json
          quota?: Json
          review_owner?: string | null
          revision?: number
          rights?: Json
          schema_version?: string | null
          self_host_option?: string | null
          sensitive_data?: Json
          stable_identifiers?: string[]
          status?: string
          terms_checked_at?: string | null
          terms_hash?: string | null
          terms_url: string
          updated_at?: string
        }
        Update: {
          attribution?: string[]
          authentication?: Json
          authority?: string
          bulk_path?: string | null
          created_at?: string
          deprecation?: Json
          display_name?: string
          documentation_url?: string
          fallback?: string | null
          freshness?: Json
          historical_coverage?: Json
          id?: string
          incremental_path?: string | null
          jurisdiction?: string | null
          licence?: string | null
          pagination?: Json
          paid_migration_path?: string | null
          pricing_url?: string | null
          privacy?: Json
          quota?: Json
          review_owner?: string | null
          revision?: number
          rights?: Json
          schema_version?: string | null
          self_host_option?: string | null
          sensitive_data?: Json
          stable_identifiers?: string[]
          status?: string
          terms_checked_at?: string | null
          terms_hash?: string | null
          terms_url?: string
          updated_at?: string
        }
        Relationships: []
      }
      provider_terms_snapshots: {
        Row: {
          approved_by: string | null
          checked_at: string
          content_hash: string
          etag: string | null
          id: string
          last_modified: string | null
          materiality: string
          provider_id: string
          retrieval_method: string
          revision: number
          terms: Json
        }
        Insert: {
          approved_by?: string | null
          checked_at: string
          content_hash: string
          etag?: string | null
          id?: string
          last_modified?: string | null
          materiality: string
          provider_id: string
          retrieval_method: string
          revision: number
          terms: Json
        }
        Update: {
          approved_by?: string | null
          checked_at?: string
          content_hash?: string
          etag?: string | null
          id?: string
          last_modified?: string | null
          materiality?: string
          provider_id?: string
          retrieval_method?: string
          revision?: number
          terms?: Json
        }
        Relationships: [
          {
            foreignKeyName: "provider_terms_snapshots_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      query_events: {
        Row: {
          attempt_id: string
          event_hash: string
          event_id: string
          event_type: string
          occurred_at: string
          payload: Json
          redacted_at: string | null
          run_id: string
          sequence: number
          workspace_id: string
        }
        Insert: {
          attempt_id: string
          event_hash: string
          event_id: string
          event_type: string
          occurred_at?: string
          payload: Json
          redacted_at?: string | null
          run_id: string
          sequence: number
          workspace_id: string
        }
        Update: {
          attempt_id?: string
          event_hash?: string
          event_id?: string
          event_type?: string
          occurred_at?: string
          payload?: Json
          redacted_at?: string | null
          run_id?: string
          sequence?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "query_events_workspace_id_run_id_fkey"
            columns: ["workspace_id", "run_id"]
            isOneToOne: false
            referencedRelation: "query_runs"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      query_run_sources: {
        Row: {
          document_id: string
          lifecycle_epoch: number
          run_id: string
          version_id: string
          workspace_id: string
        }
        Insert: {
          document_id: string
          lifecycle_epoch: number
          run_id: string
          version_id: string
          workspace_id: string
        }
        Update: {
          document_id?: string
          lifecycle_epoch?: number
          run_id?: string
          version_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "query_run_sources_workspace_id_document_id_version_id_fkey"
            columns: ["workspace_id", "document_id", "version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["workspace_id", "document_id", "id"]
          },
          {
            foreignKeyName: "query_run_sources_workspace_id_run_id_fkey"
            columns: ["workspace_id", "run_id"]
            isOneToOne: false
            referencedRelation: "query_runs"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      query_runs: {
        Row: {
          accounting_state: string
          attempt_id: string
          cancellation_requested_at: string | null
          completed_at: string | null
          context: Json
          created_at: string
          deadline: string
          final_answer: Json | null
          id: string
          idempotency_key: string
          job_id: string
          last_observed_at: string
          next_sequence: number
          payload_hash: string
          persistence_state: string
          request: Json
          reservation_id: string
          session_id: string
          state: string
          turn_order: number
          user_id: string
          workspace_id: string
        }
        Insert: {
          accounting_state?: string
          attempt_id?: string
          cancellation_requested_at?: string | null
          completed_at?: string | null
          context: Json
          created_at?: string
          deadline: string
          final_answer?: Json | null
          id?: string
          idempotency_key: string
          job_id: string
          last_observed_at?: string
          next_sequence?: number
          payload_hash: string
          persistence_state?: string
          request: Json
          reservation_id: string
          session_id: string
          state?: string
          turn_order?: number
          user_id: string
          workspace_id: string
        }
        Update: {
          accounting_state?: string
          attempt_id?: string
          cancellation_requested_at?: string | null
          completed_at?: string | null
          context?: Json
          created_at?: string
          deadline?: string
          final_answer?: Json | null
          id?: string
          idempotency_key?: string
          job_id?: string
          last_observed_at?: string
          next_sequence?: number
          payload_hash?: string
          persistence_state?: string
          request?: Json
          reservation_id?: string
          session_id?: string
          state?: string
          turn_order?: number
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "query_runs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "ingestion_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "query_runs_workspace_id_job_id_fkey"
            columns: ["workspace_id", "job_id"]
            isOneToOne: false
            referencedRelation: "ingestion_jobs"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "query_runs_workspace_id_reservation_id_fkey"
            columns: ["workspace_id", "reservation_id"]
            isOneToOne: false
            referencedRelation: "usage_reservations"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "query_runs_workspace_id_session_id_fkey"
            columns: ["workspace_id", "session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      resource_budgets: {
        Row: {
          dimension: string
          hard_limit: number
          provider_id: string
          reserved: number
          reset_at: string | null
          revision: number
          scope_key: string
          state: string
          updated_at: string
          used: number
          window_kind: string
          workspace_id: string | null
        }
        Insert: {
          dimension: string
          hard_limit: number
          provider_id: string
          reserved?: number
          reset_at?: string | null
          revision?: number
          scope_key: string
          state?: string
          updated_at?: string
          used?: number
          window_kind: string
          workspace_id?: string | null
        }
        Update: {
          dimension?: string
          hard_limit?: number
          provider_id?: string
          reserved?: number
          reset_at?: string | null
          revision?: number
          scope_key?: string
          state?: string
          updated_at?: string
          used?: number
          window_kind?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resource_budgets_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_budgets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      rights_decisions: {
        Row: {
          action: string
          actor_id: string | null
          decided_at: string
          decision: string
          duties: string[]
          id: string
          provider_id: string
          provider_revision: number
          reason_code: string
          request_id: string | null
          rights_hash: string
          workspace_id: string
          workspace_policy_version: number | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          decided_at?: string
          decision: string
          duties?: string[]
          id?: string
          provider_id: string
          provider_revision: number
          reason_code: string
          request_id?: string | null
          rights_hash: string
          workspace_id: string
          workspace_policy_version?: number | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          decided_at?: string
          decision?: string
          duties?: string[]
          id?: string
          provider_id?: string
          provider_revision?: number
          reason_code?: string
          request_id?: string | null
          rights_hash?: string
          workspace_id?: string
          workspace_policy_version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rights_decisions_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rights_decisions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_ledger: {
        Row: {
          actor_id: string
          attempt_id: string
          cost_microusd: number | null
          created_at: string
          funding_principal: string
          id: string
          input_tokens: number | null
          measurement: string
          model: string
          output_tokens: number | null
          price_table_version: string | null
          provider: string
          reservation_id: string
          state: string
          workspace_id: string
        }
        Insert: {
          actor_id: string
          attempt_id: string
          cost_microusd?: number | null
          created_at?: string
          funding_principal: string
          id?: string
          input_tokens?: number | null
          measurement?: string
          model: string
          output_tokens?: number | null
          price_table_version?: string | null
          provider: string
          reservation_id: string
          state?: string
          workspace_id: string
        }
        Update: {
          actor_id?: string
          attempt_id?: string
          cost_microusd?: number | null
          created_at?: string
          funding_principal?: string
          id?: string
          input_tokens?: number | null
          measurement?: string
          model?: string
          output_tokens?: number | null
          price_table_version?: string | null
          provider?: string
          reservation_id?: string
          state?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_ledger_workspace_id_reservation_id_fkey"
            columns: ["workspace_id", "reservation_id"]
            isOneToOne: false
            referencedRelation: "usage_reservations"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      usage_reservations: {
        Row: {
          actor_id: string
          charge_period: string
          created_at: string
          expires_at: string
          id: string
          operation_id: string
          reserved_queries: number
          reserved_tokens: number
          state: string
          workspace_id: string
        }
        Insert: {
          actor_id: string
          charge_period?: string
          created_at?: string
          expires_at: string
          id?: string
          operation_id: string
          reserved_queries: number
          reserved_tokens: number
          state: string
          workspace_id: string
        }
        Update: {
          actor_id?: string
          charge_period?: string
          created_at?: string
          expires_at?: string
          id?: string
          operation_id?: string
          reserved_queries?: number
          reserved_tokens?: number
          state?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_reservations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workbench_mutations: {
        Row: {
          actor_id: string
          created_at: string
          idempotency_key: string
          operation: string
          payload_hash: string
          response: Json
          workspace_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          idempotency_key: string
          operation: string
          payload_hash: string
          response: Json
          workspace_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          idempotency_key?: string
          operation?: string
          payload_hash?: string
          response?: Json
          workspace_id?: string
        }
        Relationships: []
      }
      workbench_outbox: {
        Row: {
          aggregate_id: string
          aggregate_version: number
          attempts: number
          created_at: string
          delivered_at: string | null
          event_type: string
          id: string
          next_attempt_at: string
          payload: Json
          workspace_id: string
        }
        Insert: {
          aggregate_id: string
          aggregate_version: number
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_type: string
          id?: string
          next_attempt_at?: string
          payload?: Json
          workspace_id: string
        }
        Update: {
          aggregate_id?: string
          aggregate_version?: number
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_type?: string
          id?: string
          next_attempt_at?: string
          payload?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workbench_outbox_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          role: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_policy_versions: {
        Row: {
          created_at: string
          id: string
          policy: Json
          version: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          policy: Json
          version: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          policy?: Json
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_policy_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_provider_policies: {
        Row: {
          allowed_actions: string[]
          duties: string[]
          policy_version: number
          prohibited_actions: string[]
          provider_id: string
          review_actions: string[]
          reviewed_at: string | null
          reviewed_by: string | null
          rights_hash: string
          status: string
          workspace_id: string
        }
        Insert: {
          allowed_actions?: string[]
          duties?: string[]
          policy_version?: number
          prohibited_actions?: string[]
          provider_id: string
          review_actions?: string[]
          reviewed_at?: string | null
          reviewed_by?: string | null
          rights_hash: string
          status?: string
          workspace_id: string
        }
        Update: {
          allowed_actions?: string[]
          duties?: string[]
          policy_version?: number
          prohibited_actions?: string[]
          provider_id?: string
          review_actions?: string[]
          reviewed_at?: string | null
          reviewed_by?: string | null
          rights_hash?: string
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_provider_policies_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_provider_policies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_settings: {
        Row: {
          active_policy_id: string | null
          chunk_overlap: number
          chunk_size: number
          context_window_messages: number
          created_at: string
          default_model: string
          embedding_model: string
          enable_contextual_enrichment: boolean
          enable_query_expansion: boolean
          enable_reranking: boolean
          enable_semantic_chunking: boolean
          hybrid_search_alpha: number
          last_retention_at: string | null
          llm_temperature: number
          next_retention_at: string | null
          policy_version: number
          retention_days: number
          retention_enabled: boolean
          retention_lease_expires_at: string | null
          retention_lease_owner: string | null
          retrieval_top_k: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active_policy_id?: string | null
          chunk_overlap?: number
          chunk_size?: number
          context_window_messages?: number
          created_at?: string
          default_model?: string
          embedding_model?: string
          enable_contextual_enrichment?: boolean
          enable_query_expansion?: boolean
          enable_reranking?: boolean
          enable_semantic_chunking?: boolean
          hybrid_search_alpha?: number
          last_retention_at?: string | null
          llm_temperature?: number
          next_retention_at?: string | null
          policy_version?: number
          retention_days?: number
          retention_enabled?: boolean
          retention_lease_expires_at?: string | null
          retention_lease_owner?: string | null
          retrieval_top_k?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          active_policy_id?: string | null
          chunk_overlap?: number
          chunk_size?: number
          context_window_messages?: number
          created_at?: string
          default_model?: string
          embedding_model?: string
          enable_contextual_enrichment?: boolean
          enable_query_expansion?: boolean
          enable_reranking?: boolean
          enable_semantic_chunking?: boolean
          hybrid_search_alpha?: number
          last_retention_at?: string | null
          llm_temperature?: number
          next_retention_at?: string | null
          policy_version?: number
          retention_days?: number
          retention_enabled?: boolean
          retention_lease_expires_at?: string | null
          retention_lease_owner?: string | null
          retrieval_top_k?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "settings_policy_tenant_fk"
            columns: ["workspace_id", "active_policy_id"]
            isOneToOne: false
            referencedRelation: "workspace_policy_versions"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "workspace_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_usage_daily: {
        Row: {
          estimated_cost_microusd: number | null
          failed_calls: number
          input_tokens: number
          output_tokens: number
          query_count: number
          reconciled_at: string
          successful_calls: number
          total_tokens: number
          usage_date: string
          workspace_id: string
        }
        Insert: {
          estimated_cost_microusd?: number | null
          failed_calls?: number
          input_tokens?: number
          output_tokens?: number
          query_count?: number
          reconciled_at?: string
          successful_calls?: number
          total_tokens?: number
          usage_date: string
          workspace_id: string
        }
        Update: {
          estimated_cost_microusd?: number | null
          failed_calls?: number
          input_tokens?: number
          output_tokens?: number
          query_count?: number
          reconciled_at?: string
          successful_calls?: number
          total_tokens?: number
          usage_date?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_usage_daily_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          capability_revision: number
          created_at: string
          id: string
          lifecycle_state: string
          name: string
          owner_id: string
          plan: string
          slug: string
          updated_at: string
        }
        Insert: {
          capability_revision?: number
          created_at?: string
          id?: string
          lifecycle_state?: string
          name: string
          owner_id: string
          plan?: string
          slug: string
          updated_at?: string
        }
        Update: {
          capability_revision?: number
          created_at?: string
          id?: string
          lifecycle_state?: string
          name?: string
          owner_id?: string
          plan?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_workspace_key: {
        Args: {
          p_actor: string
          p_ciphertext: string
          p_label: string
          p_provider: string
          p_workspace: string
        }
        Returns: string
      }
      append_chat_turn: {
        Args: {
          p_actor: string
          p_answer: string
          p_metadata: Json
          p_question: string
          p_session: string
          p_sources: Json
          p_workspace: string
        }
        Returns: undefined
      }
      assert_workbench_lease: {
        Args: {
          p_epoch: number
          p_generation: number
          p_job: string
          p_owner: string
          p_version: string
          p_workspace: string
        }
        Returns: {
          attempts: number
          available_at: string
          cancellation_requested_at: string | null
          completed_at: string | null
          created_at: string
          document_id: string | null
          error_code: string | null
          error_message: string | null
          heartbeat_at: string | null
          id: string
          kind: string
          last_error_at: string | null
          lease_expires_at: string | null
          lease_generation: number
          lease_owner: string | null
          lifecycle_epoch: number
          max_attempts: number
          payload: Json
          progress: number
          stage: string | null
          started_at: string | null
          status: string
          updated_at: string
          version_id: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ingestion_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_expired_document_uploads: {
        Args: { p_limit?: number }
        Returns: {
          bucket_id: string
          object_name: string
          upload_id: string
          workspace_id: string
        }[]
      }
      claim_ingestion_job: {
        Args: {
          p_lease_seconds?: number
          p_worker_id: string
          p_workspace_id?: string
        }
        Returns: {
          attempts: number
          available_at: string
          cancellation_requested_at: string | null
          completed_at: string | null
          created_at: string
          document_id: string | null
          error_code: string | null
          error_message: string | null
          heartbeat_at: string | null
          id: string
          kind: string
          last_error_at: string | null
          lease_expires_at: string | null
          lease_generation: number
          lease_owner: string | null
          lifecycle_epoch: number
          max_attempts: number
          payload: Json
          progress: number
          stage: string | null
          started_at: string | null
          status: string
          updated_at: string
          version_id: string | null
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ingestion_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_retention_schedules: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_worker_id: string
        }
        Returns: {
          active_policy_id: string | null
          chunk_overlap: number
          chunk_size: number
          context_window_messages: number
          created_at: string
          default_model: string
          embedding_model: string
          enable_contextual_enrichment: boolean
          enable_query_expansion: boolean
          enable_reranking: boolean
          enable_semantic_chunking: boolean
          hybrid_search_alpha: number
          last_retention_at: string | null
          llm_temperature: number
          next_retention_at: string | null
          policy_version: number
          retention_days: number
          retention_enabled: boolean
          retention_lease_expires_at: string | null
          retention_lease_owner: string | null
          retrieval_top_k: number
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "workspace_settings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_workbench_job: {
        Args: { p_kinds: string[]; p_lease_seconds?: number; p_owner: string }
        Returns: {
          attempts: number
          available_at: string
          cancellation_requested_at: string | null
          completed_at: string | null
          created_at: string
          document_id: string | null
          error_code: string | null
          error_message: string | null
          heartbeat_at: string | null
          id: string
          kind: string
          last_error_at: string | null
          lease_expires_at: string | null
          lease_generation: number
          lease_owner: string | null
          lifecycle_epoch: number
          max_attempts: number
          payload: Json
          progress: number
          stage: string | null
          started_at: string | null
          status: string
          updated_at: string
          version_id: string | null
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ingestion_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      clear_private_session: {
        Args: { p_actor: string; p_session: string; p_workspace: string }
        Returns: number
      }
      evaluate_provider_rights: {
        Args: { p_action: string; p_provider: string; p_workspace: string }
        Returns: Json
      }
      finish_workbench_job: {
        Args: {
          p_epoch: number
          p_error_code: string
          p_generation: number
          p_job: string
          p_owner: string
          p_retryable: boolean
          p_success: boolean
          p_version: string
          p_workspace: string
        }
        Returns: string
      }
      has_workspace_role: {
        Args: { allowed_roles: string[]; target_workspace: string }
        Returns: boolean
      }
      is_workspace_member: {
        Args: { target_workspace: string }
        Returns: boolean
      }
      match_document_chunks: {
        Args: {
          match_count?: number
          match_filters?: Json
          match_workspace_id: string
          query_embedding: string
        }
        Returns: {
          chunk_id: string
          chunk_index: number
          content: string
          content_hash: string
          document_id: string
          filename: string
          id: string
          metadata: Json
          page_number: number
          score: number
          workspace_id: string
        }[]
      }
      owns_workspace: { Args: { target_workspace: string }; Returns: boolean }
      reconcile_workspace_usage: {
        Args: { p_usage_date?: string; p_workspace_id: string }
        Returns: {
          estimated_cost_microusd: number | null
          failed_calls: number
          input_tokens: number
          output_tokens: number
          query_count: number
          reconciled_at: string
          successful_calls: number
          total_tokens: number
          usage_date: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "workspace_usage_daily"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      record_rights_decision: {
        Args: {
          p_action: string
          p_actor: string
          p_provider: string
          p_request: string
          p_workspace: string
        }
        Returns: {
          action: string
          actor_id: string | null
          decided_at: string
          decision: string
          duties: string[]
          id: string
          provider_id: string
          provider_revision: number
          reason_code: string
          request_id: string | null
          rights_hash: string
          workspace_id: string
          workspace_policy_version: number | null
        }
        SetofOptions: {
          from: "*"
          to: "rights_decisions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_metered_capacity: {
        Args: { p_reservation: string; p_workspace: string }
        Returns: Json
      }
      renew_workbench_job: {
        Args: {
          p_epoch: number
          p_generation: number
          p_job: string
          p_owner: string
          p_version: string
          p_workspace: string
        }
        Returns: boolean
      }
      requeue_ingestion_job: {
        Args: {
          p_error_message: string
          p_job_id: string
          p_retry_seconds?: number
          p_worker_id: string
        }
        Returns: {
          attempts: number
          available_at: string
          cancellation_requested_at: string | null
          completed_at: string | null
          created_at: string
          document_id: string | null
          error_code: string | null
          error_message: string | null
          heartbeat_at: string | null
          id: string
          kind: string
          last_error_at: string | null
          lease_expires_at: string | null
          lease_generation: number
          lease_owner: string | null
          lifecycle_epoch: number
          max_attempts: number
          payload: Json
          progress: number
          stage: string | null
          started_at: string | null
          status: string
          updated_at: string
          version_id: string | null
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ingestion_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reserve_metered_capacity: {
        Args: {
          p_amount: number
          p_dimension: string
          p_key: string
          p_provider: string
          p_workspace: string
        }
        Returns: Json
      }
      reserve_query_capacity: {
        Args: {
          p_actor: string
          p_operation: string
          p_query_limit: number
          p_token_limit: number
          p_tokens: number
          p_workspace: string
        }
        Returns: {
          actor_id: string
          charge_period: string
          created_at: string
          expires_at: string
          id: string
          operation_id: string
          reserved_queries: number
          reserved_tokens: number
          state: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "usage_reservations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_workspace_key: {
        Args: { p_actor: string; p_provider: string; p_workspace: string }
        Returns: {
          created_at: string
          credential_version: number
          encrypted_key: string
          encryption_key_version: string
          id: string
          is_active: boolean
          key_prefix: string | null
          last_used_at: string | null
          provider: string
          revoked_at: string | null
          user_id: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "api_keys"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      settle_metered_capacity: {
        Args: { p_measured: number; p_reservation: string; p_workspace: string }
        Returns: Json
      }
      tombstone_document: {
        Args: { p_actor: string; p_document: string; p_workspace: string }
        Returns: string
      }
      update_workspace_policy: {
        Args: {
          p_expected_version: number
          p_values: Json
          p_workspace: string
        }
        Returns: {
          active_policy_id: string | null
          chunk_overlap: number
          chunk_size: number
          context_window_messages: number
          created_at: string
          default_model: string
          embedding_model: string
          enable_contextual_enrichment: boolean
          enable_query_expansion: boolean
          enable_reranking: boolean
          enable_semantic_chunking: boolean
          hybrid_search_alpha: number
          last_retention_at: string | null
          llm_temperature: number
          next_retention_at: string | null
          policy_version: number
          retention_days: number
          retention_enabled: boolean
          retention_lease_expires_at: string | null
          retention_lease_owner: string | null
          retrieval_top_k: number
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "workspace_settings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      uuid_or_null: { Args: { value: string }; Returns: string }
      workbench_abort_upload: {
        Args: {
          p_context: Json
          p_may_have_object: boolean
          p_upload: string
          p_write_token: string
        }
        Returns: undefined
      }
      workbench_admit_run: {
        Args: {
          p_context: Json
          p_hash: string
          p_key: string
          p_query_limit: number
          p_request: Json
          p_token_limit: number
          p_tokens: number
        }
        Returns: Json
      }
      workbench_append_event: {
        Args: {
          p_epoch: number
          p_event: string
          p_generation: number
          p_job: string
          p_owner: string
          p_payload: Json
          p_type: string
          p_version: string
          p_workspace: string
        }
        Returns: Json
      }
      workbench_authorize: {
        Args: { p_context: Json; p_operation?: string }
        Returns: undefined
      }
      workbench_begin_upload: {
        Args: {
          p_bucket: string
          p_command: Json
          p_context: Json
          p_hash: string
          p_key: string
          p_max_documents: number
          p_max_storage_bytes: number
        }
        Returns: Json
      }
      workbench_cancel_run: {
        Args: { p_context: Json; p_run: string }
        Returns: Json
      }
      workbench_claim_upload: {
        Args: { p_context: Json; p_upload: string }
        Returns: Json
      }
      workbench_complete_upload: {
        Args: { p_context: Json; p_key: string; p_upload: string }
        Returns: Json
      }
      workbench_conversation: {
        Args: {
          p_context: Json
          p_id: string
          p_key?: string
          p_operation: string
          p_revision: number
          p_title: string
        }
        Returns: Json
      }
      workbench_emit: {
        Args: {
          p_event?: string
          p_payload: Json
          p_run: string
          p_type: string
        }
        Returns: Json
      }
      workbench_evidence: {
        Args: { p_context: Json; p_ids: string[]; p_run: string }
        Returns: Json
      }
      workbench_fail_run: {
        Args: {
          p_code: string
          p_epoch: number
          p_generation: number
          p_job: string
          p_message: string
          p_owner: string
          p_state: string
          p_version: string
          p_workspace: string
        }
        Returns: Json
      }
      workbench_finding: {
        Args: {
          p_command: Json
          p_context: Json
          p_hash: string
          p_id: string
          p_key: string
          p_operation: string
          p_revision: number
        }
        Returns: Json
      }
      workbench_finish_run: {
        Args: {
          p_answer: Json
          p_epoch: number
          p_generation: number
          p_job: string
          p_owner: string
          p_version: string
          p_workspace: string
        }
        Returns: Json
      }
      workbench_job_action: {
        Args: { p_action: string; p_context: Json; p_job: string }
        Returns: Json
      }
      workbench_message_projection: {
        Args: {
          p_for_run?: string
          p_message: Database["public"]["Tables"]["chat_messages"]["Row"]
        }
        Returns: Json
      }
      workbench_publish_version: {
        Args: {
          p_epoch: number
          p_generation: number
          p_job: string
          p_owner: string
          p_receipt: Json
          p_version: string
          p_workspace: string
        }
        Returns: Json
      }
      workbench_read: {
        Args: {
          p_after?: string
          p_context: Json
          p_id?: string
          p_latest?: boolean
          p_limit?: number
          p_resource: string
          p_search?: string
        }
        Returns: Json
      }
      workbench_record_upload: {
        Args: { p_context: Json; p_receipt: Json; p_upload: string }
        Returns: undefined
      }
      workbench_recover_uploads: { Args: never; Returns: number }
      workbench_run_access: {
        Args: { p_context: Json; p_operation?: string; p_run: string }
        Returns: {
          accounting_state: string
          attempt_id: string
          cancellation_requested_at: string | null
          completed_at: string | null
          context: Json
          created_at: string
          deadline: string
          final_answer: Json | null
          id: string
          idempotency_key: string
          job_id: string
          last_observed_at: string
          next_sequence: number
          payload_hash: string
          persistence_state: string
          request: Json
          reservation_id: string
          session_id: string
          state: string
          turn_order: number
          user_id: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "query_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      workbench_run_authorize: {
        Args: { p_context: Json; p_operation?: string; p_run: string }
        Returns: {
          accounting_state: string
          attempt_id: string
          cancellation_requested_at: string | null
          completed_at: string | null
          context: Json
          created_at: string
          deadline: string
          final_answer: Json | null
          id: string
          idempotency_key: string
          job_id: string
          last_observed_at: string
          next_sequence: number
          payload_hash: string
          persistence_state: string
          request: Json
          reservation_id: string
          session_id: string
          state: string
          turn_order: number
          user_id: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "query_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      workbench_run_events: {
        Args: {
          p_after: number
          p_context: Json
          p_limit: number
          p_run: string
        }
        Returns: Json
      }
      workbench_schedule: { Args: never; Returns: Json }
      workbench_session_access: {
        Args: {
          p_actor: string
          p_operation: string
          p_session: string
          p_workspace: string
        }
        Returns: boolean
      }
      workbench_settings: {
        Args: { p_context: Json; p_revision?: number; p_values?: Json }
        Returns: Json
      }
      workbench_source: {
        Args: { p_context: Json; p_document: string; p_version: string }
        Returns: Json
      }
      workbench_source_spaces: {
        Args: { p_context: Json; p_run: string }
        Returns: Json
      }
      workbench_sources_available: { Args: { p_run: string }; Returns: boolean }
      workbench_stage_chunks: {
        Args: {
          p_chunks: Json
          p_epoch: number
          p_generation: number
          p_index: string
          p_job: string
          p_manifest: Json
          p_owner: string
          p_space: string
          p_version: string
          p_workspace: string
        }
        Returns: Json
      }
      workbench_start_run: {
        Args: {
          p_epoch: number
          p_generation: number
          p_job: string
          p_owner: string
          p_version: string
          p_workspace: string
        }
        Returns: Json
      }
      workbench_terminalize: {
        Args: {
          p_code: string
          p_message: string
          p_run: string
          p_state: string
        }
        Returns: Json
      }
      workbench_usage: {
        Args: { p_context: Json; p_days?: number }
        Returns: Json
      }
      workbench_usage_attempt: {
        Args: {
          p_attempt: string
          p_epoch: number
          p_generation: number
          p_job: string
          p_owner: string
          p_policy: Json
          p_version: string
          p_workspace: string
        }
        Returns: string
      }
      workbench_usage_settle: {
        Args: {
          p_attempt: string
          p_epoch: number
          p_generation: number
          p_job: string
          p_owner: string
          p_usage: Json
          p_version: string
          p_workspace: string
        }
        Returns: undefined
      }
      workbench_worker_version: {
        Args: {
          p_epoch: number
          p_generation: number
          p_job: string
          p_owner: string
          p_version: string
          p_workspace: string
        }
        Returns: Json
      }
      workspace_role: { Args: { target_workspace: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

