/**
 * P0 — Pause/resume status divergence invariants.
 *
 * Root causes fixed:
 *   A. controls/route pause+resume called buildSessionSnapshot (repair + reconcile +
 *      full picks read + withViewerSession = 8-12 DB ops) → 3-10s delay keeping
 *      commissionerLoading=true and the button locked.
 *   B. useCommissionerActions resume handler applied optimistic status:'in_progress'
 *      before server confirmed → client clock ran while DB still showed 'paused',
 *      and canDraft flipped true before the resume POST returned.
 *   C. snakeCanDraftRaw had no gate on commissionerLoading → picks enabled during
 *      any in-flight commissioner action.
 *
 * Invariants locked:
 *   1. controls/route pause path passes skipRepair:true to buildSessionSnapshot.
 *   2. controls/route resume path passes skipRepair:true to buildSessionSnapshot.
 *   3. controls/route pause does NOT call withViewerSession (viewer fields preserved
 *      by client mergeDraftSessionSnapshot from prior state).
 *   4. controls/route resume does NOT call withViewerSession.
 *   5. useCommissionerActions resume handler returns prev unchanged — no optimistic
 *      status:'in_progress' before server confirms.
 *   6. DraftRoomPageClient snakeCanDraftRaw includes commissionerLoading in its
 *      dependency array so picks are disabled while any commissioner POST is inflight.
 *   7. DraftRoomPageClient snakeCanDraftRaw expression checks !commissionerLoading.
 *   8. [draft-perf] pause timing log emitted in controls pause path.
 *   9. [draft-perf] resume timing log emitted in controls resume path.
 *  10. PickValidation allows picks in 'paused' session status (soft paused draft).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validatePickSubmission } from '@/lib/live-draft-engine/PickValidation'
import { DRAFT_PICK_NOT_LIVE } from '@/lib/live-draft-engine/pickAuthorityCodes'

const root = process.cwd()
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

const controlsSrc = read('app/api/leagues/[leagueId]/draft/controls/route.ts')
const commSrc = read('hooks/useCommissionerActions.ts')
const clientSrc = read('components/app/draft-room/DraftRoomPageClient.tsx')

// ---------------------------------------------------------------------------
// Invariant 1 & 2: skipRepair passed for pause and resume
// ---------------------------------------------------------------------------

describe('Invariant 1: pause path passes skipRepair:true', () => {
  it('pause block contains buildSessionSnapshot call with skipRepair:true', () => {
    // Use "if (action === 'pause')" to skip the combined pauseControlAction check line
    const pauseStart = controlsSrc.indexOf("if (action === 'pause')")
    const resumeStart = controlsSrc.indexOf("if (action === 'resume')", pauseStart + 1)
    expect(pauseStart).toBeGreaterThan(-1)
    expect(resumeStart).toBeGreaterThan(pauseStart)
    const pauseBlock = controlsSrc.slice(pauseStart, resumeStart)
    expect(pauseBlock).toMatch(/buildSessionSnapshot\(.*skipRepair.*true/)
  })
})

describe('Invariant 2: resume path passes skipRepair:true', () => {
  it('resume block contains buildSessionSnapshot call with skipRepair:true', () => {
    const resumeStart = controlsSrc.indexOf("if (action === 'resume')")
    const resetTimerStart = controlsSrc.indexOf("if (action === 'reset_timer')", resumeStart + 1)
    expect(resumeStart).toBeGreaterThan(-1)
    expect(resetTimerStart).toBeGreaterThan(resumeStart)
    const resumeBlock = controlsSrc.slice(resumeStart, resetTimerStart)
    expect(resumeBlock).toMatch(/buildSessionSnapshot\(.*skipRepair.*true/)
  })
})

// ---------------------------------------------------------------------------
// Invariant 3 & 4: withViewerSession NOT in pause/resume blocks
// ---------------------------------------------------------------------------

describe('Invariant 3: pause block does NOT call withViewerSession', () => {
  it('pause block returns snapshot directly without withViewerSession', () => {
    const pauseStart = controlsSrc.indexOf("if (action === 'pause')")
    const resumeStart = controlsSrc.indexOf("if (action === 'resume')", pauseStart + 1)
    const pauseBlock = controlsSrc.slice(pauseStart, resumeStart)
    // Match the function call specifically, not comment text mentioning it
    expect(pauseBlock).not.toMatch(/withViewerSession\(/)
  })
})

describe('Invariant 4: resume block does NOT call withViewerSession', () => {
  it('resume block returns snapshot directly without withViewerSession', () => {
    const resumeStart = controlsSrc.indexOf("if (action === 'resume')")
    const resetTimerStart = controlsSrc.indexOf("if (action === 'reset_timer')", resumeStart + 1)
    const resumeBlock = controlsSrc.slice(resumeStart, resetTimerStart)
    expect(resumeBlock).not.toMatch(/withViewerSession\(/)
  })
})

// ---------------------------------------------------------------------------
// Invariant 5: resume optimistic patch returns prev (no status: 'in_progress')
// ---------------------------------------------------------------------------

describe('Invariant 5: useCommissionerActions resume returns prev without status flip', () => {
  it("resume handler returns prev — no optimistic status: 'in_progress'", () => {
    // The resume branch in the setSession callback must return prev unchanged.
    const resumeOptIdx = commSrc.indexOf("action === 'resume'")
    expect(resumeOptIdx).toBeGreaterThan(-1)
    // Find the closing of the resume if-block
    const returnPrevIdx = commSrc.indexOf('return prev', resumeOptIdx)
    const nextIfIdx = commSrc.indexOf("action === 'reset_timer'", resumeOptIdx)
    expect(returnPrevIdx).toBeGreaterThan(-1)
    expect(returnPrevIdx).toBeLessThan(nextIfIdx)
  })

  it("resume optimistic patch does NOT set status: 'in_progress'", () => {
    const resumeIdx = commSrc.indexOf("action === 'resume'")
    const resetTimerIdx = commSrc.indexOf("action === 'reset_timer'", resumeIdx)
    const resumeBlock = commSrc.slice(resumeIdx, resetTimerIdx)
    // Match only object property assignments (status: 'in_progress',) not comment text
    expect(resumeBlock).not.toMatch(/^\s*status:\s*['"]in_progress['"]\s*,/m)
  })

  it('resume optimistic patch does NOT set timerEndAt', () => {
    const resumeIdx = commSrc.indexOf("action === 'resume'")
    const resetTimerIdx = commSrc.indexOf("action === 'reset_timer'", resumeIdx)
    const resumeBlock = commSrc.slice(resumeIdx, resetTimerIdx)
    // Match only object property assignments (timerEndAt:) not comment text
    expect(resumeBlock).not.toMatch(/^\s*timerEndAt\s*:/m)
  })
})

// ---------------------------------------------------------------------------
// Invariant 6 & 7: commissionerLoading gates picks in snakeCanDraftRaw
// ---------------------------------------------------------------------------

describe('Invariant 6: commissionerLoading in snakeCanDraftRaw deps', () => {
  it('snakeCanDraftRaw dependency array includes commissionerLoading', () => {
    const snakeIdx = clientSrc.indexOf('const snakeCanDraftRaw = useMemo(')
    expect(snakeIdx).toBeGreaterThan(-1)
    // Find closing of the useMemo (the deps array is the second arg)
    const depsOpen = clientSrc.indexOf('[', clientSrc.indexOf('),', snakeIdx))
    const depsClose = clientSrc.indexOf(']', depsOpen)
    const depsBlock = clientSrc.slice(depsOpen, depsClose + 1)
    expect(depsBlock).toMatch(/commissionerLoading/)
  })
})

describe('Invariant 7: snakeCanDraftRaw expression checks !commissionerLoading', () => {
  it('snakeCanDraftRaw useMemo body contains !commissionerLoading', () => {
    const snakeIdx = clientSrc.indexOf('const snakeCanDraftRaw = useMemo(')
    // The memo body is everything between useMemo( and the trailing [deps])
    const depsOpen = clientSrc.indexOf('[', clientSrc.indexOf('),', snakeIdx))
    const memoBody = clientSrc.slice(snakeIdx, depsOpen)
    expect(memoBody).toMatch(/!commissionerLoading/)
  })
})

// ---------------------------------------------------------------------------
// Invariant 8 & 9: [draft-perf] timing emitted in pause/resume
// ---------------------------------------------------------------------------

describe('Invariant 8: [draft-perf] pause timing log', () => {
  it('pause block emits [draft-perf] pause controls log', () => {
    const pauseStart = controlsSrc.indexOf("if (action === 'pause')")
    const resumeStart = controlsSrc.indexOf("if (action === 'resume')", pauseStart + 1)
    const pauseBlock = controlsSrc.slice(pauseStart, resumeStart)
    expect(pauseBlock).toMatch(/\[draft-perf\] pause controls/)
  })
})

describe('Invariant 9: [draft-perf] resume timing log', () => {
  it('resume block emits [draft-perf] resume controls log', () => {
    const resumeStart = controlsSrc.indexOf("if (action === 'resume')")
    const resetTimerStart = controlsSrc.indexOf("if (action === 'reset_timer')", resumeStart + 1)
    const resumeBlock = controlsSrc.slice(resumeStart, resetTimerStart)
    expect(resumeBlock).toMatch(/\[draft-perf\] resume controls/)
  })
})

// ---------------------------------------------------------------------------
// Invariant 10: PickValidation allows paused picks (soft-draft scenario)
// ---------------------------------------------------------------------------

describe('Invariant 10: PickValidation allows picks while draft is paused', () => {
  const base = {
    playerName: 'JaMarr Chase',
    position: 'WR',
    rosterId: 'roster-a',
    currentOnClockRosterId: 'roster-a',
    existingPicks: [],
    sessionStatus: 'paused',
  }

  it('paused session does NOT return DRAFT_PICK_NOT_LIVE', () => {
    const result = validatePickSubmission(base)
    expect(result.code).not.toBe(DRAFT_PICK_NOT_LIVE)
  })

  it('paused session with valid slot returns valid:true', () => {
    const result = validatePickSubmission(base)
    expect(result.valid).toBe(true)
  })

  it('non-in_progress non-paused session still returns DRAFT_PICK_NOT_LIVE', () => {
    const result = validatePickSubmission({ ...base, sessionStatus: 'completed' })
    expect(result.valid).toBe(false)
    expect(result.code).toBe(DRAFT_PICK_NOT_LIVE)
  })

  it('pre_draft session returns DRAFT_PICK_NOT_LIVE', () => {
    const result = validatePickSubmission({ ...base, sessionStatus: 'pre_draft' })
    expect(result.valid).toBe(false)
    expect(result.code).toBe(DRAFT_PICK_NOT_LIVE)
  })
})
