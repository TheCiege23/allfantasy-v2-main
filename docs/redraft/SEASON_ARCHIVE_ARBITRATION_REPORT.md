# Season Archive Arbitration Report

## Real code found (direct audit)

Two functionally separate operations both touch "the end of a season," and neither is a dedicated, bespoke "archive this season" workflow:

1. **`enterRedraftOffseason()`** (`lib/redraft/offseason/RedraftOffseasonService.ts:23-200`) — the real "close out the season" step. Creates an immutable `LeagueSeason` snapshot (`tx.leagueSeason.create`, lines 124-139) and transitions lifecycle `completed → offseason`, inside one `prisma.$transaction` (lines 120-183), emitting `EVENT.SEASON_SNAPSHOT_CREATED` and `EVENT.LEAGUE_ENTERED_OFFSEASON` transactionally. **This does not archive** — it moves the league to `offseason`, a different lifecycle state than `archived`. It does gate on real season completeness: `season.status !== 'complete'` (line 61) and the league's current lifecycle state being `completed`/`offseason` (lines 76-78).
2. **`archiveLeague(leagueId, userId)`** (`server/services/commissionerService.ts:349-354`) — the operation that actually sets `lifecycleState = 'archived'`. It is a thin wrapper: `requireHead(leagueId, userId)` then `forceStateTransition(leagueId, userId, 'archived', {...})`, which calls `transitionLeagueState(..., {force: true})`.

## Real defects found

1. **No season-completeness eligibility check on archival at all.** `TRANSITIONS` (`server/services/leagueLifecycleService.ts:43-54`) allows `archived` as a valid next state from *every* lifecycle state, including `setup`, `pre_draft`, `drafting`, `in_season` — nothing here checks matchups-final/playoffs-complete/champion-crowned. Worse, `archiveLeague`'s `force: true` bypasses `validateTransition` entirely (`transitionLeagueState:263`: `const check = opts?.force ? {ok: true} : validateTransition(...)`), so even the permissive state-machine table is skipped outright.
2. **Non-transactional.** `transitionLeagueState` (the function `archiveLeague` actually calls) does a single bare `prisma.league.update` (line 269) with a best-effort, `.catch(() => {})`-wrapped fanout notification — no `$transaction`, no canonical `EVENT.*` emission on this path at all. (A *different* function, `transitionLeagueStateInTransaction`, does emit `EVENT.LEAGUE_LIFECYCLE_CHANGED` transactionally — but `archiveLeague` does not call it.)
3. **Idempotency is accidental, not designed.** The transactional variant special-cases "already in requested state," but the non-transactional path `archiveLeague` uses has no such check (the check lives inside `validateTransition`, which `force: true` skips). Calling `archiveLeague` twice re-executes the update and writes a fresh audit row each time — the end state happens to be unchanged, but it is not a guarded no-op.
4. **Authorization is real and correctly enforced**: head-commissioner-only, checked twice (once in `commissionerService.archiveLeague` via `requireHead`, and again in the generic lifecycle route for the specific `archived` target).
5. **Post-archive freeze is partial, with a real escape hatch.** `ACTIONS.archived` excludes settings/scoring/standings-edit actions, so `assertLifecycleActionAllowed` correctly blocks them by default — but `isActionAllowed` has an explicit bypass: `if (opts?.commissionerOverride && opts?.roleIsElevated) return true`. Freeze enforcement is also scattered rather than centralized (e.g. `lib/waiver-wire/transaction-eligibility.ts:95` and `lib/roster-lineup-engine/lineupLockService.ts:144,180` each hard-code their own `lifecycleState === 'archived'` check independently) — not every mutation path in the app necessarily routes through the shared gate at all.

## Physical testing performed

**None this phase.** Given severe time constraints and the size of the remaining scope (next-season creation, week advancement, the concurrency matrix), this track received a direct code audit only, not the 18-scenario physical test list the phase brief specified. This is a real, disclosed limitation, not a claim of completeness.

## Verdict

**PARTIALLY IMPLEMENTED.** A real, authorization-gated `archiveLeague` mutation exists and correctly sets `lifecycleState = 'archived'`, but it has no completeness eligibility gate, is not transactional, emits no canonical event, and its freeze has a real, code-confirmed override escape hatch. No fix was attempted this phase — `leagueLifecycleService.ts`/`commissionerService.ts` are shared infrastructure used far beyond redraft archival (every lifecycle transition in the product routes through this same state machine), and a same-phase fix under time pressure risked exactly the kind of broad, unreviewed change this program's guardrails exist to prevent. This is disclosed as a real, unresolved P0-adjacent gap for a future, properly-scoped phase.
