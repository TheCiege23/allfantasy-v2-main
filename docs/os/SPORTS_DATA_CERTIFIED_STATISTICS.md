# Certified Player Statistics Foundation — Fantasy OS Phase 5F-a

The first **data-plane expansion**: a genuine certified player-game statistics capability. Real observed box-score stats only — **no derived fantasy points, no projections**. The scoring engine continues to use its existing authoritative inputs; certified statistics exist **alongside** them and are not yet a scoring input.

## Provider truth (verified, not assumed)
Box scores come from **ESPN's public summary endpoint** (`site.api.espn.com/.../summary?event=<id>`) — the same real source `lib/espn-data.ts` already uses, and the same provider already certified for schedules/games. Verified live in the proving run against a real completed game (2024 Week 1, event `401671744`, 79 athlete stat rows). Sleeper does not supply player game statistics; ESPN does.

**Disclosed limitation:** ESPN box-score athlete ids are provider-native. A cross-provider canonical player map (ESPN athlete id ↔ our Sleeper-keyed canonical players) does not yet exist, so player identity resolves as **`unresolved`** (canonical key `unresolved:espn:<athleteId>`). This is a valid *classified* identity outcome, so the snapshot still certifies; game and team identity resolve. Building the ESPN↔canonical player map is later-phase work.

## Architecture (reuses existing snapshot infrastructure)
```
ESPN summary endpoint (provider adapter: lib/sports-data-gateway/providers/espn.ts::fetchEspnBoxScore)
   ↓ raw box-score athlete rows (provider-shaped, never leak past the adapter)
Canonical Statistics Normalizer (statisticsRuntime.ts::normalizeEspnStat — pure)
   ↓ CanonicalPlayerGameStat (contracts.ts) — numeric stat lines only, no raw payload
Certified Statistics Validator (snapshot.ts::canCertify — schema/identity/rejects)
   ↓
Append-only Certified Snapshot (capability='statistics', scope_ref=`<season>-w<week>`)
   ↓
Sports Runtime Store (store.persistCertifiedSnapshot / getCertifiedRecords)
   ↓
Runtime read (statisticsRuntime.ts::getCertifiedPlayerStats)
```

## Canonical statistics contract (`CanonicalPlayerGameStat`)
canonicalPlayerId, canonicalGameId (`espn:nfl:<eventId>`), teamId (`nfl:<ABBREV>`), opponentTeamId, season, week, gameStatus, position (stat group), `statCategories: Record<string, number>` (numeric only), identityResolution (`resolved`|`unresolved`), source provenance. **No fantasy points. No projections.**

## Certification rules (append-only, replacement-proof)
A statistics snapshot certifies only after schema validation + identity classification + duplicate detection (content hash) + provider normalization + `canCertify` + successful persist. Record key = `<gameId>:<playerId>:<statGroup>` so a player appearing in multiple ESPN groups (passing AND rushing) yields one record per group — **full stat fidelity** (this collision was caught and fixed by the proving run). Rejected/uncertifiable drafts (e.g. no box-score stats for unplayed games) **never persist** and never replace a certified snapshot. Corrections re-run the sync → a new certified snapshot (content-hash `changed`), the previous one retained.

## Runtime capability status: `statistics` → **certified**
Transitioned from `not-certified` to `certified` after genuine end-to-end implementation + a real certified snapshot. Reflected in `CERTIFIED_CAPABILITY_TRUTH.certified` and `describeStatSourceAvailability().certifiedPlayerStatistics = 'certified-not-scoring-input'`. Injuries / projections / availability remain honestly **not-certified**.

## Scoring engine unchanged
`PlayerWeeklyScore` / `PlayerGameLogCache` / existing provider-normalized tables remain the sole authoritative fantasy-point inputs. Switching production scoring to certified statistics is a later certification phase, after sufficient proving runs.

## Import guard
Only the ESPN gateway adapter touches the provider; `statisticsRuntime.ts` imports `../providers/espn` and never a raw provider URL or `fetch`. No product runtime bypasses certified statistics. Test-enforced.

## Decision evidence
Emitted (sync result): snapshot version, certification state, season/week, provider, stat/resolved/unresolved counts, created/changed/suppressed, canonical game ids (in records). **No raw provider payloads, no credentials.**

## Proving-run evidence (non-prod `cool-lab-87438174`)
Real completed game `401671744` (2024 Wk1): fetched 79 real athlete stat rows (e.g. Justin Fields YDS 156, QBR 31.1); **certified** snapshot `nfl-stats-2024-w1-…`, statCount 79, all 79 unresolved (disclosed); runtime retrieval returned **79** (full fidelity after the key fix); append-only re-run → `created 0, changed 0, suppressed 79` (deterministic dedup, previous retained); no provider leakage in stored records.

## Tests
`__tests__/fantasy-os/certified-statistics.test.ts` (10): normalization, canonical identity resolution (resolved/unresolved), duplicate detection, certification, append-only + correction replay, snapshot-replacement prevention, runtime retrieval, provider-failure handling, capability registration, import guard, no-raw-exposure. Plus updated intelligence/scoring capability-truth tests.

## Remaining before full provider certification
- ESPN athlete id ↔ canonical player identity map (to resolve player identities).
- Multi-provider verification / cross-source statistics reconciliation.
- Then Phase 5F-b (injuries), 5F-c (availability), 5F-d (projections), 5G (final multi-provider certification), and — only after sufficient proving runs — switching production scoring to certified statistics.
