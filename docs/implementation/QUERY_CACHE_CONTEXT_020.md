# Query Cache Context - Batch020

Status: PARTIAL_NOT_COMPLETE. Retained Python source correction, not Cloudflare
deployment, hosted private-session authority or whole-application acceptance.

## Reproduction And Correction

At parent5fce1b4 the actual SemanticCache and blocking/stream RAGChain reuse the
same answer namespace for different retrieval histories, topK/reranking options
and response contracts. The cached branch skips recording a question/answer in
session memory. Cache set/get share the original nested response object, so
downstream mutation can corrupt later evidence/metadata. Twelve offline cases
with actual cache/chain and only synthetic embedder/retriever/LLM fail before
the correction; no network/provider/customer processing.

The cache namespace hashes the exact bounded history snapshot passed to retrieval,
normalized filters, requested topK/reranking and blocking/stream mode. History is
still excluded from answer evidence; no raw history appears in response cache
identity metadata. Equivalent context still permits reuse across fresh sessions;
changed context cannot reuse the previous answer. Separate response modes avoid
blocking/stream result-shape aliasing without changing either API contract.

SemanticCache owns nested copies on input and returned hits; callers never mutate
its stored response. Both cached paths record the same bounded local memory pair
as the generated path. Existing workspace/filter isolation, TTL/similarity,
bounded eviction, cache controls and invalidation remain intact. The older
workspace reuse control explicitly uses a fresh context rather than expecting
reuse after a conversation has changed; its hit/isolation assertions remain.

One focused post-fix test wrongly read blocking query_type from metadata; the
blocking contract stores it at top level. Corrected the test contract while
retaining separate-mode retrieval and identity assertions. Preserve failed logs.

## Verification And Open Boundaries

Run the secret-free denied-network full backend runner, isolated/script/Gateway/
frontend suites, lint/typecheck/Worker builds, exact source CI/native/image and
full new source/evidence recovery. Final saved-source results belong in exact
receipts, not invented source-time PASS. No real OAuth/private UI result follows
from Python synthetic tests or public browser suites.

This does not provide cache authorization/source/rights-version fencing. Retained
FastAPI accepts sessions before durable caller ownership/atomic append; stale
membership, strict session revocation, concurrent memory mutation, repeated full
client-history snapshots, source/citation races, lifecycle/legal holds and durable
erasure remain independent defects/gaps. They remain accepted unfinished work,
not omitted scope or future features. All224 requirements/tenproducts stay open.

## Parent019 Exact Final Evidence

BATCH019_HANDOFF.md records539source/33evidence NEW recoveries/fresh suites and
real PostgreSQL authority/forgery/rollback/concurrency/60table101function backup.
Approved019 SQL only was installed in rehearsal as20261013102154; all six stored
bodies/grants match and no table access/data/history operation was added. This
is VERIFIED_REHEARSAL_SCHEMA_ONLY, not hosted two-user JWT testing or production.
Exact image115229431635 native PASS; unsuppressed scan/required summary FAILED
107backend matches101Medium6Low,frontend0,ignored0. No deployment or protected merge.
