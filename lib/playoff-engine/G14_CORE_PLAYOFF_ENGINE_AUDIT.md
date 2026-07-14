# G14 Core Playoff Engine Audit

Status: audit complete, no engine rewrite in this milestone.

Readiness hold:

- NFL Engine: 93%
- Overall Platform: 90%

G14 treats playoff bracket generation, advancement, finalization, trophies, and postseason history as a separate Core Playoff Engine boundary. Regular-season schedule remains G13 Schedule Engine scope.

## Scope Boundary

Core Playoff Engine scope:

- Playoff qualification and seeding inputs.
- Bracket generation.
- Byes and odd playoff sizes.
- Playoff matchup progression.
- Reseeding policy.
- Consolation, toilet bowl, and third-place bracket policy.
- Champion finalization.
- Trophy/history event outputs.
- Commissioner overrides and audit metadata.

Out of scope for G14:

- Regular-season matchup schedule generation.
- Regular-season standings recomputation.
- Waiver, trade, and roster lifecycle engines.
- Bracket-pool games where users predict real-world playoffs.
- Sport provider playoff series syncing for bracket challenges.

The Playoff Engine may consume standings and regular-season schedule boundaries, but it should not own them.

## 1. Current Architecture Map

### Native Redraft Playoffs

- `app/api/redraft/playoffs/generate/route.ts`
  - Commissioner-only route.
  - Creates `RedraftPlayoffBracket`, `RedraftPlayoffSeed`, `RedraftPlayoffRound`, and `RedraftPlayoffMatchup`.
  - Sorts Redraft rosters by wins, points for, and points against.
  - Calculates bracket size as next power of two.
  - Creates first-round byes for missing bracket slots.
  - Deletes existing playoff rows by default when regenerating.
  - Does not call `lib/redraft/playoffEngine.generatePlayoffBracket`.
  - Does not emit `EVENT.PLAYOFF_BRACKET_GENERATED`.

- `lib/redraft/playoffEngine.ts`
  - `getPlayoffDefaults(sport)` reads `tryGetSportConfig`.
  - `generatePlayoffBracket(...)` is an in-memory Redraft bracket helper, but the production generate route does not use it.
  - `advancePlayoffWinners(seasonId, week)` advances completed playoff winners into the next round.
  - `finalizeRedraftSeasonChampion(seasonId, recordedByUserId)` crowns champion and completes the season.

- `app/api/redraft/playoffs/advance/route.ts`
  - Commissioner-only route.
  - Calls `advancePlayoffWinners`.

- `app/api/redraft/seasons/finalize/route.ts`
  - Commissioner-only route.
  - Calls `finalizeRedraftSeasonChampion`.

- `prisma/schema.prisma`
  - `RedraftPlayoffBracket`
  - `RedraftPlayoffRound`
  - `RedraftPlayoffSeed`
  - `RedraftPlayoffMatchup`
  - `LeagueChampionship`

### Generic Playoff Seeding

- `server/services/playoffEngine.ts`
  - Computes playoff seeds from `FantasyStanding`.
  - Reads `League.playoffTeams`, `League.playoffSeedingRule`, best-ball flags, and parsed settings snapshot.
  - Supports standard rank, points-only for cumulative best ball, and division-winners-first ordering.
  - Writes `FantasyStanding.playoffSeed`.

- `app/api/leagues/[leagueId]/scoring/playoff-seeds/route.ts`
  - Member-visible playoff seeds endpoint.
  - Optional commissioner-gated refresh.
  - Emits realtime fanout when seeds are refreshed.

### Commissioner Settings

- `app/league/[leagueId]/components/settings/PlayoffSettingsPanel.tsx`
  - UI for start week, team count, weeks per round, seeding mode, and lower bracket type.

- `app/api/commissioner/leagues/[leagueId]/playoffs/route.ts`
  - Reads and writes playoff structure settings.
  - Persists values under `League.settings.playoff_structure` and some top-level compatibility keys.

- `app/api/commissioner/leagues/[leagueId]/playoff-settings/route.ts`
  - Separate advanced postseason-stage API.
  - Handles premium real-world playoff stages such as NFL wild card, NBA play-in, and bowl/CFP stages.
  - Writes `League.settings.playoff_config_data`.

- `lib/playoff-defaults/*`
  - Sport and variant playoff defaults.
  - Bracket config, seeding config, tiebreaker config, and bootstrap.

- `lib/playoff-settings/*`
  - Advanced real-world postseason stage registry and schedule adjustment preview/save.
  - This influences settings, not native Redraft bracket generation today.

### Playoff Challenge System

- `lib/playoffs/*`
- `app/api/brackets/playoffs/*`
- `lib/brackets/*`

These files power playoff bracket-pool games and provider-backed real-world playoff series, not native fantasy league playoffs. They should remain a separate product area unless a future shared bracket topology library is intentionally extracted.

### Lifecycle, History, Records, Finance

- `server/services/leagueLifecycleService.ts`
  - Defines lifecycle state `playoffs`.
  - Allows transition `in_season -> playoffs -> completed`.
  - Does not automatically enter playoffs when a bracket is generated.

- `lib/redraft/playoffEngine.ts`
  - Champion finalization writes `LeagueChampionship`, marks `RedraftSeason` and `RedraftPlayoffBracket` complete, and sets `League.lifecycleState = completed`.

- `lib/league/history-aggregates.ts`
  - Aggregates stored `LeagueSeason` rows for all-time history.
  - Not directly written by Redraft champion finalization.

- `prisma/schema.prisma`
  - Finance and payout models exist, but native Redraft champion finalization does not trigger dues or payout workflows.

## 2. Playoff Lifecycle Map

### Target Core Flow

```text
Regular season complete
  -> standings finalized
  -> playoff qualifiers resolved
  -> playoff seeds locked
  -> bracket generated
  -> playoff round activated
  -> playoff matchup scores finalized
  -> winners advanced
  -> next round activated or champion ready
  -> champion finalized
  -> trophies/history/events written
  -> season completed
```

### Observed Redraft Flow Today

```text
Redraft regular season standings exist
  -> commissioner calls POST /api/redraft/playoffs/generate
  -> Redraft playoff rows created
  -> round 1 marked active
  -> scores must be present on RedraftPlayoffMatchup rows
  -> commissioner calls POST /api/redraft/playoffs/advance
  -> winners advance to next round
  -> final round completion returns ready_for_champion_finalization
  -> commissioner calls POST /api/redraft/seasons/finalize
  -> LeagueChampionship upserted
  -> RedraftSeason.status = complete
  -> RedraftPlayoffBracket.status = complete
  -> League.lifecycleState = completed
  -> EVENT.CHAMPION_CROWNED emitted
  -> EVENT.SEASON_COMPLETED emitted
```

Missing or unclear lifecycle transitions:

- No automatic `League.lifecycleState = playoffs` when the bracket is generated.
- No platform `EVENT.PLAYOFF_BRACKET_GENERATED` emission from Redraft generation.
- No `EVENT.PLAYOFF_ADVANCED` emission from advancement.
- No clear scoring pipeline that writes playoff matchup scores from live scoring.
- No season-history snapshot is written during finalization.
- No payout/dues hook is invoked during finalization.

## 3. Dependency Graph

```text
Regular-season standings
  -> Redraft: RedraftRoster wins/pointsFor/pointsAgainst
  -> Generic: FantasyStanding rank/pointsFor/wins

Redraft bracket generation
  -> app/api/redraft/playoffs/generate/route.ts
  -> prisma.RedraftSeason
  -> prisma.RedraftRoster
  -> prisma.RedraftPlayoffBracket
  -> prisma.RedraftPlayoffSeed
  -> prisma.RedraftPlayoffRound
  -> prisma.RedraftPlayoffMatchup

Redraft advancement
  -> app/api/redraft/playoffs/advance/route.ts
  -> lib/redraft/playoffEngine.advancePlayoffWinners
  -> prisma.RedraftPlayoffBracket
  -> prisma.RedraftPlayoffRound
  -> prisma.RedraftPlayoffMatchup

Redraft champion finalization
  -> app/api/redraft/seasons/finalize/route.ts
  -> lib/redraft/playoffEngine.finalizeRedraftSeasonChampion
  -> prisma.RedraftSeason
  -> prisma.RedraftPlayoffBracket
  -> prisma.RedraftRoster
  -> prisma.LeagueChampionship
  -> prisma.League lifecycleState
  -> EVENT.CHAMPION_CROWNED
  -> EVENT.SEASON_COMPLETED

Generic playoff seeds
  -> app/api/leagues/[leagueId]/scoring/playoff-seeds/route.ts
  -> server/services/playoffEngine.computePlayoffSeeds
  -> prisma.FantasyStanding

Commissioner settings
  -> PlayoffSettingsPanel
  -> app/api/commissioner/leagues/[leagueId]/playoffs/route.ts
  -> lib/playoff-defaults/*
  -> League.settings / League top-level playoff fields

Advanced postseason stages
  -> app/api/commissioner/leagues/[leagueId]/playoff-settings/route.ts
  -> lib/playoff-settings/*
  -> League.settings.playoff_config_data

Separate playoff challenge product
  -> lib/playoffs/*
  -> app/api/brackets/playoffs/*
  -> prisma.PlayoffBracketChallenge / Series / Entry / Pick
```

## 4. Redraft-Only Logic

Redraft-specific today:

- `RedraftRoster` is the playoff participant.
- Redraft bracket seeding uses Redraft roster wins and points fields.
- Redraft playoff rows use `RedraftPlayoff*` tables.
- Redraft advancement fills `homeRosterId` and `awayRosterId` slots directly.
- Redraft champion finalization writes `LeagueChampionship` from a `RedraftRoster`.
- Redraft finalization completes `RedraftSeason` and `RedraftPlayoffBracket`.

Logic that should not become core as-is:

- Route-local bracket generation in `app/api/redraft/playoffs/generate/route.ts`.
- Assumption that all playoff teams are `RedraftRoster` rows.
- Assumption that points-for is always the second tiebreaker.
- Assumption that exact ties can be resolved by lower seed unless a plugin or commissioner policy says so.
- Assumption that a bracket is always single-elimination.
- Assumption that lower bracket settings can be ignored safely.
- Assumption that champion identity is always a platform user from `RedraftRoster.ownerId`.

## 5. Core Playoff Engine Candidates

The audit supports these candidates, but not a G14 rewrite:

- `PlayoffParticipant`
  - Stable participant id, display name, owner id, seed source, division/conference, and plugin metadata.

- `PlayoffQualificationPolicy`
  - Team count, qualification source, division winners, wildcards, manual commissioner entries, and eligibility filters.

- `PlayoffSeedingPolicy`
  - Standard standings, points-only, division-winners-first, custom tiebreakers, manual seed locks, and plugin-specific seeding.

- `PlayoffBracketPolicy`
  - Single elimination, fixed bracket, reseed after round, byes, consolation, toilet bowl, third-place game, and matchup length.

- `PlayoffBracketPlan`
  - Rounds, matchup slots, byes, next-slot links, metadata, and deterministic warnings.

- `PlayoffScoreSource`
  - Supplies playoff matchup scores without coupling advancement to one scoring table.

- `PlayoffPersistenceAdapter`
  - Redraft adapter writes `RedraftPlayoff*`; future concepts can persist differently.

- `ChampionFinalizationPort`
  - Writes concept-specific season completion and common championship outputs.

- `PlayoffEventPublisher`
  - Emits `PLAYOFF_BRACKET_GENERATED`, `PLAYOFF_ADVANCED`, `CHAMPION_CROWNED`, and `SEASON_COMPLETED`.

## 6. Plugin Extension Points

Future league concepts need extension points rather than Redraft inheritance:

- Redraft
  - Standard H2H bracket; Redraft adapter persists native Redraft playoff rows.

- Dynasty
  - Divisions, multi-year history, rivalry weeks, draft-order consolation outcomes, and dynasty trophy history.

- Keeper
  - Similar bracket to Redraft with retained team identity and keeper-year history.

- Best Ball
  - Cumulative best-ball modes may seed by points-only and may not use weekly H2H playoff matchups.

- Guillotine
  - Survival/elimination cadence can replace bracket playoffs entirely.

- Survivor
  - Jury/final tribal style winner logic belongs to plugin behavior, not the core bracket.

- Tournament
  - Qualification, elimination, elite-eight, and championship phases already exist in `lib/tournament-mode`.
  - Tournament champion finalization should plug into core history/events later, not inherit Redraft rows.

- Big Brother
  - Eviction/competition phases may have social-game postseason rules.

- Zombie
  - Current create route rejects playoff-enabled zombie leagues.
  - Zombie should remain no-playoff unless a plugin defines a finale.

- Devy / C2C
  - May need combined pro/college qualification, weighted championship rules, and hybrid tiebreakers.

- IDP
  - Mostly scoring/tiebreaker variation; bracket topology can remain standard unless league settings override.

## 7. Settings Enforcement Table

| Setting | Current classification | Evidence | Future Core requirement |
| --- | --- | --- | --- |
| Playoff team count | Partially wired | Redraft generate accepts `body.playoffTeams`; settings resolvers read `League.playoffTeams` and JSON. Route does not automatically use resolved config. | Resolve once through a core policy and enforce consistently. |
| Playoff start week | Cosmetic/partially wired | Schedule generation uses start week as regular-season cutoff; Redraft bracket generation does not validate week. | Lifecycle should use start week to decide when bracket can activate. |
| Championship week | Missing in native Redraft | Derived by schedule adjustment helpers, but not stored/enforced in Redraft bracket rows. | Core should derive from start week, rounds, matchup length, and championship length. |
| Reseeding | Cosmetic only for native Redraft | UI/API can write reseed settings; advancement fills fixed `nextMatchupId` slots. | Core advancement must choose fixed vs reseed policy per round. |
| Byes | Working for generated Redraft bracket | Generate route creates bye matchups and pre-fills `winnerRosterId`; advancement handles `status = bye`. | Core should make bye allocation deterministic and setting-driven. |
| Odd playoff sizes | Partially wired | `lib/redraft/oddPlayoffBracket.ts` exists, but route uses next-power-of-two byes for any requested size and UI only offers even sizes. | Core should support arbitrary valid sizes with tests. |
| Consolation bracket | Cosmetic only for native Redraft | Settings/UI exist; `generatePlayoffBracket` accepts lower bracket args but ignores them; route creates only winners bracket. | Core needs lower-bracket topology and placement rules. |
| Third-place game | Cosmetic only for native Redraft | Defaults/settings expose it; native Redraft route does not create a third-place matchup. | Core should optionally create and finalize third-place matchup. |
| Toilet bowl | Cosmetic only for native Redraft | UI/API can store lower bracket type; route ignores it. | Plugin/core lower bracket policy should define loser advancement. |
| Playoff weeks per round | Cosmetic/partially wired | Settings exist; Redraft rows have no week span and advancement accepts week but does not enforce round length. | Core should map rounds to week windows. |
| Division winners | Partially wired in generic seeding | `server/services/playoffEngine.ts` supports division-winners-first for `FantasyStanding`; Redraft generate route does not use it. | Qualification policy should support division champions across adapters. |
| Tiebreakers | Partially wired | Defaults/settings exist; generic seeding supports limited rules; Redraft route uses wins/PF/PA hardcoded. | Core should evaluate ordered tiebreaker list. |
| Manual commissioner overrides | Missing/implicit | Commissioner can generate/advance/finalize, but no manual seed/winner override API was found for native Redraft. | Core needs auditable seed, matchup, winner, and bracket override operations. |
| Trophies/history | Partially wired | `LeagueChampionship` is written on finalization; season-history snapshots are not written here. | Core finalization should publish common history/trophy outputs. |
| Payouts/dues hooks | Missing | Finance/payout models exist; finalization does not trigger them. | Core should emit events/hooks for finance without directly moving money. |

## 8. Gap Table

| Severity | File | Reason | Future impact |
| --- | --- | --- | --- |
| High | `app/api/redraft/playoffs/generate/route.ts` | Bracket generation lives in a route and duplicates/ignores helper engine logic. | Hard to reuse for Dynasty, Keeper, Best Ball, or C2C. |
| High | `app/api/redraft/playoffs/generate/route.ts` | Does not consume `lib/playoff-defaults` resolved config. | Commissioner settings can be cosmetic or inconsistently enforced. |
| High | `lib/redraft/playoffEngine.ts` | Advancement is Redraft table-specific. | Future concepts need their own advancement unless a core adapter boundary exists. |
| High | `lib/redraft/playoffEngine.ts` | Finalization is Redraft-specific but writes platform-level `LeagueChampionship`. | Core trophy/history output is coupled to Redraft roster identity. |
| High | `lib/events/catalog.ts` and playoff paths | `PLAYOFF_BRACKET_GENERATED` and `PLAYOFF_ADVANCED` exist but are not emitted by native Redraft paths. | Plugins and automation cannot subscribe reliably to playoff transitions. |
| High | `app/api/redraft/playoffs/generate/route.ts` | Regeneration deletes bracket rows by default without a preservation/lock/override model. | Commissioner edits and historical playoff state can be lost. |
| Medium | `server/services/playoffEngine.ts` | Generic seeding uses `FantasyStanding`; Redraft generation uses `RedraftRoster`. | Seed logic can diverge between platform standings and Redraft standings. |
| Medium | `lib/playoff-defaults/*` | Defaults are robust but not authoritative for native Redraft generation. | Future formats may inherit settings that do not affect behavior. |
| Medium | `app/league/[leagueId]/components/settings/PlayoffSettingsPanel.tsx` | UI offers settings not enforced by native bracket generation. | Commissioner trust risk when settings appear active. |
| Medium | `lib/redraft/oddPlayoffBracket.ts` | Odd-size bracket helper exists but is not integrated into Redraft route/UI. | Odd playoff size support remains incomplete. |
| Medium | `lib/redraft/playoffEngine.ts` | Tie resolution falls back to seed if available. | Tiebreaker policy is not settings-driven or plugin-aware. |
| Medium | `server/services/leagueLifecycleService.ts` | Lifecycle supports `playoffs`, but bracket generation does not transition into it. | Playoff permissions and phase behavior may not align with bracket state. |
| Medium | `prisma/schema.prisma` `RedraftPlayoffMatchup` | No explicit week/window fields for multi-week rounds or championship length. | Multi-week playoff formats are difficult to enforce. |
| Medium | `prisma/schema.prisma` `RedraftPlayoff*` | No manual override audit metadata beyond generic JSON metadata. | Commissioner adjustments are hard to explain or replay. |
| Medium | `lib/league/history-aggregates.ts` | History aggregates `LeagueSeason`, but finalization does not create a season snapshot. | Hall-of-fame/history can lag behind champion finalization. |
| Medium | Finance/payout routes and models | Payout/dues models exist but are not hooked to champion finalization. | Paid league closeout remains manual or separate. |
| Low | `lib/playoffs/*` | Playoff challenge product uses similar bracket terms but separate models. | Naming confusion unless boundaries stay documented. |
| Low | `lib/playoff-settings/*` | Advanced postseason-stage config affects schedule settings, not native bracket execution. | Useful future input, but not a Core Playoff Engine yet. |

## 9. Staged Migration Plan

Smallest-risk path:

1. Keep G14 audit-first and documentation-only.
   - Do not rewrite Redraft playoffs.
   - Keep readiness at NFL Engine 93% and Overall Platform 90%.

2. Add focused tests before extraction.
   - Redraft bracket generation for 4, 6, 8, odd sizes, and byes.
   - Settings enforcement for playoff teams, byes, lower bracket, third-place, and reseeding.
   - Advancement idempotency and blocked tie states.
   - Finalization idempotency and event emission.

3. Introduce Core Playoff types only.
   - Participants, qualification policy, seeding policy, bracket policy, bracket plan, and advancement result.
   - Keep persistence in Redraft adapter.

4. Move Redraft generation out of the route into a Redraft playoff service.
   - Preserve existing output.
   - Route calls service.
   - Add parity tests.

5. Make resolved playoff config authoritative.
   - Generate Redraft brackets from `getPlayoffConfigForLeague`.
   - Keep existing request-body overrides only as explicit commissioner overrides.

6. Emit existing platform events.
   - `EVENT.PLAYOFF_BRACKET_GENERATED` after successful generation.
   - `EVENT.PLAYOFF_ADVANCED` after advancement.
   - Keep `EVENT.CHAMPION_CROWNED` and `EVENT.SEASON_COMPLETED` in finalization.

7. Add lifecycle transition into playoffs.
   - Bracket generation or season activation should transition `League.lifecycleState` to `playoffs` at the correct time.
   - Avoid entering playoffs before regular-season standings are locked.

8. Add lower bracket and third-place support.
   - Implement topology only after settings and tests are authoritative.
   - Preserve Redraft behavior when disabled.

9. Add plugin adapters.
   - Best Ball points-only.
   - Dynasty/Keeper history-aware outputs.
   - C2C/Devy hybrid qualification.
   - Tournament phase adapter.
   - Guillotine/Survivor/Zombie no-bracket or finale plugins.

10. Add history, trophies, and payout hooks.
    - Keep money movement outside the Playoff Engine.
    - Emit closeout events for payout/dues workflows.
    - Write season snapshots through a lifecycle/history engine boundary.

## 10. Tests Run and Results

Focused tests to run for G14:

```text
npx vitest run __tests__/redraft/playoff-advance.test.ts __tests__/redraft/playoff-finalize.test.ts __tests__/playoff-defaults-by-sport.test.ts __tests__/c2c-season-playoffs-matrix.test.ts __tests__/redraft/draft-finalize-schedule.test.ts __tests__/redraft/standings-api.test.ts
```

Why these tests:

- Redraft advancement and finalization cover native playoff behavior.
- Playoff defaults cover settings/default resolution.
- C2C season/playoffs matrix covers a future-format playoff simulation boundary.
- Draft finalize schedule and standings tests keep regular-season schedule/standings boundaries visible without moving them into the Playoff Engine.

Result:

```text
Test Files  6 passed (6)
Tests       96 passed (96)
```

## Classification Summary

| Area | Classification | Notes |
| --- | --- | --- |
| Regular-season matchup generation | Regular-season schedule | G13 only. |
| Playoff start week as schedule cutoff | Regular-season schedule plus commissioner setting | Schedule consumes the boundary; Playoff Engine consumes activation timing. |
| Redraft roster W/L/PF standings | Standings/tiebreaker | Input to qualification, not bracket topology. |
| FantasyStanding playoff seed refresh | Standings/tiebreaker | Generic seeding path, not native Redraft bracket generation. |
| RedraftPlayoff* rows | Playoff bracket | Native Redraft persistence adapter candidate. |
| Redraft bracket generation route | Playoff bracket | Should move behind service before becoming core. |
| `advancePlayoffWinners` | Playoff bracket | Core advancement candidate, currently Redraft-specific. |
| `finalizeRedraftSeasonChampion` | Season lifecycle plus trophies/history | Core finalization candidate, currently Redraft-specific. |
| `League.lifecycleState = completed` | Season lifecycle | Should be lifecycle service-owned eventually. |
| `LeagueChampionship` upsert | Trophies/history | Platform output, not Redraft-only long term. |
| Playoff settings UI/API | Commissioner setting | Partially enforced by native Redraft. |
| Playoff challenge product | Future plugin/separate product | Do not merge with fantasy league playoff engine. |
| Payout/dues | Future plugin behavior | Should subscribe to closeout events later. |

## Readiness Recommendation

Do not move to 94% from this audit alone.

The audit clarifies the Core Playoff Engine boundary, but native playoff behavior has not yet become materially more reusable, deterministic, or broadly verified across future league formats. The correct hold remains:

- NFL Engine: 93%
- Overall Platform: 90%

Move toward 94% only after:

- Redraft bracket generation leaves the route and uses one tested service.
- Resolved playoff settings become authoritative.
- Existing playoff events are emitted.
- Advancement and finalization have adapter boundaries.
- Lower bracket, third-place, byes, odd sizes, and reseeding are either enforced or explicitly disabled in UI/settings.
- Regular-season scheduling remains isolated in G13.
