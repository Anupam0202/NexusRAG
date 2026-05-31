# NexusRAG RLS Manual Checks

Use two authenticated Supabase users, `user_a` and `user_b`.

1. Create profiles for both users through normal signup.
2. As `user_a`, insert a workspace where `owner_id = auth.uid()`.
3. As `user_a`, insert an owner row in `workspace_members`.
4. As `user_a`, insert a document and chunk in that workspace.
5. As `user_b`, verify `select * from workspaces`, `documents`, and
   `document_chunks` returns no rows for `user_a`'s workspace.
6. Add `user_b` as `viewer`. Verify `user_b` can read documents/chunks but
   cannot insert, update, or delete documents.
7. Change `user_b` to `editor`. Verify uploads, chat sessions, messages, and
   ingestion jobs are allowed, but workspace member management is denied.
8. Change `user_b` to `admin`. Verify workspace settings and members can be
   managed, but owner-only workspace deletion is still denied.
9. Upload a storage object at `workspace_id/document_id/original_filename`.
   Verify only workspace members can read it, and only owner/admin/editor roles
   can write or delete it.
10. Confirm no query without an authenticated Supabase session can read any
    workspace data.
