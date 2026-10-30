# Local vector-store lifecycle064

Status: IN_PROGRESS / PARTIAL_NOT_COMPLETE. This bounded correction supports the
accepted R29 service-mediated deletion, G19 retention/deletion and S22 portable
reconstructible-index workflows. Their complete acceptance remains open, together
with all224 normative requirements, ten products and twelve modes.

## User outcome and reproduced failure

A local demo user could upload a document, delete its last chunk, restart, upload
a new document and receive an IndexError on search. Deleting the final document
persisted empty metadata but retained faiss.index. Restart loaded the old vectors
beside empty document rows; the next upload appended a new vector while document
positions restarted at zero. An actual three-process HTTP/store probe reproduced
that sequence using unique synthetic TXT inputs and offline hash embeddings.
Empty search itself returned no source text; disclosure was not claimed.

## Persistence and retry behavior

The paired documents/embeddings metadata is authoritative for this local store.
Startup validates its recognized shape, document/vector alignment, dimensions and
finite vectors, then rebuilds the derived index from those exact pairs. This also
repairs missing, corrupt, stale and same-count reordered cache files. An empty
store resets its dimension and removes the obsolete index file.

Writes prepare temporary metadata and index files before publishing them. Metadata
rename is the final commit point. A failed add/delete restores the previous
in-memory rows and indexes and propagates the error, allowing a correct retry.
Restart can reconstruct a cache that changed before metadata publication failed.
Unexpected nonempty metadata is preserved and rejected rather than rewritten as
an empty store. Independent review reproduced and corrected both that destructive
fallback and failed-add memory/disk divergence in the initial candidate.

This remains the existing single-process local-store design; the change does not
add cross-process transactions or prove power-loss durability. Supabase/Qdrant,
private-user authority, holds, receipts and complete distributed erasure remain
separate accepted workflows. No hosted fixture or provider operation was run.

## Verification

The final two-file implementation passed23 targeted regressions,663 complete
backend tests plus74 subtests, and64 dependency-free isolated tests. Meaningful
cases cover last deletion/restart/new upload/search, partial deletion survivors,
empty-store dimension reuse, derived-cache corruption/reordering, malformed
metadata preservation, and failures at index/metadata preparation/publication
with correct add/delete retries. Original failure evidence is retained.

A real three-process after probe used the upload/delete API, restarted twice,
verified absence of the obsolete index and old vectors, uploaded a new document,
searched its exact new source, deleted it and verified another empty restart.
Owned runtime cleanup was verified. Independent final actual-file checks confirmed
recognized metadata rejection/preservation and successful retry after failed add.

Exact frozen-source publication, newly installed dependency/recovery checks and
exact-head CI remain pending until their own receipts exist. The source hashes,
probe phases, failed candidates and owning logs are retained in private cloud
checkpoints. No quotas, assertions, dependency specifications or locks changed.
New security and paused022 remain excluded. Required failed gates remain binding;
no merge, deploy, hosted SQL or destructive platform approval follows from this
local correction.
