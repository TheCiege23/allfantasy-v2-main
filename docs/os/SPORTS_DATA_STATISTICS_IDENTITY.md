# Canonical Player Identity for Certified Statistics — Fantasy OS Phase 5F-b

Adds a **strictly deterministic** canonical player identity bridge to the certified statistics capability (5F-a): `ESPN athlete id → canonical player id → certified statistics`, without changing production scoring.

## Identity call graph
```
ESPN box-score athlete id (raw, from the ESPN adapter only)
   ↓ collected once per sync
resolveEspnAthleteIdentities  (runtime/statisticsIdentityResolver.ts)
   ↓ COMPOSES the Phase-14 canonical resolver
resolvePlayers([{ provider:'espn', sourceId }])  (lib/shared-services/player-identity)
   ↓ direct id match → PlayerIdentityMap.espnId
CanonicalPlayerId (PlayerIdentityMap UUID)  →  CanonicalPlayerGameStat.canonicalPlayerId + identityResolution
```
The existing resolver, `PlayerIdentityMap`, `Player.espnId`, Sleeper/MFL/FantasyCalc/Yahoo id columns, alias maps, and duplicate handling are all **reused** — no resolver logic is duplicated.

## Resolution architecture (strictly deterministic)
- The runtime batch-resolves every unique athlete id **once** (no N+1), builds a sync lookup map, then normalizes.
- **Only a `direct` provider-id match** (PlayerIdentityMap.espnId) is classified **`resolved`** and given a canonical id — the only outcome eligible for future scoring migration.
- A name-based match is classified **`ambiguous`** with **no canonical id assigned** — never name-guessed into `resolved`.
- No match → **`unresolved`** (`unresolved:espn:<athleteId>`).
- **No fuzzy matching, no AI matching.** Name matches are surfaced only as `ambiguous`, never trusted.

## What changed (statistics only — scoring untouched)
- `CanonicalPlayerGameStat.identityResolution` widened to `resolved | unresolved | ambiguous`.
- `statisticsRuntime` gains a batch resolver seam + `resolvedCount` / `ambiguousCount` / `unresolvedCount`; resolved records key by the canonical id (`<gameId>:<canonicalId>:<statGroup>`), others by the provider ref. Stat values, certification semantics, append-only behavior, and correction replay are **unchanged**.
- Runtime retrieval exposes `canonicalPlayerId` + `identityResolution` (identity state) alongside stats.
- Scoring inputs (`PlayerWeeklyScore` / `PlayerGameLogCache`) are **unchanged** — the scoring engine does not import the statistics runtime (test-enforced).

## Import guard
`statisticsIdentityResolver.ts` composes the canonical resolver only — it never touches a provider API/URL/adapter. Provider ids enter only via the ESPN adapter; product runtime consumes canonical identities. Test-enforced.

## Resolution statistics (proving run, non-prod `cool-lab-87438174`)
Real completed game `401671744` (2024 Wk1), 79 real athlete stat rows, deterministic resolution:

| metric | value |
|---|---|
| resolved | **0.0%** (0/79) |
| ambiguous | 0.0% (0/79) |
| unresolved | **100.0%** (79/79) |

**Explicit disclosure — 0% resolution is honest, not a defect of the bridge.** The non-prod `PlayerIdentityMap` table is **empty (0 rows total)** — it has the `espnId` column but no data — so there is nothing to match against. The bridge itself is correct: unit tests prove a `direct` espnId match → `resolved` with canonical id, a name match → `ambiguous` (no id), and no match → `unresolved`. Live resolution requires the identity map to be **populated with ESPN↔canonical mappings** (a data-population task, not code). Append-only re-run remained stable (`suppressed 79`).

## Decision evidence
Emitted (sync result): canonical player id (in records), provider athlete id (source provenance), identity state, snapshot version, certification state, resolved/ambiguous/unresolved counts. No provider payloads, no credentials.

## Tests
`__tests__/fantasy-os/certified-statistics-identity.test.ts` (9) — direct resolution, unresolved, ambiguous (name match, no id), duplicate handling / canonical keying, append-only replay, runtime retrieval exposing identity, provider boundary, import guard, scoring-inputs-unchanged, deterministic-only. Plus updated 5F-a tests.

## Remaining before scoring can safely consume certified statistics
1. **Populate `PlayerIdentityMap.espnId`** (or `Player.espnId`) with real ESPN↔canonical mappings — the gating item; until then live resolution stays ~0%.
2. Achieve and verify a meaningful resolution rate against real data.
3. Reconcile/validate resolved canonical ids against the certified players snapshot.
4. Only then consider certified statistics as a production scoring input (a later, separately-proven phase).
