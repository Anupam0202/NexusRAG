# Functional summary targeting and recovery - batch023

Status: PARTIAL_NOT_COMPLETE. IMPLEMENTED_SOURCE / TESTED_LOCAL for the scope
below only. No hosted deployment, complete-product or production acceptance.

## Preserved starting point

- Parent commit810e5922602f0c42b1a059a8878b7500f19ffc8b,
  treefc66612b48d0d4f61d4b196195f6a705ef35d7db,547tracked source files.
- Detached managed functional-retrieval-023 checkout; canonical draftPR12 retained.
  Protected main/release and original Downloads checkout's17dirty paths untouched.
- Owner batch022 pause handoff and complete551-entry WIP SHA256
  3475bfff25027144f06a22ace6ac28b1b03fb2e41d753adf232bbc0a66d94d13
  remain recovery artifacts, not an accepted release. No022 SQL/Worker/test/CI
  candidate imported. No excluded security audit, investigation or remediation.
- Current architecture remains Cloudflare/Supabase/Qdrant/Gemini. Read-only
  rehearsal metadata:ukgjygzfhyvnrsecdcuu,ACTIVE_HEALTHY,PG17.6.1.166,
  latest20261014113511_backend_private_turn_authority. No migration invocation.

## Reproduction and correction

Actual production Gateway handler with synthetic stored documents, originals,
chunks, vector results, generation and history receipts initially fails3/4 new
summary regressions. A workspace request naming a cover letter returns mixed
resume sources; an ambiguous "this document" or missing quoted file returns200.
Those are source defects, not proof the older active deployment has this patch.

The resolver now runs on current eligible ready documents before chunk loading,
quota admission, history creation or provider work. It recognizes common English
summary commands, literal normalized filenames, exact stems and unique multiword
title suffixes (such as Applicant_Cover_Letter.pdf). Quoted multiple files must
all exist uniquely. Generic/plural workspace summaries retain their scope;
explicit IDs and exact filename filters take precedence. Ambiguous references
return422 DOCUMENT_SELECTION_REQUIRED, without silently choosing or widening.

Resolved document/version IDs constrain actual lexical and Qdrant queries and
generation context. Assistant citation metadata and document_selection persist
the same target IDs. Existing filter/capacity/rights/usage gates remain.
Selected UI scope with an exact filename but no IDs is now accepted consistently
by the Gateway, rather than rejected despite the UI allowing Send.

The real client hook handles the new code as an actionable online error, not a
connection outage. An icon/tooltipped recovery control opens the existing picker,
restores the question only into an empty draft and focuses it. It neither replays
nor overwrites a new draft. Selection and non-sensitive attestation still require
the user to submit again. Resetting its conversation dismisses stale recovery.

## Enumerated local verification

-14deterministic resolver cases: literal names, spelling/polite variants, duplicate
  stems/extensions, multiple quoted sources, missing targets, explicit/plural
  scope, prefixed title suffixes and generic/longer-word boundaries.
-6actual Gateway summary cases: named cover letter, ambiguous target, missing
  quoted file, explicit selection priority, exact-filename Selected UI contract.
  Observe real handler outbound scope/context and saved synthetic citations;
  ambiguity consumes no account quota or provider calls.
- Final ordinary review added two failing missing-title cases: the sole unrelated
  resume must not become an absent cover letter. The corrected resolver permits
  a sole-file fallback only for generic document references. The full rerun first
  caught an empty-library quota contract changing402to422; empty scope now retains
  ordinary abstention/admission semantics. Final422Gateway/no skips pass. Original
  candidate Git tree was uploaded but no branch advanced before this correction.
-4new React hook/controller cases plus existing component suite: actionable error,
  deliberate retry, stale recovery dismissal, empty/new draft preservation.
-4actual isolated browser journeys:desktop Chromium/mobile Chrome emulation,
  light/dark, deliberate selection/attestation, focus, exact ID submission, source
  text inspection and viewport bounds. Production hooks/client/components with
  synthetic REST responses; not hosted OAuth/SQL/Gemini or whole-app acceptance.
- Initial full420Gateway/no skips,363frontend,630backend+10subtests,57isolated,
  88scripts,lint,typecheck,Next/OpenNext25route assets and actual local Worker
  fixture suites pass. Final saved-source/recovery/CI receipts remain separate.

Browser extension reports ERR_BLOCKED_BY_CLIENT for both local origins; no
protection modified. An isolated automated browser exercises local components.
Initial browser run skipped because its explicit fixture flag was missing. Two
subsequent runs failed because custom Vite middleware followed its404handler;
the supported configureServer pre-middleware fixes the fixture. A hook assertion
incorrectly read a nonexistent error field; corrected to displayed content.
All failure logs remain. No application assertion or required gate weakened.

## Reproduce the functional UI fixture

In frontend run `node scripts/summary-browser-fixture.mjs 3023`, then run Playwright
against http://127.0.0.1:3023 with E2E_SUMMARY_COMPONENT_FIXTURE=1 and
E2E_BASE_URL=http://127.0.0.1:3023: `npm exec playwright -- test summary-selection.spec.ts`.
Stop the owned server afterward. No auth/customer/provider credentials are loaded;
the fixture is separate from the application build, not a production bypass.
Vite8.0.16 is an explicit dev dependency using the existing pinned package bytes;
unrelated transitive-lock updates are excluded. Ordinary CI adds this fixture
journey without altering required security/image thresholds or deployment jobs.
Official middleware contract: https://vite.dev/guide/api-plugin.html#configureserver.

## Remaining acceptance and next independent work

This is literal target selection, not semantic document classification, complete
whole-document summary coverage, calibrated entailment or representative quality.
Non-English commands and unclear partial names require manual Selected scope.
Retained Python/native research behavior is unchanged and separately accepted.

All224 normative definitions,ten products,twelve modes and400+125quality scenarios
remain. Durable research-mode execution, product-specific analysis/review/monitor
journeys, complete evidence extraction/coverage and ordinary two-user/private
acceptance still need implementation/verification. Known paused022 findings and
107-match failed required image gate remain separately scoped release blockers,
not investigated here. Older active source/schema drift, exact hosted approvals,
rights/budgets, independent lifecycle/erasure and rollout/rollback remain unmet.

Save only this functional source through PR12, export complete source/real locks
and separate sanitized evidence, restore into new directories, verify exact
original manifest/file/archive/index modes and rerun with fresh dependencies.
Then continue the next independent durable research execution journey. No merge,
production deployment, new hosted user/provider/destructive operation authorized.
