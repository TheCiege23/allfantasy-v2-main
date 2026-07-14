# G13 Core Schedule Engine Audit

Status: audit complete, no engine extraction in this milestone.

Readiness hold:

- NFL Engine: 93%
- Overall Platform: 90%

This audit treats the Schedule Engine as the regular-season fantasy matchup engine. Playoff bracket generation, playoff advancement, and champion finalization are documented as G14 Playoff Engine work.

## Scope boundary

Core Schedule Engine scope:

- Regular-season fantasy opponent scheduling
- Schedule creation, regeneration, edit preservation, import preservation, locking, and lifecycle events
- Team/roster schedule slots, weeks, byes, divisions, doubleheaders, and deterministic generation strategies
- Interfaces consumed by live scoring, matchup center, standings, and commissioner controls

Out of scope for G13:

- Playoff bracket generation
- Playoff bracket advancement
- Playoff reseeding
- Champion finalization
- Playoff-specific commissioner tools

The regular schedule may know the `playoffStartWeek` only as a boundary for ending the regular season. It should not own bracket topology or advancement.

## 1. Schedule Architecture Map

### Current owners

Regular-season scheduling is currently owned by Redraft paths:

- `lib/redraft/scheduleEngine.ts`
  - Generates Redraft regular-season matchups.
  - Uses a round-robin rotation with optional bye rows for odd team counts.
  - Stops generation at `playoffStartWeek - 1`.
  - Accepts `medianGame`, but persisted Redraft callers filter median matchups out.
- `lib/redraft/finalizeDraftToRedraftSeason.ts`
  - Bridges a completed draft into `RedraftSeason`, `RedraftRoster`, `RedraftRosterPlayer`, and `RedraftMatchup`.
  - Creates the schedule only when the season has no existing `RedraftMatchup` rows.
  - Emits `EVENT.SEASON_ACTIVATED` after post-draft sync.
- `app/api/redraft/season/route.ts`
  - Directly creates Redraft seasons and schedules.
  - Duplicates schedule persistence logic instead of using the finalization service.
- `prisma/schema.prisma`
  - `RedraftSeason`, `RedraftRoster`, and `RedraftMatchup` are the authoritative native Redraft schedule tables.

Related but not authoritative schedule systems:

- `server/services/roundRobinSchedule.ts`
  - Generic round-robin helper used by `server/services/weeklyProcessor.ts`.
  - Not used by the Redraft schedule generator.
- `lib/schedule-defaults/*`
  - League schedule settings bootstrap and config resolution.
  - Defines settings such as regular-season length, cadence, doubleheader behavior, reschedule policy, and generation strategy.
  - Does not generate or persist native matchups.
- `lib/sport-defaults/*`
  - Sport-level defaults and schedule templates.
  - Contains separate schedule defaults that do not currently drive Redraft generation.
- `lib/fantasy-schedule/*`
  - Real-world sports calendar and fantasy scoring day planning.
  - This is not the fantasy opponent schedule engine.
- `lib/league-import/*`
  - Normalizes imported provider schedules and commits imported league data.
  - Imported schedules are not currently persisted as native `RedraftMatchup` schedules.

### Current creation flow

Observed post-draft path:

```text
Draft session completed
  -> platform draft completion event emitted by draft engine
  -> Redraft post-draft sync runs
  -> RedraftSeason created or found
  -> RedraftRoster rows created or found
  -> RedraftRosterPlayer rows synced
  -> RedraftMatchup rows generated if none exist
  -> EVENT.SEASON_ACTIVATED emitted
```

Observed direct season API path:

```text
POST /api/redraft/season
  -> commissioner/member permission check
  -> RedraftSeason created
  -> RedraftRoster rows created from League teams
  -> generateSchedule called inline
  -> RedraftMatchup rows inserted inline
```

### Persistence

Current native schedule persistence is `RedraftMatchup`:

- `seasonId`
- `week`
- `type`
- `homeRosterId`
- `awayRosterId`
- `homeScore`
- `awayScore`
- `status`
- `winnerRosterId`
- `lineupSnapshots`

Current limitations:

- No schedule version.
- No generated/imported/manual origin.
- No lock flag.
- No commissioner edit metadata.
- No preserved manual edit marker.
- No imported provider schedule reference.
- No unique schedule-slot constraint.

### Determinism

The Redraft generator itself is deterministic for the same ordered roster input. Determinism at the system boundary is weaker:

- The finalization path orders Redraft rosters by id before generation.
- The direct season API path depends on team relation ordering unless explicitly sorted.
- The generic weekly processor uses a separate round-robin helper and can diverge from Redraft output.
- Multiple schedule default sources disagree about season length and playoff transition semantics.

## 2. Current Dependency Graph

```text
Draft Engine
  -> lib/live-draft-engine/DraftSessionService.ts
  -> EVENT.DRAFT_COMPLETED
  -> Redraft post-draft finalization
       -> lib/redraft/finalizeDraftToRedraftSeason.ts
       -> lib/redraft/scheduleEngine.ts
       -> prisma.RedraftSeason
       -> prisma.RedraftRoster
       -> prisma.RedraftMatchup
       -> EVENT.SEASON_ACTIVATED

Redraft Season API
  -> app/api/redraft/season/route.ts
  -> lib/redraft/scheduleEngine.ts
  -> prisma.RedraftSeason
  -> prisma.RedraftRoster
  -> prisma.RedraftMatchup

Live Scoring
  -> server/services/liveScoring/liveScoreRunner.ts
  -> lib/redraft/scoringEngine.ts
  -> prisma.RedraftMatchup
  -> lib/redraft/standingsEngine.ts

Matchup Center
  -> server/services/matchupSources/redraftMatchupSource.ts
  -> prisma.RedraftSeason
  -> prisma.RedraftMatchup
  -> prisma.RedraftRoster

Generic Weekly Processor
  -> server/services/weeklyProcessor.ts
  -> server/services/roundRobinSchedule.ts
  -> prisma.TeamWeekResult
  -> server/services/matchupEngine.ts
  -> server/services/standingsEngine.ts

Commissioner Schedule Settings
  -> app/api/commissioner/leagues/[leagueId]/schedule/route.ts
  -> League.settings
  -> lib/schedule-defaults/*

Playoffs, G14 boundary
  -> app/api/redraft/playoffs/generate/route.ts
  -> app/api/redraft/playoffs/advance/route.ts
  -> lib/redraft/playoffEngine.ts
  -> server/services/playoffEngine.ts
  -> prisma.RedraftPlayoff*
```

Key dependency finding:

The platform already has schedule-related configuration, real-world calendar tools, Redraft matchup rows, generic round-robin helpers, and playoff services. They are not currently unified under one Core Schedule Engine contract.

## 3. Redraft-only Logic

The following should remain Redraft adapters or be lifted carefully behind a core interface:

- `RedraftSeason` creation and status management.
- `RedraftRoster` and `RedraftRosterPlayer` creation.
- `RedraftMatchup` persistence.
- Redraft scoring status values on matchup rows.
- Redraft standings updates from final/completed matchup rows.
- Redraft UI fetching current week matchups.
- Redraft live scoring runner selection of active Redraft seasons.
- Redraft playoff generation and advancement. This is not Schedule Engine work.

Redraft-specific assumptions found:

- Schedule generation assumes roster rows are the schedule participants.
- Bye weeks are represented as `awayRosterId = null`.
- A generated schedule row is also the scoring container.
- The regular-season end is derived from `playoffStartWeek - 1`.
- Median game output exists in the generator but is not persisted by Redraft season creation.
- No division-aware regular-season generation is present.
- No doubleheader generation is present.
- No native custom schedule preservation is present.
- No commissioner schedule lock is present.

## 4. Core Schedule Candidates

The audit supports these as candidates for a Core Schedule Engine, but not a large extraction in G13:

### Core contracts

- `ScheduleParticipant`
  - Stable participant id, display id, division/conference metadata, eligibility, and plugin metadata.
- `SchedulePolicy`
  - Regular-season weeks, matchup frequency, byes, doubleheaders, division rules, balance rules, and generation strategy.
- `ScheduleSlot`
  - Week, slot index, home participant, away participant, type, origin, and strategy metadata.
- `SchedulePlan`
  - Ordered schedule slots plus warnings, skipped participants, byes, and deterministic seed/version metadata.
- `SchedulePersistencePort`
  - Writes generated slots without coupling core generation to `RedraftMatchup`.
- `ScheduleSource`
  - Reads schedule slots for live scoring, matchup center, standings, and commissioner tooling.

### Core algorithms

- Round-robin pairing.
- Odd-team bye allocation.
- Deterministic participant ordering.
- Schedule-slot idempotency.
- Division-balanced strategy.
- Doubleheader strategy.
- Imported schedule validation.

### Core events

- `EVENT.SCHEDULE_GENERATED`
  - Already exists in the platform event catalog.
  - Not currently emitted by Redraft schedule creation.
- Future candidate events:
  - `SCHEDULE_REGENERATED`
  - `SCHEDULE_LOCKED`
  - `SCHEDULE_UNLOCKED`
  - `SCHEDULE_EDITED`
  - `SCHEDULE_IMPORTED`
  - `WEEK_ADVANCED`

Do not add future events until a concrete consumer exists.

## 5. Plugin Extension Points

Core should provide regular-season schedule primitives. League concepts should plug into strategy and lifecycle rules.

Recommended extension points:

- `ScheduleStrategy`
  - Round robin, division-balanced, doubleheader, imported, tournament phase, or no-H2H cumulative modes.
- `ScheduleParticipantResolver`
  - Maps league teams, rosters, entries, survivor participants, or tournament entrants into core participants.
- `SchedulePolicyResolver`
  - Combines sport defaults, league settings, commissioner overrides, and plugin requirements.
- `SchedulePersistenceAdapter`
  - Persists schedule slots into Redraft rows today and future concept-specific rows later.
- `ScheduleLockPolicy`
  - Controls when regeneration is allowed and how manual edits are preserved.
- `ScheduleReadModel`
  - Provides stable schedule lookup to live scoring, matchup center, standings, and UI.

Future format notes:

- Redraft: standard H2H regular-season schedule; Redraft adapter persists to `RedraftMatchup`.
- Dynasty: likely reuses H2H schedule but may need divisions, rivalry weeks, and multi-year continuity.
- Keeper: likely reuses Redraft-style H2H with retained roster identity.
- Best Ball: may use schedule slots for H2H variants, but cumulative formats should not be forced into H2H.
- Guillotine: elimination cadence belongs to plugin lifecycle; regular schedule may be absent or auxiliary.
- Survivor: survival rules belong to plugin lifecycle; schedule may be pick/cutoff based rather than H2H.
- Tournament: bracket/phase scheduling should be a plugin strategy; playoff advancement remains G14.
- Zombie: infection/revival rules belong to plugin lifecycle; schedule can consume active participant state.
- Big Brother: ceremonies and eviction rules belong to plugin lifecycle; schedule may be episode/week based.
- Devy: schedule can reuse core, but player universe/scoring overlays are plugin concerns.
- C2C: schedule can reuse core, but college/pro roster layers and scoring overlays are plugin concerns.
- IDP: schedule can reuse core; roster/scoring categories are not schedule concerns.

## 6. Event Flow

### Target platform flow

```text
Draft Complete
  -> Schedule Generated
  -> Season Activated
  -> Week Advanced
  -> Playoffs
  -> Season Complete
```

### Observed flow today

```text
EVENT.DRAFT_COMPLETED
  -> Redraft finalization/sync
  -> Redraft schedule rows generated silently
  -> EVENT.SEASON_ACTIVATED
  -> live scoring updates RedraftMatchup rows
  -> standings recomputed
  -> playoff generation/advancement routes run separately
  -> EVENT.SEASON_COMPLETED
```

### Event gaps

- `EVENT.SCHEDULE_GENERATED` exists but is not emitted by the Redraft schedule creation paths.
- There is no observed central `WEEK_ADVANCED` platform event for Redraft schedule progression.
- Playoff generation and advancement are route/service flows, not Schedule Engine events.
- `EVENT.SEASON_COMPLETED` is emitted by Redraft champion finalization, which belongs to G14 Playoff Engine boundaries.

### Playoff boundary for G14

The following files contain playoff logic and should not be merged into the Core Schedule Engine:

- `lib/redraft/playoffEngine.ts`
- `app/api/redraft/playoffs/generate/route.ts`
- `app/api/redraft/playoffs/advance/route.ts`
- `app/api/redraft/seasons/finalize/route.ts`
- `server/services/playoffEngine.ts`
- `app/api/leagues/[leagueId]/scoring/playoff-seeds/route.ts`

G14 should audit:

- Bracket generation ownership.
- Duplicate playoff generation between route-level code and `lib/redraft/playoffEngine.ts`.
- Seed calculation consistency between Redraft standings and generic `FantasyStanding`.
- Advancement, tie-breaking, reseeding, consolation, and champion finalization.
- Playoff events and commissioner override authority.

## 7. Gap Table

| Severity | File | Reason | Future impact |
| --- | --- | --- | --- |
| High | `lib/redraft/finalizeDraftToRedraftSeason.ts` and `app/api/redraft/season/route.ts` | Schedule generation and persistence are duplicated across post-draft finalization and direct season creation. | Future schedule fixes can land in one path and miss the other. |
| High | `lib/redraft/scheduleEngine.ts` and `server/services/roundRobinSchedule.ts` | Two round-robin implementations exist with different call sites. | Redraft and generic leagues can diverge on byes, ordering, and pairing behavior. |
| High | `lib/events/catalog.ts` plus schedule creation paths | `EVENT.SCHEDULE_GENERATED` exists but is not emitted. | Future league plugins cannot reliably subscribe to schedule creation. |
| High | `prisma/schema.prisma` `RedraftMatchup` | Schedule rows have no origin, lock state, edit metadata, version, or import reference. | Commissioner edits, imports, and safe regeneration cannot be preserved cleanly. |
| High | `lib/sportConfig/configs/nfl.ts`, `lib/sport-defaults/DefaultScheduleConfigResolver.ts`, `lib/sport-defaults/ScheduleTemplateResolver.ts` | NFL schedule defaults disagree across sources. | Future concepts may inherit inconsistent season lengths and playoff transition points. |
| Medium | `app/api/redraft/season/route.ts` | Direct season creation depends on route-level schedule writes. | Harder to introduce one schedule-generation contract without route-specific regressions. |
| Medium | `lib/redraft/scheduleEngine.ts` | No division-aware, balance-aware, or doubleheader strategy exists. | Dynasty, keeper, tournament, and commissioner-custom formats will need plugin hooks before reuse. |
| Medium | `lib/redraft/scheduleEngine.ts` | Median matchup rows are generated but filtered out by persistence paths. | Median scoring remains a setting-shaped concept without a schedule read/write contract. |
| Medium | `app/api/commissioner/leagues/[leagueId]/schedule/route.ts` | Commissioner schedule API edits settings only, not native matchup rows. | Users cannot safely edit, lock, regenerate, or import native schedules through commissioner controls. |
| Medium | `lib/league-import/*` | Imported provider schedules are normalized but not committed as native Redraft schedules. | Imported leagues cannot preserve provider schedules as first-class native matchups. |
| Medium | `server/services/liveScoring/liveScoreRunner.ts` and `lib/redraft/scoringEngine.ts` | Live scoring is coupled to `RedraftMatchup` rows. | Future league types need a schedule read model before sharing live scoring cleanly. |
| Medium | `server/services/matchupSources/redraftMatchupSource.ts` | Matchup Center has a useful source boundary but still reads Redraft tables directly. | This can become the read-model adapter, but it is not yet a Core Schedule interface. |
| Medium | `lib/redraft/standingsEngine.ts` | Standings are recomputed from final/completed Redraft matchup rows and skip byes implicitly. | Alternate schedule types need explicit schedule semantics so standings do not infer too much from row shape. |
| Medium | `server/services/weeklyProcessor.ts` | Generic weekly processing generates pairings from a separate helper and persists `TeamWeekResult`, not schedule slots. | Generic and Redraft schedule lifecycles remain parallel systems. |
| Low | `app/league/[leagueId]/tabs/RedraftTab.tsx` | UI reads current-week Redraft matchup data only. | A future schedule editor/list needs a read model, but no customer-visible change is required for G13. |
| Low | `lib/redraft/lineupLock.ts` | Lineup locks are real-game kickoff locks, not fantasy schedule locks. | Avoid conflating lineup locking with schedule locking in the Core Schedule Engine. |

## 8. Migration Plan

Smallest-risk path:

1. Keep G13 as audit-first and documentation-only.
   - Do not extract the engine before the ownership boundary is agreed.
   - Hold readiness at NFL Engine 93% and Overall Platform 90%.

2. Add deterministic schedule tests around current Redraft behavior.
   - Round robin.
   - Odd team count byes.
   - Regular-season cutoff at `playoffStartWeek - 1`.
   - Idempotent finalization when matchups already exist.
   - Direct season API parity with post-draft finalization.

3. Introduce a small Core Schedule contract without changing behavior.
   - Add core types for participants, policy, slots, and plans.
   - Wrap existing Redraft generation output rather than replacing it.
   - Keep Redraft persistence in the Redraft adapter.

4. Consolidate round-robin logic.
   - Choose one deterministic pairing helper.
   - Add tests proving Redraft output is unchanged.
   - Migrate Redraft generation to the shared helper only after parity is proven.

5. Centralize Redraft schedule creation.
   - Move duplicated route-level persistence into a Redraft schedule service.
   - Keep the service behind Redraft names until the core contract is stable.
   - Emit `EVENT.SCHEDULE_GENERATED` only after both post-draft and direct season creation use the same service.

6. Resolve schedule defaults.
   - Reconcile `sportConfig`, `sport-defaults`, and `schedule-defaults`.
   - Define whether `regularSeasonWeeks`, `totalWeeks`, and `playoffStartWeek` are separate concepts.
   - Prevent plugins from inheriting conflicting NFL defaults.

7. Add edit and import preservation metadata.
   - Prefer additive schema fields or a separate schedule metadata table.
   - Track generated, manual, imported, locked, and regenerated states.
   - Do not add regeneration features until preservation semantics are explicit.

8. Add commissioner schedule controls.
   - Manual edit.
   - Regenerate with preserve-edits mode.
   - Lock and unlock schedule.
   - Import provider schedule.
   - Audit trail.

9. Add plugin strategies.
   - Division-balanced regular season.
   - Doubleheaders.
   - Best-ball cumulative/no-H2H mode.
   - Guillotine/survivor participant-state adapters.
   - Tournament phase schedule strategy.

10. Hand playoffs to G14.
    - Keep regular-season schedule generation separate from bracket generation and advancement.
    - G14 should own playoff bracket lifecycle, seeding, advancement, champion finalization, and playoff events.

## Testing Matrix

Required before implementation moves beyond documentation:

| Area | Current status | Needed test coverage |
| --- | --- | --- |
| Schedule generation | Exists in Redraft generator | Deterministic even/odd team round robin |
| Regeneration | Not first-class | Idempotency and preserve-edit tests before adding API |
| Commissioner edits | Not first-class | Manual edit, lock, unlock, audit, and preserve tests |
| Imported schedules | Normalized outside native schedule | Imported schedule persistence and preservation tests |
| Odd team counts | Supported with bye rows | Bye distribution and scoring/standings compatibility |
| Divisions | Not implemented in Redraft schedule | Strategy tests once a division strategy exists |
| Doubleheaders | Settings exist, generation absent | Strategy tests once implemented |
| Playoff separation | Playoff code separate but route-owned | Tests should assert regular schedule generation does not create playoff bracket rows |
| Live scoring compatibility | Reads `RedraftMatchup` | Schedule read-model tests before cross-format reuse |

## G13 Verification

Focused verification now passes after making Vitest path resolution portable for the current checkout:

```text
npx vitest run __tests__/redraft/schedule-generator-ordering.test.ts __tests__/redraft/draft-finalize-schedule.test.ts __tests__/schedule-defaults-by-sport.test.ts
```

Result:

```text
Test Files  3 passed (3)
Tests       20 passed (20)
```

The Vitest fix was limited to test configuration. No production code or schedule-engine behavior changed.

## Readiness Recommendation

Do not move to 94% from this audit alone.

G13 confirms the right architecture direction and identifies a clean Core Schedule Engine boundary, but the engine has not yet become materially more reusable, deterministic, testable, or extensible across future league formats. The correct hold remains:

- NFL Engine: 93%
- Overall Platform: 90%

Move toward 94% only after:

- Redraft schedule creation uses one shared service.
- Round-robin generation has one tested implementation.
- `EVENT.SCHEDULE_GENERATED` is emitted from every schedule creation path.
- Schedule defaults are reconciled.
- Native schedule metadata can support lock/edit/import preservation.
- Playoff bracket advancement remains isolated for G14.
