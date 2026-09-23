# Local PostgreSQL rehearsal

This suite applies the clean NexusRAG baseline plus candidate migrations 027–033 to a **fresh disposable PostgreSQL 17 database** with the real `pgcrypto` and `pgvector` extensions. It uses independent `psql` connections to exercise locking, reservation races, same-key idempotency, settlement replay, account trial limits, and rollback-safe transactional state. It also verifies durable extraction staging/replay/lease scoping and purge-on-terminal publication, synthetic Storage policy stand-ins, explicit denial of sensitive/unknown Gemini classifications unless provider and workspace review evidence is present, and service-role-only access to the user-key vault.

Example (local only):

```sh
PGHOST=/path/to/local/postgres/socket PGPORT=55432 PGUSER=postgres PGDATABASE=nexusrag_rehearsal \
  tests/postgres/local-rehearsal.sh
```

Prerequisites: an **empty disposable database**, PostgreSQL 17, `pgcrypto`, and `pgvector`. The test role must be a local database superuser so it can create the stand-in roles and run the clean baseline. The `auth` and `storage` schemas here are small mocks—not Supabase Auth claims, Storage API, managed role configuration, or service internals. Passing does not authorize applying these migrations to Supabase.

`tests/postgres/concurrency.sh` and `tests/postgres/account-concurrency.sh` open separate sessions against the seeded test database. They prove local transaction-lock behavior only; they cannot substitute for hosted Supabase, its network/API behavior, or real OAuth identities.

The synthetic `APPROVED` provider/policy rows in `fixtures.sql` are test fixtures only. No such rows or quota budgets are seeded into any connected Supabase project.
