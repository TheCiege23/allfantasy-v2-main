# Draft Identity Root-Cause Analysis (Phase 26)

**Status: one real, narrowly-scoped bug found and fixed. A second, larger, dominant root cause found and honestly disclosed as NOT fixed this phase (out of "smallest safe fix" scope).**

## Fresh pipeline trace (Part 1)

Re-traced the full identity pipeline from source, ignoring Phase 25's inferences:

1. **ADP source**: `readAllFantasyAdpForLeague()` (`lib/adp/readSnapshotForLeague.ts`) reads `AllFantasyAdpSnapshot` rows, each carrying its own pre-computed `playerKey` (built by `buildPlayerKey()` in `lib/adp/computeAllFantasyAdp.ts:71-75`).
2. **Player lookup**: `getPlayerPoolForLeague()` → `getPlayerPoolForSport()` (`lib/sport-teams/SportPlayerPoolResolver.ts`) queries `prisma.sportsPlayer.findMany({where: {sport}, orderBy: {name: 'asc'}})`.
3. **Normalization**: Both `buildPlayerKey()` (ADP side) and `DraftContextAssembler.ts`'s `playerKey()` (pool side) are **functionally identical** — `name.trim().toLowerCase()` + `|` + `position.trim().toLowerCase()`. This was verified directly this phase and rules out "different normalization functions" as a root cause — they are the same function, independently implemented but consistent.
4. **Canonical identity**: `SportsPlayer.name` is copied verbatim into `PoolPlayerRecord.full_name` (`SportPlayerPoolResolver.ts:189`, `full_name: r.name`) — no additional canonicalization applied at this step.
5. **DraftPoolResolver → recommendation engine**: `assembleEngineInputFromPicks()` (`DraftContextAssembler.ts:141-191`) joins ADP entries against the pool via the shared `playerKey()`, then hands the result to `lib/draft-helper/RecommendationEngine.ts`.

## Root cause #1 — FIXED this phase: dedup applied after a premature row limit

`getPlayerPoolForSport()` fetched `prisma.sportsPlayer.findMany({where, take: min(requestedLimit, totalMatching), orderBy: {name: 'asc'}})` — **the SQL-level `take` was applied to raw, duplicated rows, before deduplication.**

**Measured, real severity**: `SportsPlayer` has heavy cross-source duplication (up to 7 independent import sources tracked via `sourceRank()`). Real measurement: **17,257 raw NFL rows for only 12,004 distinct names.** A `take: 800` query, ordered alphabetically, never advanced past **"Anthony Jones"** — meaning virtually the entire B-Z roster was silently excluded from every draft pool call requesting 800 or fewer players, regardless of which league or sport.

**Fix**: removed the premature `take`, fetch all matching rows (bounded and safe — largest real sport is NCAAF at ~45,000 rows), deduplicate fully (existing quality-preference logic unchanged), then apply the requested limit to the deduplicated, distinct-player result. Full detail and before/after evidence in `FANTASY_OS_DRAFT_IDENTITY_BEFORE_AFTER.md`.

## Root cause #2 — found, NOT fixed this phase (disclosed, out of narrow-fix scope)

Even after fixing root cause #1, real measurement showed the resolved pool for one real league only spans **"A'Shawn Robinson" to "Arjen Colquhoun"** at `limit: 800` — the alphabetically-ordered, hard-limited query strategy itself is the dominant constraint. With 12,004 distinct real NFL names and only 800 returned, **any player whose name falls meaningfully past the early alphabet has essentially no chance of appearing**, independent of deduplication correctness. This explains why real stars (Saquon Barkley, Justin Jefferson, CeeDee Lamb, Bijan Robinson, Ja'Marr Chase, Mike Evans — all confirmed genuinely present and correctly formatted in `SportsPlayer`, `SportsPlayerRecord`, and `PlayerIdentityMap`) remained unresolved even after the Root Cause #1 fix.

**Why this was not fixed this phase**: correcting it requires changing the *ordering/selection strategy* of `getPlayerPoolForSport()` — e.g., prioritizing by ADP relevance, roster/depth-chart status, or a fantasy-relevance signal instead of alphabetical order — a change with materially broader blast radius than a bug fix. This resolver is shared by Waiver OS (`WaiverContextAssembler.ts`, confirmed in Phase 8's original audit), so changing its selection strategy would affect Waiver, not just Draft. Per this phase's explicit guardrails ("avoid broad rewrites," "smallest safe fix," "do not redesign Draft OS"), this is disclosed as the dominant, real remaining defect and recommended for its own dedicated phase — not attempted here.

## Position-format inconsistency — a real, secondary contributing factor (not separately fixed)

A smaller number of real unresolved entries (3 of 218 in the original Phase 25 sample) were traced to genuine position-string-format mismatches — e.g., pool position `"TIGHT END"` vs. ADP's `"TE"`. `normalizePoolPosition()`'s alias map (`SportPlayerPoolResolver.ts:32-40`) only covers a small, IDP-specific set of aliases (EDGE→DE, OLB/ILB/MLB→LB, SS/FS→S, NT→DT) — it does not reconcile full-word position names against abbreviations for any position. This is real but numerically minor relative to Root Cause #2, and was not fixed this phase (same "avoid broad changes to a shared resolver" reasoning).
