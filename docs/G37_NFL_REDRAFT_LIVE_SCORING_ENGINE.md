# G37 NFL Redraft Live Scoring Engine

## Scope

G37 completes the canonical live scoring layer for AF NFL Redraft leagues. It does not build external Decision OS, Commissioner OS, or Manager OS consumers. Integration points are kept open through canonical runtime events.

## Architecture

- Pure runtime: `lib/scoring-runtime/canonicalNflRedraftScoringRuntime.ts`
- NFL stat normalization: `lib/scoring-runtime/nflStatNormalization.ts`
- Persistence resolver: `lib/scoring-runtime/resolveNflRedraftLiveScoringRuntime.ts`
- API: `app/api/redraft/live-scoring/route.ts`
- UI surface: `app/league/[leagueId]/tabs/redraft/MatchupView.tsx`
- Browser harness: `app/e2e/g37-nfl-redraft-live-scoring/page.tsx`

The resolver uses existing persistence only: `PlayerWeeklyScore`, `RedraftMatchup.lineupSnapshots`, `RedraftRoster` standings fields, `LeagueEvent`, and `AdminAuditLog`.

## Scoring Rules

Scoring is resolved from G33 canonical league rules and the existing NFL sport-config engine keys. Commissioner UI scoring keys are bridged through `nfl-scoring/scoringKeyBridge`.

Supported categories include passing, rushing, receiving, fumbles, two-point conversions, kicking, DST touchdowns/counting stats, points allowed, yards allowed where provided, return touchdowns, IDP where enabled, PPR variants, custom passing/rushing/receiving values, and TE premium.

## Stat Normalization

Provider/test payloads are normalized into deterministic engine keys such as `pass_yds`, `rush_td`, `rec`, `fg_50_plus`, `def_sack`, and `def_points_allowed`. DST rows use a separate normalizer to avoid collisions between offensive and defensive meanings of keys like `sack`, `int`, and `fum_rec`.

No provider data is fabricated. Missing stats stay missing and are surfaced in live scoring coverage.

## Starter And Bench Application

Starter slots count toward matchup totals. Bench and IR players remain visible in the live scoring UI and runtime state, but do not count toward matchup totals. Illegal lineups are flagged and prevent a matchup from finalizing cleanly until corrected or reviewed.

## Matchups And Standings

G37 reads G36 `RedraftMatchup` rows for the scoring week. Recalculation writes home/away scores, status, and compact live-scoring snapshots back to `RedraftMatchup.lineupSnapshots`, then calls the existing standings updater so wins, losses, ties, PF, PA, streak, and playoff seed inputs remain in the redraft roster table.

## Stat Corrections

Corrections normalize the corrected stat payload, increment a deterministic correction version, update `PlayerWeeklyScore`, recalculate matchups, recalculate standings, and write both `LeagueEvent` and `AdminAuditLog` entries.

## Runtime Events

G37 adds canonical event support for:

- `scoring.period.opened`
- `scoring.player_stat.ingested`
- `scoring.fantasy_points.calculated`
- `scoring.team_score.updated`
- `scoring.matchup_score.updated`
- `matchup.finalized`
- `scoring.stat_correction.applied`
- `lineup.illegal.flagged`
- `commissioner.scoring_correction`
- `standings.recalculated`

These are emitted for future OS integration only; no downstream intelligence consumer is built in G37.

## API

`GET /api/redraft/live-scoring?seasonId=...&week=...` returns member-visible live scoring state.

`POST /api/redraft/live-scoring` is commissioner-scoped and supports:

- `recalculate_week`
- `ingest_stats`
- `apply_correction`

Provider cron scoring remains supported by the existing score-sync route. The new API provides a canonical runtime read/write path for deterministic scoring actions.

## Known Limitations

- Full repo typecheck still has unrelated pre-existing failures/OOM risk.
- Browser proof uses a deterministic harness, not a full authenticated seeded league.
- Live provider ingestion depends on existing cache/provider jobs; G37 does not invent live NFL data.
- Playoff bracket scoring is not expanded here; G37 focuses on regular-season NFL redraft scoring.
