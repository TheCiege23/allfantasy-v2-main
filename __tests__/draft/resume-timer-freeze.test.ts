/**
 * P0 — Resume-timer freeze invariants.
 *
 * Root cause: pausedRemainingSeconds is stored as 0 when the pick clock expires before
 * the commissioner pauses the draft. resumeDraftSession used `pausedRemainingSeconds ?? effectiveStored`,
 * which treats 0 as a valid value — so sec = 0, timerEndAt = now + Math.max(1, 0) = now + 1s.
 * The snapshot returned to the client had timer.status = 'expired' / remainingSeconds = 0
 * within the same network round-trip, freezing the clock at 0:00 with no way to resume again.
 *
 * Fixes applied:
 *   1. resumeDraftSession: treat pausedRemainingSeconds = 0 as "no usable remaining"; fall back
 *      to effectiveStored (the full configured pick clock) so the draft resumes with a fresh clock.
 *   2. useCommissionerActions: call fetchSession() after resume success (alongside the existing
 *      mergeDraftSessionSnapshot) so an authoritative server snapshot is always applied.
 *
 * Invariants locked:
 *   1. resumeDraftSession uses hasUsableRemaining guard (> 0 check) before using stored seconds.
 *   2. resumeDraftSession falls back to effectiveStored when pausedRemainingSeconds is 0.
 *   3. resumeDraftSession does NOT use Math.max(1, sec) — sec is always positive when timerEndAt is set.
 *   4. useCommissionerActions calls void fetchSession() after resume success when data.session present.
 *   5. DraftTopBar menu resume and top-bar Resume pill both call onResume — same code path.
 *   6. DraftRoomPageClient wires both onResume callbacks to handleCommissionerAction('resume').
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

const draftSvc = read('lib/live-draft-engine/DraftSessionService.ts')
const commSrc = read('hooks/useCommissionerActions.ts')
const clientSrc = read('components/app/draft-room/DraftRoomPageClient.tsx')
const topBarSrc = read('components/app/draft-room/DraftTopBar.tsx')

// ---------------------------------------------------------------------------
// Invariant 1: hasUsableRemaining guards the stored seconds usage
// ---------------------------------------------------------------------------

describe('Invariant 1: resumeDraftSession hasUsableRemaining guard', () => {
  it('declares hasUsableRemaining variable in resumeDraftSession', () => {
    const resumeStart = draftSvc.indexOf('export async function resumeDraftSession')
    const resumeEnd = draftSvc.indexOf('export async function resetTimer', resumeStart)
    const resumeBlock = draftSvc.slice(resumeStart, resumeEnd)
    expect(resumeBlock).toMatch(/hasUsableRemaining/)
  })

  it('hasUsableRemaining requires pausedRemainingSeconds to be a number > 0', () => {
    const resumeStart = draftSvc.indexOf('export async function resumeDraftSession')
    const resumeEnd = draftSvc.indexOf('export async function resetTimer', resumeStart)
    const resumeBlock = draftSvc.slice(resumeStart, resumeEnd)
    expect(resumeBlock).toMatch(/typeof session\.pausedRemainingSeconds === 'number'/)
    expect(resumeBlock).toMatch(/session\.pausedRemainingSeconds > 0/)
  })
})

// ---------------------------------------------------------------------------
// Invariant 2: effectiveStored used as fallback when pausedRemainingSeconds is 0
// ---------------------------------------------------------------------------

describe('Invariant 2: resumeDraftSession falls back to effectiveStored when seconds = 0', () => {
  it('sec assignment uses hasUsableRemaining ternary — not bare ?? operator', () => {
    const resumeStart = draftSvc.indexOf('export async function resumeDraftSession')
    const resumeEnd = draftSvc.indexOf('export async function resetTimer', resumeStart)
    const resumeBlock = draftSvc.slice(resumeStart, resumeEnd)
    // New guard: ternary on hasUsableRemaining
    expect(resumeBlock).toMatch(/sec = hasUsableRemaining \? session\.pausedRemainingSeconds/)
    // Fallback: effectiveStored used when not usable
    expect(resumeBlock).toMatch(/effectiveStored \?\? 0\)/)
  })

  it('resumeDraftSession does NOT use bare pausedRemainingSeconds ?? effectiveStored as sec', () => {
    const resumeStart = draftSvc.indexOf('export async function resumeDraftSession')
    const resumeEnd = draftSvc.indexOf('export async function resetTimer', resumeStart)
    const resumeBlock = draftSvc.slice(resumeStart, resumeEnd)
    // The bug: `??` treats 0 as valid, skipping the effectiveStored fallback
    expect(resumeBlock).not.toMatch(/sec = session\.pausedRemainingSeconds \?\? effectiveStored/)
  })
})

// ---------------------------------------------------------------------------
// Invariant 3: Math.max(1, sec) removed — sec is always positive now
// ---------------------------------------------------------------------------

describe('Invariant 3: resumeDraftSession timerEndAt uses sec directly', () => {
  it('timerEndAt computation does not apply Math.max(1, sec)', () => {
    const resumeStart = draftSvc.indexOf('export async function resumeDraftSession')
    const resumeEnd = draftSvc.indexOf('export async function resetTimer', resumeStart)
    const resumeBlock = draftSvc.slice(resumeStart, resumeEnd)
    expect(resumeBlock).not.toMatch(/Math\.max\(1, sec\)/)
  })

  it('timerEndAt uses sec * 1000 directly', () => {
    const resumeStart = draftSvc.indexOf('export async function resumeDraftSession')
    const resumeEnd = draftSvc.indexOf('export async function resetTimer', resumeStart)
    const resumeBlock = draftSvc.slice(resumeStart, resumeEnd)
    expect(resumeBlock).toMatch(/Date\.now\(\) \+ sec \* 1000/)
  })
})

// ---------------------------------------------------------------------------
// Invariant 4: useCommissionerActions calls fetchSession after resume success
// ---------------------------------------------------------------------------

describe('Invariant 4: useCommissionerActions fetches authoritative session after resume', () => {
  it('calls void fetchSession() after resume success when data.session is present', () => {
    // The fetchSession call must be in the success path (after the data.session merge),
    // not only in the usedSessionFallback branch.
    const mergeIdx = commSrc.indexOf('mergeDraftSessionSnapshot(prev, data.session')
    expect(mergeIdx).toBeGreaterThan(-1)
    // fetchSession must appear after the merge block
    const afterMerge = commSrc.slice(mergeIdx)
    expect(afterMerge).toMatch(/action === 'resume'[\s\S]*?fetchSession\(\)/)
  })

  it('resume fetchSession call is guarded by !usedSessionFallback', () => {
    const mergeIdx = commSrc.indexOf('mergeDraftSessionSnapshot(prev, data.session')
    const afterMerge = commSrc.slice(mergeIdx)
    // Only fires when data.session was present (usedSessionFallback is false)
    expect(afterMerge).toMatch(/action === 'resume' && !usedSessionFallback[\s\S]*?fetchSession\(\)/)
  })
})

// ---------------------------------------------------------------------------
// Invariant 5: DraftTopBar menu and pill both call onResume
// ---------------------------------------------------------------------------

describe('Invariant 5: DraftTopBar — menu resume and pill both call onResume', () => {
  it('resume pill onClick calls onResume', () => {
    // The top-bar pill button calls onResume directly
    expect(topBarSrc).toMatch(/onClick=\{draftStatus === 'paused' \? onResume : onPause\}/)
  })

  it('menu resume button onClick calls onResume', () => {
    // The hamburger menu button also calls onResume (same handler, same code path)
    const menuResumeIdx = topBarSrc.indexOf("'draft-topbar-menu-resume'")
    expect(menuResumeIdx).toBeGreaterThan(-1)
    // onResume?.() must appear near the menu resume button's onClick
    const window = topBarSrc.slice(menuResumeIdx - 200, menuResumeIdx + 600)
    expect(window).toMatch(/onResume\?\.\(\)/)
  })
})

// ---------------------------------------------------------------------------
// Invariant 6: DraftRoomPageClient wires onResume to handleCommissionerAction('resume')
// ---------------------------------------------------------------------------

describe('Invariant 6: DraftRoomPageClient wires onResume to handleCommissionerAction', () => {
  it("onResume prop calls handleCommissionerAction('resume')", () => {
    expect(clientSrc).toMatch(/onResume=\{[^}]*handleCommissionerAction\('resume'\)/)
  })

  it("onPause prop calls handleCommissionerAction('pause')", () => {
    expect(clientSrc).toMatch(/onPause=\{[^}]*handleCommissionerAction\('pause'\)/)
  })
})
