/**
 * NFL redraft snake draft board — unified state regression lock (Commit E).
 *
 * The audit for this commit confirmed that committed HEAD already implements
 * the unified-state model:
 *   - one <DraftRoomPageClient> mounted by the canonical /drafts/[draftId]
 *     room (legacy /draft/live/[draftId] redirects there; /draft/room/[draftId]
 *     redirects live drafts there and renders only mock inline)
 *   - one <DraftRoomShell> rendered inside the page client
 *   - one <DraftBoard> mounted at a stable site, NOT swapped by
 *     `session.status`
 *   - status-driven blocks are info banners (paused notice, draft-complete
 *     banner, etc.) — not alternate board returns
 *   - start / pause / resume change `session.status` in place via
 *     `/api/leagues/{leagueId}/draft/controls`. No router navigation, no
 *     `window.location` redirects.
 *   - the timer reads from `session.timerSeconds` (commissioner-selected
 *     pick duration)
 *   - `currentPick = useMemo(resolveEffectiveCurrentPick(session))` is the
 *     single shared source of truth for clock / cell highlight / manager strip
 *   - `<DraftTopBar>` start / pause / resume controls are gated on
 *     `isCommissioner`
 *   - the pause and resume API routes enforce commissioner authorization
 *
 * This file locks all of those behaviors so they can't drift when the
 * pre-draft-validation WIP (PreDraftWizard, DraftValidationOrchestrator) and
 * the DRAFT_SESSION_MISMATCH redirect work eventually land.
 *
 * Static-source assertions only — JSDOM-rendering DraftRoomPageClient pulls
 * in 5000+ lines of session/poll/AppShell wiring. The source-level
 * invariants are the contract.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('NFL redraft snake draft — single shell + single board', () => {
  const src = read('components/app/draft-room/DraftRoomPageClient.tsx')

  it('DraftRoomPageClient renders <DraftRoomShell> from exactly one site', () => {
    const matches = src.match(/<DraftRoomShell\b/g) ?? []
    expect(matches.length).toBe(1)
  })

  it('<DraftBoard> is rendered from exactly one site (no parallel boards)', () => {
    const matches = src.match(/<DraftBoard\b/g) ?? []
    expect(matches.length).toBe(1)
  })

  it('the single <DraftBoard> mount is NOT wrapped in a `session.status === ...` ternary', () => {
    // The board lives inside `<DraftRoomShell draftBoard={...}>` and is
    // unconditional with respect to status — only its props (picks,
    // currentOverallPick, etc.) change as state advances. Wrapping the JSX
    // in a status ternary would unmount/remount the board on every pause.
    const boardIdx = src.indexOf('<DraftBoard')
    expect(boardIdx).toBeGreaterThan(0)
    // Look back 200 chars for the closest enclosing JSX expression.
    const window = src.slice(Math.max(0, boardIdx - 200), boardIdx)
    expect(window).not.toMatch(/session\?\.status\s*===\s*'(in_progress|paused|pre_draft|completed)'\s*\?\s*\(/)
    expect(window).not.toMatch(/isDraftCompleted\s*\?\s*null\s*:\s*</)
  })

  it('status-keyed blocks are banner / overlay copy — not alternate shell or board mounts', () => {
    // The status branches at the audit-noted lines are user-facing notices
    // (Paused / Overnight pause / No roster linked / Draft complete /
    // Draft order syncing). They render small <div role="status"> boxes,
    // not a different <DraftRoomShell> or <DraftBoard>.
    const pausedNotice = src.indexOf("session?.status === 'paused'")
    expect(pausedNotice).toBeGreaterThan(0)
    // Within ~600 chars of that branch, the rendered JSX should be a
    // status div, not a shell mount.
    const after = src.slice(pausedNotice, pausedNotice + 600)
    expect(after).not.toMatch(/<DraftRoomShell\b/)
    expect(after).not.toMatch(/<DraftBoard\b/)
    expect(after).toMatch(/role="status"|className=[^>]*amber|className=[^>]*paused/i)
  })
})

describe('NFL redraft snake draft — start / pause / resume stay in place', () => {
  const src = read('components/app/draft-room/DraftRoomPageClient.tsx')
  // The Commit-E commissioner-action logic was extracted into the reusable
  // useCommissionerActions hook — handleCommissionerAction (pause/resume/etc.)
  // now lives there. handleStartDraft still lives in DraftRoomPageClient and
  // delegates to the hook, so it is still sliced from `src` below.
  const hookSrc = read('hooks/useCommissionerActions.ts')

  /**
   * Pull a precise slice of `handleCommissionerAction`'s body so the
   * navigation regex doesn't accidentally hit unrelated `window.location`
   * usage elsewhere in the file.
   */
  const actionStart = hookSrc.indexOf('const handleCommissionerAction = useCallback(')
  const actionEnd = actionStart >= 0 ? hookSrc.indexOf('const handleCommissionerUndoPick =', actionStart) : -1
  const actionBody = actionStart >= 0 && actionEnd > actionStart ? hookSrc.slice(actionStart, actionEnd) : ''

  const startStart = src.indexOf('const handleStartDraft = useCallback(')
  const startEnd = startStart >= 0 ? src.indexOf('const handleSettingsPatch', startStart) : -1
  const startBody = startStart >= 0 && startEnd > startStart ? src.slice(startStart, startEnd) : ''

  it('handleCommissionerAction body is found and bounded', () => {
    expect(actionStart).toBeGreaterThan(0)
    expect(actionEnd).toBeGreaterThan(actionStart)
  })

  it('handleCommissionerAction does NOT call router.push / router.replace', () => {
    expect(actionBody).not.toMatch(/router\.push\(/)
    expect(actionBody).not.toMatch(/router\.replace\(/)
  })

  it('handleCommissionerAction does NOT navigate via window.location', () => {
    // Reads of `window.location` for non-navigation uses (e.g. building a
    // share URL) would also be a smell here, but at minimum any assignment
    // or `.replace()` call is forbidden in this code path.
    expect(actionBody).not.toMatch(/window\.location\.(href|assign|replace)\s*[=(]/)
  })

  it('handleCommissionerAction performs an in-place setSession optimistic patch on pause', () => {
    expect(actionBody).toMatch(/action === 'pause'/)
    expect(actionBody).toMatch(/status: 'paused'/)
  })

  it('handleCommissionerAction handles resume in place and defers in_progress to the server snapshot', () => {
    // Resume intentionally does NOT optimistically set status: 'in_progress'
    // before the server confirms (avoids client/server clock drift and a false
    // "pick available" state during the POST flight). It still patches in place
    // via setSession and POSTs the action — no navigation.
    expect(actionBody).toMatch(/action === 'resume'/)
    expect(actionBody).toMatch(/if \(action === 'resume'\)[\s\S]{0,400}return prev/)
  })

  it("handleCommissionerAction calls /api/leagues/{leagueId}/draft/controls", () => {
    expect(actionBody).toMatch(
      /fetch\(`\/api\/leagues\/\$\{encodeURIComponent\(leagueId\)\}\/draft\/controls`/,
    )
  })

  it('handleStartDraft delegates to handleCommissionerAction and does NOT navigate', () => {
    expect(startBody).toMatch(/handleCommissionerAction\('start'\)/)
    expect(startBody).not.toMatch(/router\.push\(/)
    expect(startBody).not.toMatch(/router\.replace\(/)
    expect(startBody).not.toMatch(/window\.location\.(href|assign|replace)\s*[=(]/)
  })

  it('handleStartDraft documents the no-router-navigation contract', () => {
    // The comment above handleStartDraft explicitly states the design
    // intent. If a future refactor strips this comment, the regression
    // guard should fire so a maintainer revalidates the contract.
    const aboveStart = src.slice(Math.max(0, startStart - 250), startStart)
    expect(aboveStart).toMatch(/no router navigation|same `?DraftBoard`? mount|in place/i)
  })
})

describe('NFL redraft snake draft — DraftTopBar commissioner gating', () => {
  const src = read('components/app/draft-room/DraftTopBar.tsx')

  it('start-draft button only renders for commissioners in pre_draft', () => {
    expect(src).toMatch(/draftStatus === 'pre_draft' && isCommissioner && onStartDraft/)
  })

  it('paused: the clock is never a resume control; the one Resume pill is commissioner-gated (2026-11-19)', () => {
    expect(src).toMatch(/const isPausedCommissioner = false/)
    expect(src).toMatch(/isCommissioner && \(draftStatus === 'in_progress' \|\| draftStatus === 'paused'\)/)
  })

  it('inline pause/resume buttons are gated on isCommissioner', () => {
    // The commissioner-only inline strip renders only for commissioners in an
    // active/paused draft, and (tightened) gates the pause control to
    // in_progress and the resume control to paused.
    expect(src).toMatch(
      /isCommissioner && \(draftStatus === 'in_progress' \|\| draftStatus === 'paused'\) && \(\(draftStatus === 'in_progress' && onPause\) \|\| \(draftStatus === 'paused' && onResume\)\)/,
    )
  })

  it('isCommissioner is a required prop on DraftTopBar', () => {
    // Catches any future refactor that defaults isCommissioner to true and
    // strips the prop check — would silently expose pause/resume to all
    // managers.
    expect(src).toMatch(/isCommissioner: boolean/)
  })
})

describe('NFL redraft snake draft — timer reads commissioner pick duration', () => {
  const src = read('components/app/draft-room/DraftRoomPageClient.tsx')

  it('the rendered timer pulls timerSeconds from session.timerSeconds', () => {
    // The DraftTopBar receives `timerSeconds={session.timerSeconds ?? null}`
    // — this is the commissioner-selected pick duration. If a future change
    // hard-codes a default or pulls from a different field, this guard fires.
    expect(src).toMatch(/timerSeconds=\{session\.timerSeconds \?\? null\}/)
  })

  it('the rendered timer end / status pulls from session.timer (server-authoritative)', () => {
    expect(src).toMatch(/timerStatus=\{[\s\S]*?session\.timer\?\.status \?\? 'none'/)
    expect(src).toMatch(/timerRemainingSeconds=\{[\s\S]*?session\.timer\?\.remainingSeconds \?\? null/)
  })
})

describe('NFL redraft snake draft — single currentPick source of truth', () => {
  const src = read('components/app/draft-room/DraftRoomPageClient.tsx')

  it('currentPick is computed once via resolveEffectiveCurrentPick(session)', () => {
    expect(src).toMatch(
      /const currentPick = useMemo\(\s*\(\) => \(session \? resolveEffectiveCurrentPick\(session\) : null\)/,
    )
  })

  it('the single currentPick value feeds DraftTopBar (clock pill)', () => {
    expect(src).toMatch(/currentManagerOnClock=\{currentPick\?\.displayName \?\? null\}/)
  })

  it('the same currentPick value feeds DraftBoard (active cell highlight)', () => {
    expect(src).toMatch(/currentOverallPick=\{currentPick\?\.overall \?\? null\}/)
  })

  it('the same currentPick value feeds DraftTeamStrip (manager-strip badge)', () => {
    expect(src).toMatch(/onClockRosterId=\{currentPick\?\.rosterId \?\? null\}/)
  })
})

describe('NFL redraft snake draft — legacy /draft/live and /draft/room are redirect-only', () => {
  it('app/draft/live/[draftId]/page.tsx redirects to the canonical /drafts/[draftId] without rendering a board', () => {
    // The canonical full-screen live room moved to /drafts/[draftId]; this
    // legacy route is now redirect-only (resolves session-id or league-id).
    const src = read('app/draft/live/[draftId]/page.tsx')
    expect(src).toMatch(/import \{ redirect \} from 'next\/navigation'/)
    expect(src).toMatch(/redirect\(`\/drafts\/\$\{param\}`\)/)
    expect(src).not.toMatch(/<DraftRoomPageClient\b/)
    expect(src).not.toMatch(/<DraftBoard\b/)
    expect(src).not.toMatch(/<DraftRoomShell\b/)
  })

  it('app/draft/room/[draftId]/page.tsx funnels live drafts to the canonical /drafts mount and renders only mock inline', () => {
    // The room route is the canonical "draft room" deep-link target. LIVE
    // drafts redirect into the single /drafts/[draftId] mount (preserving the
    // unified-state contract — no parallel live shell here); only MOCK drafts
    // render inline via <DraftBoard kind="mock">.
    const src = read('app/draft/room/[draftId]/page.tsx')
    expect(src).toMatch(/import \{ DraftBoard \} from '@\/components\/draft\/DraftBoard'/)
    expect(src).toMatch(/redirect\(`\/drafts\/\$\{encodeURIComponent\(context\.draftId\)\}`\)/)
    expect(src).toMatch(/<DraftBoard\s+kind="mock"/)
    // Must NOT mount a parallel live client/shell directly here.
    expect(src).not.toMatch(/<DraftRoomPageClient\b/)
    expect(src).not.toMatch(/<DraftRoomShell\b/)
  })
})

describe('NFL redraft snake draft — pause/resume API routes enforce commissioner auth', () => {
  it('POST /api/draft/timer/pause requires authenticated commissioner', () => {
    const src = read('app/api/draft/timer/pause/route.ts')
    expect(src).toMatch(/import \{ getServerSession \} from 'next-auth'/)
    expect(src).toMatch(/error:\s*'Unauthorized'/)
    expect(src).toMatch(/error:\s*'Commissioner only'/)
  })

  it('POST /api/draft/timer/resume requires authenticated commissioner', () => {
    const src = read('app/api/draft/timer/resume/route.ts')
    expect(src).toMatch(/import \{ getServerSession \} from 'next-auth'/)
    expect(src).toMatch(/error:\s*'Unauthorized'/)
    expect(src).toMatch(/error:\s*'Commissioner only'/)
  })
})
