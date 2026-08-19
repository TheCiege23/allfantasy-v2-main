# G46 Canonical Schedule Navigation

Date: 2026-07-11

## What Changed

- Added `schedule` to the canonical NFL/NCAAF redraft tab registry immediately after `matchups`.
- Added the same Schedule entry to the canonical shell's runtime tab definitions.
- Added `CanonicalRedraftScheduleTab`, a league-scoped loader that reuses the existing `ScheduleView` instead of introducing another schedule renderer.
- Routed `?view=schedule` through the canonical URL-to-tab model and existing active-tab synchronization.
- Preserved the generic non-redraft `ScheduleTab` behavior outside the NFL/NCAAF redraft shell.
- Added regression coverage for ordering, uniqueness, shared desktop/mobile navigation, URL semantics, league context, and truthful loading/error/pre-draft states.

Files changed:

- `app/league/[leagueId]/LeagueTabs.tsx`
- `app/league/[leagueId]/LeagueShell.tsx`
- `app/league/[leagueId]/tabs/redraft/CanonicalRedraftScheduleTab.tsx`
- `__tests__/nfl-redraft-core-tab-bar.test.ts`
- `__tests__/redraft/canonical-schedule-navigation.test.ts`
- `docs/redraft/G46_CANONICAL_SCHEDULE_NAVIGATION.md`

## Navigation Decision

Schedule is a primary canonical tab after Matchups.

This follows the existing product architecture because desktop and mobile use the same `LeagueHeader` tablist. The tablist already provides accessible tab roles, selected state, 44px mobile touch targets, horizontal touch scrolling, and the canonical `?view=` deep-link model. One registry entry therefore serves both layouts without duplicating navigation or schedule logic.

The customer semantics are:

- **Draft**: setup, live drafting and recap.
- **Matchups**: one selected week's matchup detail and live scoring.
- **Schedule**: the league's full-season week-by-week slate, byes, completed/future scores and playoff-transition context.
- **Standings**: records plus the playoff bracket and commissioner playoff lifecycle controls.

Schedule does not replace Draft, Matchups, Standings or the playoff bracket. Refreshing or copying `/league/{leagueId}?view=schedule` resolves through the existing league-scoped tab normalizer. The redraft season and schedule APIs retain authorization and league-scope enforcement.

## State Coverage

Source and component coverage confirms:

- Loading: explicit `role=status` state.
- Pre-draft/no season: directs users back to Draft and does not fabricate a schedule.
- No generated schedule: existing honest `ScheduleView` empty state.
- API failure: explicit `role=alert` retry message.
- Regular season: week picker and matchup list.
- Completed games: final scores rendered by the existing view.
- Future games: scheduled state with no invented scores.
- Bye weeks: dedicated bye cards.
- Playoff transition: playoff-start context from the canonical schedule payload.
- Odd team count: deterministic bye coverage in schedule-engine tests and browser fixture.
- Unavailable data: empty/error boundary instead of preview data.

Consolation and unusual playoff sizes remain represented only when returned by the existing canonical schedule runtime; this phase did not change schedule rules.

## Test Evidence

Initial combined command:

```text
npx vitest run __tests__/nfl-redraft-core-tab-bar.test.ts __tests__/redraft/canonical-schedule-navigation.test.ts __tests__/redraft/draft-finalize-schedule.test.ts __tests__/redraft/schedule-generator-ordering.test.ts __tests__/schedule-defaults-by-sport.test.ts --pool=threads --maxWorkers=1 --reporter=verbose
```

Result: timed out after 64.1 seconds with no usable result. It was not counted as passing.

Bounded navigation run:

```text
npx vitest run __tests__/nfl-redraft-core-tab-bar.test.ts __tests__/redraft/canonical-schedule-navigation.test.ts --pool=threads --maxWorkers=1 --reporter=verbose
```

Result: 2 files passed, 16 tests passed, 0 failed; 28.24 seconds reported by Vitest.

Bounded schedule-engine run:

```text
npx vitest run __tests__/redraft/draft-finalize-schedule.test.ts __tests__/redraft/schedule-generator-ordering.test.ts __tests__/schedule-defaults-by-sport.test.ts --pool=threads --maxWorkers=1 --reporter=verbose
```

Result: 3 files passed, 20 tests passed, 0 failed; 34.93 seconds. Mocked event persistence emitted known best-effort warnings and did not fail assertions.

Additional validation:

- Targeted ESLint: 0 errors, 4 pre-existing warnings in `LeagueShell.tsx`.
- Direct esbuild/TypeScript compilation of the new adapter: passed.
- `git diff --check`: passed.
- No retry beyond splitting the timed-out combined test command.
- No repository-wide typecheck or lint was run.

## Visual QA

Chromium command:

```text
npx playwright test e2e/g36-nfl-redraft-schedule.spec.ts --project=chromium --reporter=line
```

Result: 4 tests passed in 2.5 minutes.

Physically exercised fixture states:

- Desktop dark mode at the configured Playwright laptop viewport.
- Desktop light mode.
- Mobile at 390×844.
- Week 1, 2 and 3 selection and selected-state clarity.
- Completed scores, future matchups, division matchup labeling and odd-team byes.
- Playoff-preparation copy and schedule-health presentation.
- Mobile week controls and schedule readability.

The browser evidence is deterministic fixture/preview validation of the real shared `ScheduleView`, not authenticated DB-backed validation. Canonical tab visibility, active state, direct URL mapping and shared desktop/mobile navigation are source/test verified; an authenticated league-shell browser session was unavailable. No production, staging, provider-backed or DB-backed claim is made.

## Remaining Unverified Cases

- Authenticated direct-link refresh against a real league.
- Provider-backed date/status changes and unavailable-provider behavior.
- Real playoff and consolation schedule payloads.
- Wide-desktop screenshots beyond the Playwright default desktop viewport.
- Screen-reader testing with assistive technology.

These are release-validation items, not evidence of a source navigation defect.

## Final Decision

```text
G46 CANONICAL SCHEDULE NAVIGATION: PASS
NFL SCHEDULE REACHABLE ON DESKTOP: YES
NFL SCHEDULE REACHABLE ON MOBILE: YES
READY FOR NEXT NFL LAUNCH BLOCKER: YES
```

NFL Redraft remains published at 93%. G46 closes one verified source-level launch blocker, but the percentage is held until authenticated canonical-shell and DB-backed season validation converts the remaining release-confidence gaps into physical evidence.
