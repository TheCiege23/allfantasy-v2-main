# Next-Season API — Physical Database Validation Summary

Environment: disposable Neon branch `br-green-lab-admi6kkj` (production fork). All tests below ran the real, unmodified route handler (`POST /api/redraft/renewals/[renewalId]/execute`) via a vitest test with only `next-auth`'s `getServerSession` mocked — Prisma, `createNextSeason`, the conflict translator, and every other dependency executed for real against the disposable database. A `// @vitest-environment node` override was required per-file, since this project's default `jsdom` test environment causes `@/lib/prisma` to deliberately export `null` (client-side safety guard) — a real environment characteristic discovered this phase, not a bug in the code under test.

## A real, previously-undetected migration defect found and fixed

Physical testing surfaced a genuine schema-drift defect: `prisma/schema.prisma` declares `LeagueLifecycleState` with `offseason` and `renewal_pending` members (consumed by real, already-shipped code — `openRedraftRenewal`'s `lifecycleState !== 'offseason'` guard), but **no migration file anywhere in `prisma/migrations/` ever adds these values** to the actual Postgres enum type — confirmed by directly querying `pg_enum` on the disposable branch (built entirely from the checked-in migration chain in the prior Gate C phase): only the original 8 values existed. `prisma migrate status`/`migrate deploy` reported "up to date" throughout because they track migration-file application, not schema-vs-DDL drift. Fixed with a new additive migration, `20260712010000_add_missing_league_lifecycle_state_values` (`ALTER TYPE ... ADD VALUE IF NOT EXISTS`), applied cleanly to the disposable branch, re-verified to resolve the issue.

**This finding matters beyond this phase**: it means real production, if ever rebuilt purely from `prisma migrate deploy`, would be missing these two enum values too — any real commissioner attempting to open a renewal (a live, already-shipped feature, not new work) could hit a raw Postgres `22P02` error. Whether production's actual live database currently has these values (e.g. via a manual patch or `db push` at some point) was **not checked** this phase — only the disposable branch was verified. This is flagged as a real, evidence-based concern for a future phase to check against real production directly (read-only) before assuming it's fine.

## A real semantic-mismatch bug found and fixed

See `NEXT_SEASON_API_CALL_GRAPH.md` — `LeagueRenewal.season` represents the source season, not the destination; the route's `requestedSeason` derivation was wrong by one, fixed to `renewal.season + 1`.

## Proving runs completed

- **NFL route success + exact replay**: real (`tc-nfl-league`), 201/200 pair captured across runs, zero duplicate writes confirmed.
- **NCAAF route success + exact replay**: real (`tc-ncaaf-league`), 201/200 pair captured, sport/season/roster/ownership all confirmed correct — see the dedicated NCAAF report.
- **Unauthorized route attempt**: real (`3a657a31-a945-419b-8dfc-f398a3f22ebc`, a real existing but non-commissioner user), stable 403, zero database mutation confirmed by before/after count.
- **Malformed input**: real, stable 400, zero database mutation.
- **Nonexistent renewal**: real, stable 404, response body confirmed free of Prisma/Postgres/host text via regex assertion.
- **API-level N1**: not independently re-run through the HTTP route this phase (N1 was proven at the service layer in the prior phase); N2 was run at the service layer this phase (see Concurrency Completion report) — **API-route-level concurrency was not separately re-verified**, a real, disclosed gap between "service is concurrency-safe" (proven) and "the route wrapping it is" (very likely true given the route adds no additional state, but not independently physically confirmed).
- **Three dedicated in-transaction failure injections**: real, physical, all confirmed clean rollback (see the Failure Injection report).

## What was not physically performed

N3, N5, N6, N7, N9 (not re-verified physically); post-commit failure injection (nothing to inject against — no post-commit effects exist); API-level concurrency (N1/N2 proven at the service layer, not independently through the HTTP route). All disclosed, not omitted silently.
