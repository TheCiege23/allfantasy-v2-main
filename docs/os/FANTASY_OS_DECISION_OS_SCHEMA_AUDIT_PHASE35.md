# Decision OS Schema Audit (Phase 35, Track A)

## Fresh inventory of every Decision OS table referenced by `lib/decision-os/*`, Mission Control, League Analytics, Commissioner Hub, Commissioner OS, and manager-facing intelligence

| Table (`@@map`) | Prisma model | Status (start of phase) | Status (end of phase) |
|---|---|---|---|
| `decision_os_imported_activity` | `DecisionOsImportedActivity` | **Missing** (real Prisma runtime errors confirmed in Phase 33/34) | **Present**, 0 rows |
| `decision_os_behavioral_snapshot` | `DecisionOsBehavioralSnapshot` | **Missing** | **Present**, 0 rows |
| `decision_os_league_context` | `DecisionOsLeagueContext` | **Missing** | **Present**, 0 rows |

All three models are fully, correctly defined in `prisma/schema.prisma` (lines 16235-16310+) with real field types, indexes, and enums — the schema DEFINITION was never in question, only the actual database table's existence in `.env.test`.

No other Decision OS-referenced table was found missing. All other tables `lib/decision-os/*`, Mission Control, League Analytics, Commissioner Hub, and Commissioner OS depend on (e.g. `League`, `Roster`, `FantasyStanding`, `TeamWeekResult`) already existed (confirmed across Phases 25-34's cumulative real-data audits) — their emptiness (e.g. `FantasyStanding` has 0 rows) is a data-population gap, not a schema gap, and is out of this phase's scope.

## Classification

| Table | Present / Missing / Deprecated / Shadow / Unknown |
|---|---|
| `decision_os_imported_activity` | Was **Missing** → now **Present** (real, active schema — code that reads it is real, live-callable, not deprecated or shadow) |
| `decision_os_behavioral_snapshot` | Was **Missing** → now **Present** |
| `decision_os_league_context` | Was **Missing** → now **Present** |

None of the three are deprecated or shadow schema — the code paths that read them (`lib/decision-os/behavioral/api/real-data-provider.ts`, `lib/decision-os/snapshot/prismaBehavioralSnapshotStore.ts`, `lib/decision-os/leagueContext.ts`) are real, active, currently-imported modules used by Mission Control/League Analytics, which are themselves real and called by real production routes (`/commissioner-hub`, `app/commissioner-os/*`, and this session's own Commissioner shadow module).
