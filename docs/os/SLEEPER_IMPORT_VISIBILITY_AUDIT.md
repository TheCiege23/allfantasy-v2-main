# Sleeper Import Visibility Hardening — Phase OS-C5

Resolves the uncertainty OS-C4 left open: is a real, fully-populated imported Sleeper league ending up
invisible across Dashboard/Commissioner Hub/Manager Hub a Phase E seeding artifact, or a real production
defect? **It is a real production defect** — proven by direct code trace, not assumption, and confirmed
end-to-end against real, live Sleeper data.

## Part 1 — Import pipeline audit: where `League.status`/`leagueVariant`/`platform` are written

Traced the full real import chain (not the nonprod script's shell — the actual product code):

```
app/api/leagues/import/commit/route.ts  (real customer-facing route)
  → runImportedLeagueNormalizationPipeline (ImportedLeagueNormalizationPipeline.ts)
    → fetchSleeperLeagueForImport (SleeperLeagueFetchService.ts)   — fetches real Sleeper API JSON
    → runImportNormalizationPipeline (ImportNormalizationPipeline.ts)
      → SleeperAdapter.normalize() (SleeperAdapter.ts)
        → SleeperLeagueMapper.map() (SleeperLeagueMapper.ts)       — ROOT CAUSE: dropped `status` here
  → buildCanonicalImportBundle (canonicalImportNormalizer.ts)
  → persistImportWithCanonicalAudit (importPersistenceService.ts) — idempotency wrapper (see §Part 1b)
    → persistImportedLeagueFromNormalization (ImportedLeagueCommitService.ts) — writes `leaguePayload`
```

- **`platform`**: always written (`leaguePayload.platform = provider`) — never null for a real import.
- **`leagueVariant`**: written via `resolveImportedLeagueVariant()` — returns `null` unless the source
  data has an explicit `league_variant`/`leagueVariant`/`variant` field, OR (NFL only) IDP roster-slot
  signals are detected (→ `'IDP'`/`'DYNASTY_IDP'`). For an ordinary standard redraft/dynasty league —
  the majority of real leagues — this is `null`.
- **`status`**: **never written at all**, before this phase's fix. `SleeperLeagueMapper.map()` read
  `league.name`, `.sport`, `.season`, `.total_rosters`, `.roster_positions`, `.scoring_settings`,
  `.avatar`, `.settings.type`, `.settings.playoff_teams` from the raw Sleeper payload, but never
  `league.status` — despite `SleeperLeagueRaw.status?: string` being a real, typed, populated field on
  the same object. `ImportedLeagueCommitService.ts`'s `leaguePayload` (used for both league creation and
  update-existing) correspondingly never included a `status` key. `prisma/schema.prisma`'s
  `League.status` column (`status String?`) has **no `@default`**, so every real Sleeper import left it
  NULL, unconditionally.

### Part 1b — a related idempotency finding (retry paths)

`persistImportWithCanonicalAudit` short-circuits on a matching `ImportRun.status === 'completed'` row,
returning the cached prior result WITHOUT re-running the persist step. `decision-os-import-sleeper-nonprod.ts`'s
own `--force` flag only maps to `allowUpdateExisting` (a league-row-level concern) — it does **not**
clear this ImportRun-level idempotency guard. This meant re-running that script with `--force` after
deploying this phase's fix silently did nothing (returned the years-old cached Phase E result) until the
underlying isolated functions were called directly to prove the fix. This is a real, minor gap in that
script's own documented behavior ("`--force` re-imports over an existing league") — not touched this
phase (script-only, non-prod-tooling concern, out of this phase's product-code scope) but worth flagging
for whoever next touches that script.

## Part 2 — Production risk analysis: can this happen in real production?

**Yes, unconditionally, for every real Sleeper import — not a rare edge case.**

Proven by direct code trace (not inference): the field-mapping omission in `SleeperLeagueMapper.ts` is
in the shared, real production code path (`app/api/leagues/import/commit/route.ts` calls the exact same
`runImportedLeagueNormalizationPipeline` this audit traced). There is no branch, flag, or condition that
would make a REAL production import behave differently from the non-prod test import — the bug is
identical in both environments because it's the same code. Confirmed end-to-end with real, live data
from Sleeper's public API (§Part 6) — not simulated.

**Why isn't this a constant, glaring issue reported by every Sleeper user?** Because `leagueVariant` also
needs to be null for `leagueListFilter.ts`'s specific exclusion condition to fire — and per Part 1,
`resolveImportedLeagueVariant()` only returns non-null for IDP leagues or leagues with an explicit
variant tag. **Ordinary standard redraft/dynasty Sleeper leagues — very likely the majority of real
imports — have both fields null**, meaning this most plausibly affects a large fraction of real
Sleeper-imported leagues today, not a narrow edge case. This phase did not (and, per the standing
production-database boundary, will not) query production to get an exact count — that would require
either a read-only production query (a separate, explicit authorization this phase did not seek) or
waiting for real customer reports.

## Part 3 — League visibility audit: importer vs. filter vs. migration

**Verdict: the importer should change (done — see §Part 5/6). The filter's assumption is correct in
principle and was NOT weakened.**

`lib/leagues/leagueListFilter.ts`'s own comment states its assumption plainly: "Real Sleeper active
imports always write `status` from the Sleeper API... A null status on a Sleeper league means it was
created only by the ranking import and should be hidden." That assumption is sound reasoning **given
real data availability** — the defect was that the importer silently failed to honor it, not that the
filter's logic is wrong. Fixing the importer to actually write the real status (already available from
Sleeper's API, per Part 1) restores the filter's own founding assumption to being true, which is the
narrowest, lowest-blast-radius fix: it doesn't touch `leagueListFilter.ts`, `getDashboardLeagueListForUser`'s
Prisma `NOT` clause, or any of the 7 real consumers (§Part 5) — they all continue to work exactly as
designed, now against correct data.

A migration is still needed for **already-imported** leagues whose `status` was written null before this
fix (§Part 4) — the code fix only affects future imports and future re-syncs.

## Part 4 — Migration strategy (designed only — no production changes executed)

**Scope**: real Sleeper-platform leagues with `status IS NULL AND "leagueVariant" IS NULL` — the exact
condition that makes them invisible.

**Identification query** (read-only, safe to run against production for sizing/impact assessment, not
executed this phase without separate authorization):
```sql
SELECT id, name, "platformLeagueId", "userId", "importedAt"
FROM leagues
WHERE platform = 'sleeper' AND status IS NULL AND "leagueVariant" IS NULL;
```

**Migration approach**: for each affected league, re-fetch the real, current status directly from
Sleeper's public API (`GET https://api.sleeper.app/v1/league/{platformLeagueId}`, unauthenticated, the
exact same endpoint the real importer already calls) and backfill `status` with the real returned value.
Never fabricate a value — a league whose Sleeper API call 404s (deleted/inaccessible) stays honestly
null; this migration only fills in what Sleeper itself reports.

```sql
-- Illustrative shape — the real migration is a script (Node/Prisma), not raw SQL, since it needs a
-- live HTTP call per row:
UPDATE leagues SET status = $1 WHERE id = $2 AND status IS NULL;  -- one call per affected row
```

**Rollout plan**:
1. Run the identification query against a read replica or read-only production query first, to size the
   real blast radius (this phase deliberately did not do this — see §Part 2's own boundary note).
2. Dry-run the migration script against the non-prod DB first (this phase's own `cool-lab-87438174`
   project is the natural target — though it currently has zero remaining affected rows, since this
   phase's own fix + live re-import already resolved its one real case).
3. Run against production in small batches (e.g. 50 leagues at a time), verifying each batch's real
   Sleeper API responses before committing.
4. Monitor `getDashboardLeagueListForUser` error rates / league-count deltas for affected users
   post-migration (a sudden increase in a user's visible league count is the expected, desired signal).

**Rollback plan**: before running, snapshot the exact set of affected league IDs and their prior `NULL`
state (the identification query's own result set, timestamped). Rollback = `UPDATE leagues SET status =
NULL WHERE id = ANY($snapshotted_ids)`. Since this migration only fills previously-NULL values (never
overwrites a real existing value — the `WHERE status IS NULL` guard is load-bearing), rollback is exact
and lossless.

**Verification checklist**:
- [ ] Affected-row count before migration matches the identification query's own count.
- [ ] Spot-check 5-10 real users who had zero visible leagues before → now see their real league(s).
- [ ] Confirm leagues that were CORRECTLY excluded (genuine ranking-import artifacts, `platform !=
      'sleeper'` or leagues with an actual non-Sleeper-status reason for null) are unaffected — the
      migration's own `platform = 'sleeper'` scope guard should already guarantee this.
- [ ] Re-run `leagueListFilter.ts`'s own exclusion condition against the migrated rows to confirm zero
      of them still match the hiding condition.

**This phase did not execute any of the above against production**, per its own explicit instruction.

## Part 5 — Consumer audit: every real caller of `getDashboardLeagueListForUser()`

| Consumer | Type | Behavior after this phase's fix |
| --- | --- | --- |
| `app/dashboard/page.tsx` | Dashboard SSR | Real leagues with the fixed status now appear — untouched code, correct by construction |
| `app/commissioner-hub/page.tsx` | Commissioner Hub SSR | Same |
| `app/manager-hub/page.tsx` | Manager Hub SSR (OS-C1) | Same — confirmed live via this phase's own re-run (§Part 6) |
| `app/api/decision-os/commissioner-command-center/route.ts` | Commissioner OS API | Same |
| `app/api/decision-os/manager-command-center/route.ts` | Manager OS API | Same |
| `app/api/start-sit/leagues/route.ts` | Start/Sit tool — a real consumer not previously named in OS-C4's own investigation | Same |
| `app/api/league/list/route.ts` | Legacy `/api/league/list` API | Same |

All 7 consumers call the exact same shared function with no per-consumer filtering logic of their own —
fixing the root cause (the importer) fixes all 7 simultaneously, for every future import, with zero
per-consumer code changes needed. No "future consumers" were found beyond this list at the time of this
audit.

## Part 6 — Live verification (real Sleeper data, real non-prod DB, both before and after)

1. Reset the real "Parbur" league's `status` back to `NULL` (reverting OS-C4's own manual backfill) to
   test from a genuinely broken starting state, not a state my own earlier fix had already patched.
2. Confirmed Sleeper's real, live public API (`GET /v1/league/1253445571830616064`, unauthenticated)
   genuinely returns `"status":"complete"` for this league today.
3. Directly called the real fetch → normalize → persist chain in isolation (bypassing only the
   nonprod script's own separate idempotency-caching quirk, §Part 1b) — confirmed `status: "complete"`
   is now correctly written to the real DB row.
4. Re-ran the full Manager OS composition pipeline (`resolveManagerCommandCenterSnapshot`) — the real
   claimed member of "Parbur" is visible again, with zero manual intervention, purely from the code fix.

## Testing

3 new tests (`__tests__/sleeper-league-mapper-status.test.ts`): real Sleeper status values map through
verbatim; an honestly-absent status maps to `null`, never a fabricated default. No existing tests
asserted the old (broken) behavior, so nothing needed updating.

## Remaining risks (honest, not exhaustive)

- **Real production impact is not yet quantified.** This phase proved the defect is real and universal
  by code trace and live non-prod data, but deliberately did not query production (even read-only)
  without separate explicit authorization. The exact number of currently-affected real customer leagues
  is unknown.
- **Existing affected leagues (in production, if any) are not yet migrated.** The code fix only prevents
  the defect for future imports/re-syncs; Part 4's migration is designed but not executed.
- **Other providers (Fantrax confirmed, likely others) have the identical field-mapping gap** — not
  fixed this phase, scoped to Sleeper only (matching this phase's own title and the specific reproduced
  bug). `leagueListFilter.ts`'s exclusion condition is Sleeper-specific, so other providers aren't
  currently HIDDEN by this same mechanism, but they do still show `status: null` wherever that field is
  surfaced.
- **The nonprod import script's `--force` flag doesn't clear the ImportRun idempotency guard** (§Part
  1b) — a minor, separate tooling gap, not touched this phase.
