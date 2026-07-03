# G44 NFL Redraft Beta Polish And Bug Fixes

## Scope

G44 is scoped only to the AF NFL Redraft League. It does not start College Football work and does not build Decision OS, Commissioner OS, or Manager OS surfaces.

This slice focuses on beta polish that removes real-user confusion without rewriting the G33-G43 runtime architecture.

## Audit Findings

### Blocker

- Fully authenticated public UI proof for create league through champion is still not available in this dirty local worktree. G43 proved the canonical runtime lifecycle and read-only browser proof, but not a complete database-backed commissioner and manager journey.
- Route input validation was inconsistent for beta runtime endpoints. Invalid `week` and `playoffTeams` values could reach canonical runtimes as `NaN`, decimals, or impossible counts, producing confusing errors and risking unsafe no-op or partial action paths.

### High Priority

- Commissioner playoff, waiver, trade, and schedule runtime routes need clear 400 responses before any mutation path when client input is malformed.
- Redraft Season Hub empty-state copy exposed internal implementation language and could still render downstream season panels when no season was available.
- Authenticated seeded browser coverage should move beyond harness proof once the target test database and seed path are stable.

### Polish

- Customer-facing copy should avoid database table names, provider internals, and debug framing.
- Empty states should explain the next real user step, especially before a draft has finalized into a redraft season.
- Mobile commissioner controls still need a full pass in the real league shell.

### Future Enhancement

- A full seeded commissioner/manager Playwright flow should cover league creation, invite/join, draft completion, roster editing, waivers, trades, playoffs, champion, and notifications.
- Production monitoring should add route-level structured error codes for the most common beta failures.
- Real provider outage simulations should verify stale-cache behavior on redraft pages.

## Bugs Fixed

- Added `parseOptionalRedraftPositiveInteger` for beta route boundaries.
- `GET /api/redraft/playoff-runtime` now rejects invalid `week` values with `400`.
- `POST /api/redraft/playoff-runtime` now rejects invalid `playoffTeams` and `week` values before bracket generation or advancement.
- `GET /api/redraft/waiver-runtime` now rejects invalid `week` values before resolving waiver state.
- `GET /api/redraft/trade-runtime` now rejects invalid `week` values before resolving trade state.
- `POST /api/redraft/schedule` now rejects invalid `week` values before standings recalculation or week advancement.
- The real Redraft tab now uses customer-facing Season Hub copy and hides downstream panels when the season is loading, missing, or failed.

## Launch Blockers Removed

- Malformed week/team-count inputs no longer pass through to redraft runtime mutation/resolution calls.
- The Season Hub no longer exposes `PlayerWeeklyScore` or cached-stat implementation copy to beta managers.
- Missing-season state now gives a clear draft-finalization explanation instead of rendering unrelated empty sections below it.

## Authenticated Proof Status

Completed in this slice:

- Focused route contract coverage proves invalid beta inputs return clear `400` errors and do not call canonical runtime actions.
- Existing G43 Playwright proof remains the impacted browser proof for the full canonical season lifecycle.

Not completed:

- A full authenticated DB-backed public UI journey from create league to champion is still not proven locally. The current repo state includes many unrelated dirty files, generated Playwright output, and pre-existing seeded-E2E work outside G44 scope.

## Production Risk Status

Reduced:

- Bad numeric route inputs now fail fast before runtime calls.
- User-facing redraft copy is less confusing for beta managers.
- Missing-season UI avoids stacking unrelated empty panels.

Still open:

- Real production launch should require a clean seeded staging pass with actual auth, membership, commissioner actions, manager actions, and database writes.
- E2E-only mutation routes already present in the worktree should be reviewed separately before production deployment.
- Full repo-wide typecheck/lint remains outside this dirty-worktree G44 slice.

## Recommended Next Step

Run a clean staging-backed authenticated smoke with one commissioner and one manager after the worktree is isolated: create/configure league, finalize draft, edit roster, submit/process waiver, propose/accept trade, generate/advance playoffs, crown champion, and verify notifications/feed.
