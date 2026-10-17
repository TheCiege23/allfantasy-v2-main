/**
 * NFL redraft commissioner controls — source-level contract lock
 * (Commit R).
 *
 * Pins the commissioner-control invariants so a future refactor can't
 * silently regress:
 *
 *   1. Every commissioner-control action is gated through
 *      `assertLeagueActionGate(leagueId, userId, 'draft_commissioner_control')`
 *      at the top of POST. Non-commissioners are refused with the gate's
 *      structured `code` + status.
 *   2. The action allow-list is closed (`ALLOWED_ACTIONS`); unknown
 *      actions return 400 with the canonical "Invalid action" message.
 *   3. `start` honors the `ROSTER_CONFIGURATION_INCOMPLETE` 409 contract.
 *   4. `pause` / `resume` / `reset_timer` are gated by
 *      `commissionerPauseControlsEnabled` with structured
 *      `COMMISSIONER_PAUSE_DISABLED` code.
 *   5. `set_timer_seconds` enforces explicit bounds at the route layer:
 *      finite check → `[10, 259200]` range (10s..72h, shared with the settings
 *      Draft tab via lib/draft/draftSettingsPolicy.ts). Out-of-range returns 400
 *      with `COMMISSIONER_TIMER_OUT_OF_RANGE`; non-finite returns 400 with
 *      `COMMISSIONER_TIMER_INVALID`; a custom (off-list) value without the AF
 *      Commissioner entitlement returns 403
 *      `COMMISSIONER_TIMER_CUSTOM_REQUIRES_SUBSCRIPTION`.
 *   6. `force_autopick` is gated by
 *      `commissionerForceAutoPickEnabled` with structured
 *      `COMMISSIONER_FORCE_AUTOPICK_DISABLED` code.
 *   7. `force_autopick` candidate loop:
 *        - filters drafted-name + roster-eligible positions
 *        - dedupes via `uniqueKey`
 *        - calls canonical `submitPick({ source: 'commissioner', ... })`
 *        - **passes expectedOverall (Commit R)** so Commit-M stale guard
 *          fires deterministically
 *        - bails the loop on STALE_OVERALL / RACE_RETRY
 *   8. `skip_pick` is gated by `autopick_behavior === 'skip'` with
 *      structured `COMMISSIONER_SKIP_DISABLED` code; calls canonical
 *      submitPick with source='commissioner' AND
 *      **expectedOverall (Commit R)**.
 *   9. `undo_pick` calls `undoLastPick(leagueId)`; the helper deletes
 *      the most-recent DraftPick row inside a transaction and bumps
 *      DraftSession.version (so concurrent readers see fresh state).
 *  10. `complete` calls `completeDraftSession` which itself enforces
 *      board-full check before transitioning status to 'completed'.
 *  11. All authority writes route through canonical
 *      `lib/live-draft-engine/PickSubmissionService.submitPick`. None
 *      import the legacy `lib/draft/execute-pick.ts`.
 *  12. The route does NOT introduce navigation primitives
 *      (`router.push`, `router.replace`, `window.location`) — Commit J's
 *      no-redirect contract.
 *  13. Commits J / L / M / N / O / P / Q locks still wired.
 *
 * Static-source assertions only — keeps the lock cheap and avoids the
 * full live-draft-engine harness for what is fundamentally a code-shape
 * contract.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('Commissioner controls route — gating', () => {
  const src = read('app/api/leagues/[leagueId]/draft/controls/route.ts')

  it('imports the canonical league action gate', () => {
    expect(src).toMatch(/import \{ assertLeagueActionGate \} from '@\/server\/services\/leagueActionGate'/)
  })

  it('runs assertLeagueActionGate at the top of POST with `draft_commissioner_control`', () => {
    expect(src).toMatch(
      /assertLeagueActionGate\(leagueId, userId, 'draft_commissioner_control'\)/,
    )
  })

  it('declares a closed allow-list of actions', () => {
    expect(src).toMatch(/ALLOWED_ACTIONS[\s\S]+?'start'[\s\S]+?'pause'[\s\S]+?'resume'/)
    expect(src).toMatch(/'reset_timer'[\s\S]+?'undo_pick'[\s\S]+?'force_autopick'/)
    expect(src).toMatch(/'set_timer_seconds'[\s\S]+?'skip_pick'[\s\S]+?'complete'/)
    expect(src).toMatch(/'reset_draft'/)
  })

  it('rejects unknown actions with 400 + canonical message', () => {
    expect(src).toMatch(/!ALLOWED_ACTIONS\.includes\(action\)[\s\S]+?Invalid action/)
  })
})

describe('start / complete / undo_pick — state-transition contract', () => {
  const src = read('app/api/leagues/[leagueId]/draft/controls/route.ts')

  it('start surfaces ROSTER_CONFIGURATION_INCOMPLETE as 409', () => {
    expect(src).toMatch(
      /started\.reason === 'ROSTER_CONFIGURATION_INCOMPLETE'[\s\S]+?status: 409/,
    )
  })

  it('undo_pick delegates to undoLastPick (with audit reason + actor) and refuses with 400 when nothing to undo', () => {
    // Slice 4 added a required commissioner reason + actor to the undo call,
    // persisted to DraftPickAuditLog. Lock that the leagueId + audit options
    // are forwarded, not just leagueId.
    expect(src).toMatch(/await undoLastPick\(leagueId,\s*\{[\s\S]*?actorUserId: userId/)
    expect(src).toMatch(/'No pick to undo'[\s\S]+?status: 400/)
  })

  it('complete delegates to completeDraftSession (board-full check inside helper)', () => {
    expect(src).toMatch(/await completeDraftSession\(leagueId\)/)
  })

  it('undoLastPick bumps DraftSession.version inside the transaction', () => {
    const ds = read('lib/live-draft-engine/DraftSessionService.ts')
    expect(ds).toMatch(
      /export async function undoLastPick[\s\S]+?\$transaction[\s\S]+?draftPick\.delete[\s\S]+?version: \{ increment: 1 \}/,
    )
  })

  it('completeDraftSession refuses to flip status when the board is not full', () => {
    const ds = read('lib/live-draft-engine/DraftSessionService.ts')
    expect(ds).toMatch(/isDraftBoardFull\(/)
  })
})

describe('Pause / resume / reset_timer — gated by commissionerPauseControlsEnabled', () => {
  const src = read('app/api/leagues/[leagueId]/draft/controls/route.ts')

  it('returns COMMISSIONER_PAUSE_DISABLED when the toggle is off', () => {
    expect(src).toMatch(
      /commissionerPauseControlsEnabled === false[\s\S]+?code: 'COMMISSIONER_PAUSE_DISABLED'/,
    )
  })

  it('pause / resume / reset_timer all flow through the same gate', () => {
    expect(src).toMatch(
      /const pauseControlAction = action === 'pause' \|\| action === 'resume' \|\| action === 'reset_timer'/,
    )
  })
})

describe('set_timer_seconds — bounds enforcement at the route layer', () => {
  const src = read('app/api/leagues/[leagueId]/draft/controls/route.ts')

  it('rejects non-finite seconds with COMMISSIONER_TIMER_INVALID', () => {
    expect(src).toMatch(
      /!Number\.isFinite\(rawSeconds\)[\s\S]+?code: 'COMMISSIONER_TIMER_INVALID'/,
    )
  })

  it('rejects out-of-range seconds with COMMISSIONER_TIMER_OUT_OF_RANGE', () => {
    expect(src).toMatch(
      /seconds < TIMER_MIN_SECONDS \|\| seconds > TIMER_MAX_SECONDS[\s\S]+?code: 'COMMISSIONER_TIMER_OUT_OF_RANGE'/,
    )
  })

  it('declares the explicit bounds from the shared policy (10s minimum, 72h maximum)', () => {
    expect(src).toMatch(/const TIMER_MIN_SECONDS = CUSTOM_TIMER_MIN_SECONDS/)
    expect(src).toMatch(/const TIMER_MAX_SECONDS = CUSTOM_TIMER_MAX_SECONDS/)
  })

  it('applies the settings-tab subscriber rule through decideCommissionerTimerSeconds', () => {
    expect(src).toMatch(/decideCommissionerTimerSeconds\(\{[\s\S]+?hasCustomEntitlement[\s\S]+?'commissioner_ai_tools'/)
    expect(src).toMatch(/const allowedSeconds = timerDecision\.seconds[\s\S]+?setTimerSeconds\(leagueId, allowedSeconds/)
  })
})

describe('force_autopick — gated, race-aware, canonical submitPick', () => {
  const src = read('app/api/leagues/[leagueId]/draft/controls/route.ts')

  it('returns COMMISSIONER_FORCE_AUTOPICK_DISABLED when the toggle is off', () => {
    expect(src).toMatch(
      /!uiSettings\.commissionerForceAutoPickEnabled[\s\S]+?code: 'COMMISSIONER_FORCE_AUTOPICK_DISABLED'/,
    )
  })

  it('filters candidates by drafted-name + roster-eligible position + dedupe', () => {
    expect(src).toMatch(/draftedNames\.has\(normalizeName\(candidate\.playerName\)\)/)
    expect(src).toMatch(
      /draftPoolRowMatchesEligiblePositions\(candidate\.position, draftEligiblePositions\)/,
    )
    expect(src).toMatch(/seenKeys\.has\(key\)/)
  })

  it('computes expectedOverall once before the candidate loop', () => {
    expect(src).toMatch(/const expectedOverall = draftSession\.picks\.length \+ 1/)
  })

  it('passes expectedOverall to every candidate submitPick attempt', () => {
    expect(src).toMatch(
      /for \(const candidate of attempts\)[\s\S]+?submitPick\(\{[\s\S]+?source: 'commissioner',[\s\S]+?expectedOverall,/,
    )
  })

  it('bails the candidate loop on STALE_OVERALL / RACE_RETRY codes', () => {
    expect(src).toMatch(
      /attempt\.code === 'DRAFT_PICK_STALE_OVERALL' \|\|\s+attempt\.code === 'DRAFT_PICK_RACE_RETRY'/,
    )
  })

  it('uses the canonical submitPick (no legacy executeDraftPick)', () => {
    expect(src).toMatch(
      /import \{ submitPick \} from '@\/lib\/live-draft-engine\/PickSubmissionService'/,
    )
    expect(src).not.toMatch(/from '@\/lib\/draft\/execute-pick'/)
  })
})

describe('skip_pick — gated, race-aware, canonical submitPick', () => {
  const src = read('app/api/leagues/[leagueId]/draft/controls/route.ts')

  it('returns COMMISSIONER_SKIP_DISABLED when autopick_behavior !== skip', () => {
    expect(src).toMatch(
      /!skipAllowed[\s\S]+?code: 'COMMISSIONER_SKIP_DISABLED'/,
    )
  })

  it('passes expectedOverall to the SKIP submitPick call', () => {
    expect(src).toMatch(
      /submitPick\(\{[\s\S]+?position: 'SKIP'[\s\S]+?source: 'commissioner',[\s\S]+?expectedOverall,/,
    )
  })

  it('routes the result code through the rosterConfigurationIncompleteBody helper for 409s', () => {
    expect(src).toMatch(
      /result\.code === 'ROSTER_CONFIGURATION_INCOMPLETE'[\s\S]+?rosterConfigurationIncompleteBody/,
    )
  })
})

describe('Commissioner override preserves Commit-M protections', () => {
  const sps = read('lib/live-draft-engine/PickSubmissionService.ts')

  it('submitPick still propagates commissionerOverride into validatePickSubmission', () => {
    expect(sps).toMatch(
      /commissionerOverride: input\.commissionerOverride === true \|\| input\.source === 'commissioner'/,
    )
  })

  const pv = read('lib/live-draft-engine/PickValidation.ts')

  it('validatePickSubmission still refuses NOT_LIVE / DUPLICATE even when commissionerOverride is true', () => {
    // NOT_LIVE check happens before the on-clock guard (so commissioner can't write to a complete draft)
    expect(pv).toMatch(/code: DRAFT_PICK_NOT_LIVE/)
    // Duplicate check runs regardless of commissionerOverride
    expect(pv).toMatch(/code: DRAFT_PICK_DUPLICATE_PLAYER/)
    // The commissionerOverride flag ONLY skips the on-clock check
    expect(pv).toMatch(
      /!input\.commissionerOverride && input\.rosterId !== input\.currentOnClockRosterId/,
    )
  })
})

describe('No-redirect contract preserved (Commit J)', () => {
  const src = read('app/api/leagues/[leagueId]/draft/controls/route.ts')

  it('controls route does not introduce client navigation primitives', () => {
    expect(src).not.toMatch(/router\.push/)
    expect(src).not.toMatch(/router\.replace/)
    expect(src).not.toMatch(/window\.location\.(href|assign|replace)/)
  })
})

describe('Commit J / L / M / N / O / P / Q locks still hold after Commit R', () => {
  it('Commit J — DraftRoomPageClient still has the 409 / DRAFT_SESSION_MISMATCH in-place handler', () => {
    const drpc = read('components/app/draft-room/DraftRoomPageClient.tsx')
    expect(drpc).toMatch(
      /res\.status === 409 && \(data as \{ code\?: unknown \}\)\?\.code === 'DRAFT_SESSION_MISMATCH'/,
    )
    expect(drpc).toMatch(/setSessionMismatchRecovering\(true\)/)
  })

  it('Commit L — executeDraftPick still calls assertLegacyDraftRuntimeWriteAllowed before any prisma write', () => {
    const exec = read('lib/draft/execute-pick.ts')
    const guardIdx = exec.indexOf('assertLegacyDraftRuntimeWriteAllowed({')
    expect(guardIdx).toBeGreaterThan(0)
    const writeIdx = exec.indexOf('prisma.draftRoomPickRecord')
    expect(writeIdx).toBeGreaterThan(guardIdx)
  })

  it('Commit M — submitPick still has the expectedOverall stale guard and race-retry tagging', () => {
    const sps = read('lib/live-draft-engine/PickSubmissionService.ts')
    expect(sps).toMatch(
      /input\.expectedOverall !== overall[\s\S]+?code: DRAFT_PICK_STALE_OVERALL/,
    )
    expect(sps).toMatch(/code: DRAFT_PICK_RACE_RETRY/)
  })

  it('Commit N — PlayerPanel still imports both rookies/vets predicates', () => {
    const pp = read('components/app/draft-room/PlayerPanel.tsx')
    expect(pp).toMatch(
      /import \{[^}]*isRookieEligibleForFilter[^}]*isVetEligibleForFilter[^}]*\} from '@\/lib\/draft-room\/rookieFilterPredicate'/,
    )
  })

  it('Commit O — pool resolver test still mocks loadPlayerSeasonStatsFallback', () => {
    const t = read('__tests__/getResolvedDraftPoolForLeague.unit.test.ts')
    expect(t).toMatch(/loadPlayerSeasonStatsFallback/)
  })

  it('Commit P — DraftPlayerCard still exposes the stable data testids', () => {
    const card = read('components/app/draft-room/DraftPlayerCard.tsx')
    expect(card).toMatch(/'draft-player-name'/)
    expect(card).toMatch(/'draft-player-injury-status'/)
    expect(card).toMatch(/'draft-player-stats-summary'/)
  })

  it('Commit Q — autopick paths still pass expectedOverall to submitPick', () => {
    const sd = read('lib/live-draft-engine/slow-draft/SlowDraftRuntimeService.ts')
    expect(sd).toMatch(/const expectedOverall = draftSession\.picks\.length \+ 1/)
    const ape = read('app/api/leagues/[leagueId]/draft/autopick-expired/route.ts')
    expect(ape).toMatch(/expectedOverall,/)
  })
})
