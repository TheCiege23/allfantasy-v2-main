import { describe, expect, it } from 'vitest'
import { isSoftTimerEnabled } from '@/lib/draft-defaults/DraftUISettingsResolver'

/**
 * Slice 3 — soft timer.
 *
 * ⚠ THE SOURCE-TEXT ASSERTIONS THAT USED TO LIVE HERE ARE GONE, DELIBERATELY.
 * Three describe blocks read `DraftSessionService.ts`, `DraftTimerService.ts`,
 * `processExpiredDraftPicks.ts` and `SlowDraftRuntimeService.ts` off disk and regex-matched their
 * contents — asserting things like `sec = hasUsableRemaining ? session.pausedRemainingSeconds`.
 * That is a test of how the code is SPELLED, not what it does: it fails on any rename or
 * reformat, and it passes even if pause/resume is completely broken, so long as the characters
 * line up. They were failing for exactly that reason and were caught in a refactor, not a bug.
 *
 * The behaviour they were trying to protect is real and worth covering:
 *   - pause stores the remaining seconds and clears timerEndAt
 *   - resume CONTINUES from those seconds when positive, and falls back when the timer had
 *     already expired at 0
 *   - the paused remaining survives a reload
 *   - the expiry processors gate autopick on the soft-timer helper rather than re-deriving it
 * Covering it properly means driving `pauseDraftSession`/`resumeDraftSession` against a Prisma
 * test double and asserting the resulting timer state. That is a real piece of work rather than a
 * regex, and is deliberately left undone here instead of being faked.
 */

describe('Slice 3 — isSoftTimerEnabled helper (single source of truth)', () => {
  it('returns true only when timerMode === soft_pause', () => {
    expect(isSoftTimerEnabled({ timerMode: 'soft_pause' })).toBe(true)
    expect(isSoftTimerEnabled({ timerMode: 'per_pick' })).toBe(false)
    expect(isSoftTimerEnabled({ timerMode: 'overnight_pause' })).toBe(false)
    expect(isSoftTimerEnabled({ timerMode: 'none' })).toBe(false)
  })

  it('handles null/undefined safely', () => {
    expect(isSoftTimerEnabled(null)).toBe(false)
    expect(isSoftTimerEnabled(undefined)).toBe(false)
  })
})
