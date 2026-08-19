# Decision OS Core — Phase 1 Implementation Note

**Follows:** `docs/DECISION_OS_CORE_UNIFICATION_PLAN.md` §18 step 1
**Branch:** `g15-event-foundation`
**Scope:** Additive only. Zero existing files modified. Zero live routes touched.

## What was added

New, currently-unimported module: `lib/decision-os-core/`

| File | Purpose |
|---|---|
| `primitives/types.ts` | The 26 requested sport-agnostic primitives (Sport, Competition, League, Contest, Season, Event, Participant, Player, Team, Roster, Slot, Asset, Transaction, Draft, Pick, RuleSet, ScoringModel, ScheduleModel, StandingsModel, PlayoffModel, WaiverModel, TradeModel, Simulation, Recommendation, Insight, DecisionEvent) |
| `events/types.ts` | `DecisionEvent` — a type alias of the existing `BehavioralEvent` (`lib/decision-os/behavioral/events/types.ts`), not a new taxonomy |
| `context/types.ts` | `DecisionOSContext`, `LeagueStateGraph`, `UserContextGraph`, `PlatformContextGraph`, `SportRef` |
| `results/types.ts` | `RecommendationResult`, `InsightResult`, `SimulationResult` — wrap the existing `Decision<TAction>` / `DecisionOSInsight` types unchanged |
| `sport-adapter/types.ts` | `SportAdapter` contract, generalizing `lib/redraft/sportAdapters` |
| `sport-adapter/registry.ts` | `SportAdapterRegistry` class + shared singleton — register/resolve/tryResolve/list/clear |
| `sport-adapter/adapters/fromSportConfig.ts` | Factory building a real `SportAdapter` from the existing `lib/sportConfig` registry (13 sports: NFL, NCAAF, NBA, NCAAB, MLB, NHL, SOCCER, GOLF, NASCAR, WWE, CRICKET, HORSE_RACING, TENNIS), delegating to the existing `lib/redraft/sportAdapters` per-sport stat parsing/lock-time logic where one exists |
| `sport-adapter/adapters/index.ts` | `registerDefaultSportAdapters()` — explicit opt-in registration, no side effects on import |
| `provider-adapter/types.ts` | `ProviderAdapter` contract, reusing `lib/providers/providerFallbackPolicy.ts`'s existing `DataDomain`/`ProviderName` unions verbatim |
| `provider-adapter/registry.ts` | `ProviderAdapterRegistry` class + shared singleton |
| `provider-adapter/adapters/fromProviderFallbackPolicy.ts` | Factory deriving `supportedDomains` for each of the 5 known providers from the existing fallback chains. `fetch()` intentionally throws `ProviderFetchNotWiredError` — see below |
| `provider-adapter/adapters/index.ts` | `registerDefaultProviderAdapters()` — explicit opt-in registration |
| `index.ts` | Barrel export of the above. Not imported from anywhere. |
| `__tests__/*.test.ts` (4 files, 28 tests) | Contract tests for both registries, the SportConfig/fallback-policy factories, `DecisionEvent` aliasing, and a repo-wide scan proving nothing under `app/` or `lib/decision-os/` references `decision-os-core` yet |

## What was intentionally not touched

- **No existing file was modified.** Everything above is net-new.
- **No live route imports any of this.** Enforced by `__tests__/no-live-imports.test.ts`, which scans `app/` and `lib/decision-os/` for the string `decision-os-core` and fails if found.
- **No Decision OS behavior changed.** The one hardcoded NFL check in `lib/decision-os/commissioner-health/dco.ts:47` was left as-is per the plan's explicit instruction — it's inside frozen, shadow-live code and needs a parity re-run before any change, not a Phase 1 concern.
- **No Commissioner OS, Chimmy, draft, waiver, trade, scoring, schedule, playoff, or roster engine code was refactored.**
- **No duplicate manager-DNA / league-health code was removed** — `lib/manager-dna.ts`, `lib/gm-profile`, `lib/league-health` are all untouched.
- **`ProviderAdapter.fetch()` is a stub that throws `ProviderFetchNotWiredError`, not a real implementation.** Wiring it to actual provider clients (Sleeper, ESPN, etc.) would touch live integration code and was explicitly out of scope for this phase. The registry currently only exposes the existing fallback-policy metadata (which domains each provider serves).
- **`SportAdapter`s built from `lib/sportConfig` are read-only wrappers.** No sport config file was changed; `buildSportAdapterFromConfig` only derives new fields (`scheduleUnit`, `competitionStructure`, `rosterSlotCategories`, `scoringStatVocabulary`) from data that already exists in `SportConfigFull`.

## Verification performed

- `npx vitest run lib/decision-os-core/__tests__/` — **28/28 tests passing**, 4 test files.
- Full-repo `npm run typecheck` — completed with its existing pre-existing baseline errors (all in unrelated files, e.g. `app/ai-chat/page.tsx`, `app/api/admin/world-cup/...`); **zero errors reference any file under `lib/decision-os-core/`**.
- No files outside `lib/decision-os-core/` and `docs/` were created or modified.

## Next recommended phase

Per `docs/DECISION_OS_CORE_UNIFICATION_PLAN.md` §18 step 3 onward:

1. Migrate the one real internal caller candidate — `lib/decision-os/commissioner-health/dco.ts:47`'s hardcoded `sport === 'NFL'` string check — to resolve through `sportAdapterRegistry` instead, **gated by a parity re-run** since that file is inside a live shadow slice.
2. Begin the manager-DNA de-duplication (`lib/manager-dna.ts` / `lib/gm-profile` → `lib/decision-os/phase6/dna`) behind parity tests, independent of this module.
3. Only after both of the above: wire a first real consumer (Chimmy's league-context provider, per plan §8.6) through `LeagueStateGraph`, behind a flag, shadow-compared against its current output.

## Risks to watch

- `buildSportAdapterFromConfig`'s `deriveScheduleUnit`/`deriveCompetitionStructure` heuristics are honest best-effort derivations from existing config fields (`lineupLockType`, `lineupFrequency`) — they are **not** validated against real non-NFL league data yet. Before using them to drive any real decision, add contract tests against actual league configs for at least one non-weekly sport (golf/tennis) to confirm the `'slate'` classification is correct.
- The `ProviderAdapter.fetch()` stub means the registry is metadata-only today. Anyone tempted to wire it directly to a real provider client should do so as its own reviewed change, not silently inside a future unrelated PR.
