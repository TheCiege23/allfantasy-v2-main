# ADR F2.10 — Matchup History Facts (warehouse `MatchupFact` derived VIEW) + lineup shadow enrichment

**Status:** Approved for build. **Date:** 2026-07-21. **Base:** `2e063823` (post-#316/#317 main).
**Freeze compliance:** additive read-only port + derived view + shadow-memo enrichment — no frozen
component redesigned, no flag default changed, no new route.

## Why matchup history is the next fact port

The lineup shadow decision (`manager.lineup.set`, Hybrid) can cite per-player performance since
F2.9 but has no sourced answer for "how has this TEAM's actual matchup gone" — the second half of
a lineup memo's grounding. `dw_matchup_facts` is the only remaining POPULATED warehouse table
without a Decision OS consumer (draft facts are the other candidate; matchup history feeds an
existing Hybrid decision today, draft strategy feeds a decision that does not exist yet).

## Verified production census (measured 2026-07-21, re-verified at branch time — unchanged)

| Fact | Value |
|---|---|
| Rows | **1,186** — NFL only, **3 leagues** (real Sleeper: the Phase-E proof set), static since 2026-06-30 |
| Seasons / weeks | 2022–2026 / 1–18; zero null seasons |
| Duplicate key groups on (leagueId, season, weekOrPeriod, teamA, teamB) | **0** |
| Incomplete fixtures | **108** — exactly the `scoreA=0 ∧ scoreB=0 ∧ winnerTeamId IS NULL` set (all 2026) |
| Canonical team bridge | `teamA/teamB` are provider roster-slot ids; `league_teams(leagueId, externalId)` resolves **1,186/1,186** (and all 1,078 winners) |
| Stored projections / playoff flag / opponent-strength | **none — do not exist in storage** |
| Measured cost (worst-case league, 402 rows, both joins) | **0.613 ms**, index `(leagueId, season)` |

## Policies (binding on the implementation and every future consumer)

1. **Sparse coverage is the NORMAL path.** 3 of all leagues have matchup facts. The honest
   unavailable context is the primary code path, not an edge case. No consumer may treat absence
   as 0 wins, 0 losses, or an empty-but-real history.
2. **Provider roster-slot ids are NOT canonical ids.** The PORT resolves canonical `LeagueTeam.id`
   via the `(leagueId, externalId)` bridge (the scoring engine's own join). Projection layers see
   canonical ids only; unmapped teams degrade to null + `team_mapping_unresolved` uncertainty.
3. **Incomplete fixtures (0–0 with null winner) are EXCLUDED from every completed summary** —
   records, averages, samples, latest-matchup. They are fixtures, not ties.
4. **A zero score in a COMPLETED matchup is a real zero** and participates in averages normally.
5. **No playoff-week heuristic.** `isPlayoff` is not stored; deriving it from week numbers would
   fabricate a fact. Omitted entirely.
6. **Never derived, never claimed:** opponent strength, strength of schedule, win probability,
   playoff probability, momentum, manager quality, projection accuracy (per-matchup projections
   were never stored — accuracy is impossible, not merely null), playoff classification.
7. **Season isolation:** current-season summaries use only rows whose season equals the league's;
   historical rows aggregate separately; prior-season-only data carries `season_mismatch`.
8. **No new index, cache, or materialized view** — 0.613 ms at worst-case current scale justifies
   nothing; re-evaluate only on a measured plan change.

## Port contract

Two bounded find\*-only reads per league resolution (the brief's allowed "one bounded batched
lookup" form — Prisma cannot express the team join relationally): `matchupFact.findMany(leagueId)`
+ `leagueTeam.findMany(leagueId, {id, externalId})`, joined in-process. Raw shape:
`{ leagueId, season, weekOrPeriod, teamACanonicalId|null, teamBCanonicalId|null, scoreA, scoreB,
winnerCanonicalId|null, isComplete, createdAt }`. Deterministic fields only; no provider imports.

## Degradation

Query success → contexts + provenance/freshness. Empty result → `matchup_history_unavailable`
(the normal path). Query failure → base world still resolves; `matchup_port_error` uncertainty;
never a zero record.

## Lineup shadow enrichment (Objective B scope)

F2.9 `PerformanceContext` + F2.10 `MatchupContext` feed the existing `manager.lineup.set` SHADOW
memo/explainability/uncertainty/completeness ONLY. Deterministic lineup rules unchanged; flag
default unchanged; no live cutover; no new route. The DCO remains the four-answers contract with
`confidence` and `data_completeness` computed independently.

## Later reuse criteria

Power rankings and a future playoff engine may consume `MatchupContext` when (a) their leagues
have fact coverage, (b) they honor policies 1–8 verbatim, and (c) any probability layer arrives
as its own deterministic engine through the registry — this port supplies inputs, never odds.
