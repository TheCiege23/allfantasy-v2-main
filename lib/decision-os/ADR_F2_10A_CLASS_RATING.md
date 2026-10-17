# ADR F2.10a — The Class rating: one sanctioned derivation of manager quality from matchup facts

**Status:** Approved — owner ruling, 2026-10-01. **Amends:** ADR F2.10 policies 6, 7 and 8.
**Base:** `5c9615518`. **Schema:** `prisma/migrations/20261001120000_manager_class_ratings`
(not applied; applying it is a separate owner decision).

## Why F2.10 is being amended

F2.10 policy 6 forbids deriving manager quality from `dw_matchup_facts`. It was written for a
lineup shadow port reading 1,186 rows across 3 leagues, where any such derivation would have been
noise presented as a fact. Two things have changed:

1. **Coverage.** Measured 2026-10-01: **121,299 rows across 329 leagues (1,098 league-seasons,
   2018–2026)**: 33,820 unplayed fixtures (policy 3), 87,087 played NFL games in leagues with a
   `League` row, and 392 others (NCAAF, or no `League` row) that the rating does not use.
2. **A product need the rule blocks.** Matchmaking "weight classes" — keeping managers in leagues
   near their own skill to curb lopsided trades, drafts and tanking — need a skill measure. The only
   existing candidates fail: career XP measures volume (rank correlation with skill **0.15**, n=27;
   the most-XP manager holds a losing record), and the AF manager score cannot see opponents.

## The amendment

**Policy 6 now reads:** never derived, never claimed — opponent strength, strength of schedule,
win probability, playoff probability, momentum, projection accuracy, playoff classification, and
manager quality **except through the single sanctioned engine defined below**. No other module may
derive a manager-quality figure from matchup facts, and the sanctioned engine may not be used to
produce any other forbidden item — in particular, a Class gap is never presented as a win
probability for a specific game.

**Policy 7** binds season-scoped *summaries*. The Class rating is cross-season by definition and is
exempt; everything else that reads matchup facts stays season-isolated.

**Policy 8** forbade caches and materialized views of the port. The two tables in this ADR are a
**rating store**, not a cache of matchup facts: they hold a derived quantity that cannot be read
back out of the facts table without re-running the engine. No other materialization is permitted.

## The sanctioned engine (binding)

1. **Math.** All-play Glicko-2. A rating period is one NFL week. Each person contributes one
   observation per league-week: their all-play share that week, `(teams beaten + ½ teams tied) /
   (teams − 1)`, against a virtual opponent at the mean rating of the rest of the league.
   League-weeks with fewer than 4 teams are skipped. Parameters: τ 0.5, starting RD 350, starting
   volatility 0.06, 8 idle steps across each offseason, RD capped at the starting value.
2. **One version string.** Every stored rating carries `modelVersion`. Any change to the math is a
   new version and a full replay; an old version's rows are never rewritten in place.
3. **Identity.** The subject is a platform person: `${platform}:${LeagueTeam.platformUserId}`,
   resolved through F2.10's `(leagueId, externalId)` bridge (policy 2). A game whose two sides
   resolve to the same person is excluded. When one platform league is imported under several AF
   `League` rows, exactly one AF row per `(platform, platformLeagueId)` is used, so no game counts
   twice.
4. **F2.10 policies 1–5 still bind.** In particular: no rating means **unrated**, never Class 1;
   unplayed fixtures are excluded; a completed zero is a real zero.
5. **Uncertainty is always shown.** No surface may show a rating, Class or division without also
   showing whether it is established. A provisional rating (RD above 100) shows as provisional.
6. **Class and division.** Class 1–25 is the percentile among *established* ratings in 4% bands.
   Division is `ceil(Class / 5)`, 1–5. **Matchmaking gates on division ±1, never on Class.**
   Provisional players are not gated, but are flagged. A commissioner may invite or accept a player
   outside the band; that join is allowed and flagged, not blocked.
7. **Derived, rebuildable, never hand-edited.** The writer rebuilds from matchup facts; a wrong
   value is fixed by fixing the engine or the facts, never the row.

## Evidence — the back-test that set these rules

Read-only against production, 2026-10-01. 83,070 resolvable NFL games → **70,816** after dropping
12,254 duplicated by multi-importer leagues; **2,455 people rated**, 1,858 established.

| Measure | All-play (chosen) | Head-to-head only |
|---|---|---|
| Next-game accuracy, 2023+, predicted before training on it | **59.0%** | 57.7% |
| Brier score (coin = 0.2500) | **0.2368** | 0.2462 |
| Most-confident bucket (favourite ≥ 0.75): predicted → actual | **0.800 → 0.763** | 0.819 → 0.685 |

Why the gate is on 5 divisions and not 25 Classes. Each person was rated twice from independent
data (even seasons vs odd seasons; 1,524 established in both; Spearman 0.48):

| Scale | Same person lands within the band | Chance |
|---|---|---|
| 25 Classes, ±2 | 30% | 19% |
| 10 tiers, ±1 | 44% | 28% |
| 7 tiers, ±1 | 58% | 39% |
| **5 divisions, ±1** | **71%** | 52% |

An established person's 90% interval spans a median **18 of 25 Classes**, and two Classes apart
in the middle of the ladder is about a 53% expected result. 25 Classes are kept for display and
progression; they are too fine to gate on.

## Known limits, recorded rather than hidden

- **NFL only** (Sleeper 84,862 played games, ESPN 2,225). Other sports have no matchup facts.
- **Legacy imports are invisible.** ~1,139 of 1,165 legacy leagues hold only the importer's own
  roster and wrote no matchup facts; those seasons cannot rate anyone.
- **Departed managers.** The Sleeper backfill remaps a historical slot by `owner_id` to that
  person's current slot; a manager who has since left falls back to the raw slot number, which a
  current owner may now hold. 73 games resolved to the same person on both sides and are excluded;
  the residue in which a departed manager's games land on a *different* current owner is not
  measured.
- **A season's roster matters more than the manager.** "Higher season-to-date points per game wins"
  predicts single games better (63.6%) than any career rating. Class measures the manager, not this
  year's team, and must never be sold as a game prediction (policy 6 above).
