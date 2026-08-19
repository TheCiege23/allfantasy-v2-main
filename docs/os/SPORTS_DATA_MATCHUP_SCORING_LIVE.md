# Live Matchup & Scoring Integration (Certified Sports Context) — Fantasy OS Phase 5E-g

Two related but independently verified workstreams inject certified **game-level** sports context into the real Matchup and Scoring flows, each behind its own server-only gate (`FANTASY_OS_SPORTS_DATA_MATCHUP_ENABLED`, `FANTASY_OS_SPORTS_DATA_SCORING_ENABLED`), **off by default**. Certified data supplies verified GAME facts only; it never computes fantasy points, never finalizes on its own, and never overrides a deterministic authority.

**Key advantage over prior phases:** matchup/scoring finality operate at the GAME level, so the teamless-players limitation does not apply — the certified games snapshot is real and complete (16 games, canonical game/team IDs resolve live).

## Certified statistics capability — the honest truth
The gateway lists a `statistics` capability NAME in its enum, but **no adapter/runtime implements certified player statistics** (verified: zero consumers in `lib/sports-data-gateway/{runtime,providers,gateway}.ts`). The certified plane implements players / rosters / transactions / games / draft_data only. `CertifiedScoringIntegrationService.describeStatSourceAvailability()` reports this truthfully (`certifiedPlayerStatistics: 'not-certified'`). The existing fantasy-point inputs (`PlayerGameLogCache` / `PlayerWeeklyScore` / provider-normalized stat tables) remain the sole authoritative scoring inputs and are never replaced by schedule/game data.

## Workstream A — Matchup

### Exact call graph
- **Matchup read (service path)** — `GameDayContextAssembler.buildLeagueGameDayContext` → `buildMatchupCenterPayload` (THE real matchup/scoring entry point) → `normalizeMatchupState`. Consumed by `GameDaySnapshotService`, `LineupAttentionService`, `CommissionerContextAssembler`.
- **Matchup read (API route)** — `GET /api/leagues/[leagueId]/matchup-center` → `buildMatchupCenterPayload` → informational `sportsContext`.
- **MatchupStateNormalizer** — pure; trusts the payload's provider-derived status; `normalizeMatchupState` now accepts an optional `certifiedGameEvidence` **input fact** and surfaces it on the result, but the authoritative `state` derivation is untouched.

### Authority preservation
Certified game evidence is **additive input only**. `normalizeMatchupState` attaches it via `withCertifiedEvidence` and **never changes `state`** — final certified evidence does not flip a live matchup to final; a single provider game status cannot bypass the normalizer's rules. The matchup-center route is read-only (no persistence). Ownership, home/away, lineup snapshots, winners, standings, and playoff state remain governed entirely by existing authorities. `CertifiedMatchupIntegrationService.evaluateMatchupFinalityEvidence` returns only `canSupportFinalization` (true when trustworthy + all games final) — it never causes finalization.

### Certified context / unsupported
Supported: canonical game/team IDs, scheduled start, game status, finality, schedule freshness, snapshot version. Explicitly **unsupported** (returned `unavailable`): live fantasy score, projection, injury, win probability, player availability, inferred winner, inferred playoff advancement.

## Workstream B — Scoring

### Exact call graph
- **Finalization authority** — `updateMatchupScores(matchupId)` (`lib/redraft/scoringEngine.ts`) → `scoreRosterStarters` (home/away, from existing stat inputs) → computes `existingFinal = isComplete && home.allFinal && away.allFinal` → persists `redraftMatchup.status` + emits `MATCHUP_FINALIZED` (idempotencyKey `matchup.finalized:<id>`). `recalculateMatchupsForSeasonWeek` batches it.
- Authoritative sources: **raw/normalized stats + fantasy-point calculation + weekly/matchup totals + finalization + standings** all remain the existing scoring engine's. The certified plane supplies none of them.

### Finalization guard (stricter-only)
Injected into `updateMatchupScores` immediately before the status write: when the existing engine would finalize (`existingFinal`) AND gate on AND **trustworthy** certified evidence says not every game is final, the guard sets `isFinal = false` — withholding a premature final (keeps `'active'`). It can only **delay** finalization, never cause it, never change scores (`homeScore`/`awayScore` untouched). **Fails open** (unavailable/stale → existing decision unchanged). A final provider game status alone never finalizes a fantasy matchup. Corrections still re-run `updateMatchupScores` and re-finalize once conditions hold — no correction is suppressed and no corrected score is overwritten. Evidence emitted via `console.info` (not persisted; no migration).

### Gate
Added `FANTASY_OS_SPORTS_DATA_SCORING_ENABLED` to the gate registry (8 gates now) — disabled by default, server-only, not customer-overridable, independently reversible from Matchup.

## Import guard
The Matchup + Scoring services, the normalizer, the assembler, the scoring engine consumer, and the matchup-center route reach providers only through gateway ports (no `sleeper-client`/`espn-client`/provider URL). Test-enforced.

## Decision evidence
Emitted (matchup-center `sportsContext`, normalizer `certifiedGameEvidence`, scoring `console.info`): canonical game/team IDs, snapshot version, freshness, game statuses, finality, evaluated timestamp, existing authority result, final decision, reason, gate state. No provider payloads/credentials. Not persisted (no migration).

## Proving runs (non-prod certified snapshots, `cool-lab-87438174`)
Against certified `nfl-games-2026-w1-2026-07-12` (16 games):
- **Matchup** `describeMatchupGameStates` → `available=true`, 16 games, real canonical game IDs (`espn:nfl:401872656`) + team IDs, `status='scheduled'`, `unsupported` fantasy fields `unavailable`. `evaluateMatchupFinalityEvidence` → `canSupportFinalization=false`.
- **Scoring** `describeStatSourceAvailability` → `certifiedPlayerStatistics: 'not-certified'`; existing inputs authoritative. `evaluateScoringFinalityEvidence` → `certifiedGamesSupportFinalization=false` (does not finalize from game status).
- **No provider request** (gateway ports only). **No persisted matchup result changed** (proving run exercises the services in isolation).

**Limitation (explicit):** the snapshot is >60 min old → freshness `delayed` → `trustworthy=false`, so the scoring finalization **tightening path does not fire in this proving run** (it fails open, correctly). The tightening path (current freshness + not-all-final → withhold) is **unit-proven**. Canonical game/team IDs DID resolve live (game-level, unlike the teamless player sample).

## Disable / rollback (independent)
Unset `FANTASY_OS_SPORTS_DATA_MATCHUP_ENABLED` and/or `FANTASY_OS_SPORTS_DATA_SCORING_ENABLED` → the respective flow reverts instantly. No production DB touched; no migration.

## Next
Phase 5E-h — Intelligence, Coach, Chimmy, and Operator Observability.
