# ESPN→Canonical Identity Population & Certification — Fantasy OS Phase 5F-c

Populates a real, deterministic ESPN-athlete→canonical-player identity map in the approved **non-production** environment and re-resolves certified statistics against it. Took live deterministic resolution of certified player statistics from **0% → 54.4%** (stat rows) / **56.9%** (unique athletes) — using only a trusted Tier-1 cross-reference, no name/fuzzy/LLM matching.

## Identity data landscape (non-prod, verified)
- `PlayerIdentityMap` — the canonical map (has `sleeperId @unique`, `espnId` indexed, `canonicalName`/`normalizedName`). **Was empty (0 rows).**
- `SportsPlayer` — has name/team/position/`sleeperId` columns but **0 rows** in non-prod.
- No `Player.espnId` column in non-prod; no other populated canonical directory.
- → There was **no existing cross-reference or canonical directory in the DB** to map ESPN ids against.

## Trusted identity source (provider truthfulness)
**Sleeper's own player directory** (`api.sleeper.app/v1/players/nfl`) carries, per player, **both** its `player_id` **and** an `espn_id`. This is a **Tier-1 direct cross-reference** — a single trusted provider record holds both ids, so the mapping is deterministic (not name-matched). Verified live: 12,200 Sleeper players, **6,736 carry an `espn_id` (~55%)**. This ~55% coverage is the ceiling on resolution.

## Identity data call graph
```
Sleeper player directory (adapter: providers/sleeper.ts::fetchSleeperEspnCrosswalk — only provider access)
   ↓ rows carrying BOTH sleeper id + espn id
classifyCrosswalkCandidates (pure) — quarantine conflicts (one espn id ↔ >1 sleeper id)
   ↓ verified Tier-1 candidates
runEspnIdentityPopulation → IdentityStore (prisma, non-prod) — idempotent, conflict-safe upsert
   ↓ PlayerIdentityMap rows (espnId + sleeperId + canonicalName + normalizedName + position + team)
resolveEspnAthleteIdentities (Phase-14 resolver, direct-id) → certified statistics re-resolution (append-only)
```

## Deterministic mapping rules (only Tier-1 used)
- **Tier-1 (used):** a single Sleeper record holds both the sleeper id and the espn id → `resolved`, may write automatically.
- **Tier-2 (exact composite):** not needed here (Tier-1 sufficed) — not used, so no composite/name inference was performed.
- **Tier-3 (ambiguous) / Tier-4 (unresolved):** anything without a deterministic dual-id record stays unresolved. **No name-only, fuzzy, or LLM matching. No invented mappings.**

## Conflict & ambiguity handling
- One `espn_id` claimed by **>1 distinct sleeper id** → quarantined, never written (9 found live).
- An existing `PlayerIdentityMap` row whose stored `espnId` **differs** from the candidate → `skippedConflict`, **never silently overwritten**.
- A null existing `espnId` → filled (update); an identical one → `unchanged` (idempotent).

## Persistence (idempotent, conflict-safe, non-destructive)
Upsert keyed on `sleeperId` (unique). `createMany(skipDuplicates)` for new rows; per-row update only to fill a null/identical espnId; conflicts skipped. `limit` makes runs resumable. **No new migration** (columns already exist). Reruns are deterministic (no duplicates, no reassignment).

## Certified statistics re-resolution (append-only)
After population, `runEspnStatisticsSync(..., resolveBatch: resolveEspnAthleteIdentities)` re-resolves the certified statistics game → a **new** append-only certified snapshot when identity content changes; the prior snapshot is preserved; **stat values are unchanged**. Runtime retrieval exposes `canonicalPlayerId` + `identityResolution`.

## Resolution metrics (proving run, non-prod, real game `401671744`, 2024 Wk1)
**Population:** totalPlayers 12,200 · candidates(Tier-1) 6,718 · conflicts 9 (quarantined) · **created 6,718** · idempotent rerun → **unchanged 6,718, created 0** · coverage 0 → **6,718** PlayerIdentityMap rows with espnId.

| level | resolved | ambiguous | unresolved | total |
|---|---|---|---|---|
| **statistics rows** | 43 (**54.4%**) | 0 | 36 (45.6%) | 79 |
| **unique ESPN athletes** | 37 (**56.9%**) | 0 | 28 (43.1%) | 65 |

Match tiers: direct-id 43 rows / 37 athletes · exact-composite 0 · conflicts 9 (population) · duplicate-suppression 36 rows (append-only rerun) · change 43 rows. Re-resolved snapshot `nfl-stats-2024-w1-ff7abf66…`; prior snapshot retained.

## Below the 80% target — honest limiting-gap analysis
The 80% target was **not** met (actual 54.4% rows / 56.9% athletes). **Matching standards were not lowered** — the gap is a real data limitation: **Sleeper's `espn_id` field is populated for only ~55% of players** (skewed toward fantasy-relevant skill positions), so box-score athletes (many offensive linemen, defense, deep-roster, retired) without a Sleeper `espn_id` stay `unresolved`. Exceeding 80% requires an **additional deterministic source** (e.g. ESPN's own athlete directory joined on another stored cross-reference, or a richer certified crosswalk) — not a lower bar.

## Capability truth (statistics certification ≠ identity completeness)
`statistics` remains **certified** (data capability). Identity coverage is exposed **separately** via operator observability (`identityCoverage`: `identityMapRows` / `withEspnId` / `withSleeperId` — counts only). The two are not conflated.

## Operator observability
`GET /api/admin/fantasy-os/sports-data/observability` (admin + `observability` gate) now includes `identityCoverage` (counts only — never player rows, ids, or payloads).

## Scoring safety
Production scoring is unchanged — `PlayerWeeklyScore` / `PlayerGameLogCache` remain authoritative. Resolved certified statistics are still **not** a scoring input.

## Remaining before certified statistics can become a scoring candidate
1. Raise deterministic resolution toward ≥80% with a **second trusted source** (identity-source enrichment) — the gating item at 54.4%.
2. Reconcile resolved canonical ids against the certified players snapshot.
3. Backtest resolved certified stats vs the existing scoring inputs.
4. Only then consider certified statistics as a production scoring input (separately proven). Then 5F-d.
