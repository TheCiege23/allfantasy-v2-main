# G33 Canonical League Runtime and Decision OS

## Scope

G33 establishes a canonical NFL Redraft league runtime contract without changing league state rules, adding new engines, or fabricating data.

The runtime source of truth remains commissioner-controlled league settings:

- `League` stores commissioner settings, lifecycle state, roster/trade/waiver/playoff settings, and league-level premium toggles.
- `LeagueSettings` stores draft room and draft-time behavior.
- Existing effective resolvers remain the authoritative adapters for draft, scoring, waivers, playoffs, and schedule.
- Runtime events are normalized into stable dot-name event types for read-only consumers.
- Decision OS consumes canonical rules plus normalized events and produces deterministic evidence. It does not mutate league state or own league logic.

## Audit Notes

Current league rule ownership is distributed but usable:

- Draft runtime config is resolved by `lib/draft-defaults/DraftRoomConfigResolver.ts`.
- Draft UI and behavior settings are resolved by `lib/draft-defaults/DraftUISettingsResolver.ts`.
- Scoring config is resolved by `lib/scoring-defaults/LeagueScoringConfigResolver.ts`.
- Waiver config is resolved by `lib/waiver-defaults/WaiverConfigResolver.ts`.
- Playoff config is resolved by `lib/playoff-defaults/PlayoffConfigResolver.ts`.
- Schedule config is resolved by `lib/schedule-defaults/ScheduleConfigResolver.ts`.
- Fan-out events are published through `lib/league-events/publisher.ts` using stable legacy event strings.
- Commissioner settings patching already blocks unpaid premium Commissioner Intelligence and Decision OS settings before persistence.

G33 does not replace these paths. It composes them into one canonical runtime snapshot so engines and intelligence surfaces can read the same resolved rule shape.

## Runtime Contract

New runtime modules:

- `lib/league-runtime/canonicalLeagueRules.ts`
- `lib/league-runtime/leagueRuntimeEvents.ts`
- `lib/league-runtime/index.ts`
- `lib/decision-os/runtime-event-derivation.ts`

`resolveCanonicalLeagueRules(leagueId)` loads:

- Commissioner settings from `League`
- Draft settings from `LeagueSettings`
- Effective draft, scoring, waiver, playoff, and schedule configs from the existing resolvers

It returns one `CanonicalLeagueRules` object with these sections:

- `general`
- `draft`
- `scoring`
- `roster`
- `waivers`
- `trades`
- `playoffs`
- `schedule`
- `permissions`
- `intelligence`

`buildCanonicalRuntimeConsumerContext(rules)` returns only the rule slices engines need. It intentionally excludes intelligence metadata so Decision OS cannot become a control plane for draft, roster, waiver, trade, scoring, or playoff logic.

## Runtime Events

G33 standardizes runtime event names while preserving existing stored events.

Examples:

- `settings_changed` -> `settings.updated`
- `draft_pick` -> `draft.pick`
- `waiver_processed` -> `waiver.processed`
- `trade_accepted` -> `trade.accepted`
- `matchup_live_tick` -> `scoring.updated`

Unknown events normalize to `runtime.unknown` and are ignored by Decision OS derivation.

## Decision OS Boundary

`deriveDecisionOsSignalsFromRuntimeEvents` accepts:

- `CanonicalLeagueRules`
- Normalized runtime events

It returns deterministic evidence-backed signals for:

- League health
- Draft readiness
- Waiver activity
- Trade health
- Roster guidance
- Commissioner action
- Rules changes

If the event stream is empty or unsupported, it returns an insufficient-evidence signal instead of producing unsupported recommendations.

## Entitlements and Gating

G33 records the premium model in canonical runtime metadata without granting access:

- Free commissioners can run a full basic league.
- AF Commissioner or AF Supreme is required for Commissioner Intelligence and premium Decision OS controls.
- Free users get normal league experiences.
- AF Pro unlocks Manager Intelligence and personal Decision OS views.
- AF Supreme unlocks both commissioner and manager intelligence.

Backend enforcement continues to live in existing settings and entitlement paths. Locked premium settings are not persisted for unpaid users by `executeLeagueSettingsPatch`.

Internal legacy identifiers that still contain old wording remain implementation details only. Customer-facing language should continue to use:

- Decision OS
- League Intelligence
- Manager Intelligence
- Commissioner Intelligence
- Smart recommendations
- League health
- Draft readiness
- Trade health
- Manager insights
- Automation
- Guided setup

## Chimmy Boundary

Chimmy is a helper surface, not the league runtime.

Allowed inputs:

- Canonical rules
- Current league state
- Normalized league events
- Decision OS outputs

Not allowed:

- Owning draft, waiver, trade, scoring, roster, or playoff rules
- Mutating league state outside existing audited commissioner/user actions
- Becoming the main customer-facing product language

## Verification Results

Covered by `cmd /c npx vitest run __tests__/g33-canonical-league-runtime.test.ts --reporter=verbose`:

- Canonical rules generation from commissioner settings and effective resolvers
- Runtime consumer slice extraction
- Legacy event normalization
- Decision OS derivation from canonical rules and events
- Insufficient-evidence handling
- Paid intelligence gate metadata
- Resolver composition path

Regression checks passed:

- `cmd /c npx vitest run __tests__/g32-league-home-contract.test.ts --reporter=verbose`
- `cmd /c npx playwright test e2e/g32-nfl-redraft-league-home.spec.ts --project=chromium --reporter=line`
- `cmd /c npx playwright test e2e/create-league-g30-simple-flow.spec.ts --project=chromium --reporter=line`
- `cmd /c npx playwright test e2e/create-league-g31-video-tiles.spec.ts --project=chromium --reporter=line`

Typecheck notes:

- Full `cmd /c npx tsc --noEmit --pretty false --project tsconfig.json` reached the Node heap limit before reporting diagnostics.
- A temporary targeted tsconfig for the new G33 files and test still pulled imported legacy modules and reported existing type errors in unrelated areas such as `lib/prisma.ts`, player-data, survivor, rankings, and waiver-wire files. No diagnostics pointed at the new G33 files.

Browser coverage notes:

- G33 is runtime-only and does not add visible routes, so browser proof was regression-focused on G30, G31, and G32 surfaces.
- Playwright passed, but the local Next webServer emitted repeated `ECONNRESET` aborted-request logs after test completion. G30 also logged existing Meta pixel test-environment warnings. These did not fail the Playwright assertions.

No readiness increase is claimed by G33.
