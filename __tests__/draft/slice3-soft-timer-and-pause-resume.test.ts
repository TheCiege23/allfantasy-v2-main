import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isSoftTimerEnabled } from '@/lib/draft-defaults/DraftUISettingsResolver'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

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

describe('Slice 3 — expiry-autopick gates honor soft timer', () => {
  it('processExpiredDraftPickForLeague short-circuits with soft_timer_enabled when soft timer is on', () => {
    const src = read('lib/live-draft-engine/expired-picks/processExpiredDraftPicks.ts')
    expect(src).toMatch(/import \{[^}]*isSoftTimerEnabled[^}]*\} from '@\/lib\/draft-defaults\/DraftUISettingsResolver'/)
    expect(src).toMatch(/if \(isSoftTimerEnabled\(uiSettings\)\)\s*\{\s*return \{ leagueId, outcome: 'skipped', reason: 'soft_timer_enabled' \}/)
  })

  it('SlowDraftRuntimeService gates queue/BPA autopick on !isSoftTimerEnabled', () => {
    const src = read('lib/live-draft-engine/slow-draft/SlowDraftRuntimeService.ts')
    expect(src).toMatch(/import \{[^}]*isSoftTimerEnabled[^}]*\} from '@\/lib\/draft-defaults\/DraftUISettingsResolver'/)
    // The gate must include the !isSoftTimerEnabled(uiSettings) guard alongside the existing autoPickEnabled + timer.status checks.
    expect(src).toMatch(
      /uiSettings\.autoPickEnabled[\s\S]+?!isSoftTimerEnabled\(uiSettings\)[\s\S]+?timer\.status === 'expired'/,
    )
  })
})

describe('Slice 3 — pause/resume continuation behavior (no reset on resume)', () => {
  const draftSessionService = read('lib/live-draft-engine/DraftSessionService.ts')

  it('pauseDraftSession stores pausedRemainingSeconds and clears timerEndAt', () => {
    expect(draftSessionService).toMatch(/export async function pauseDraftSession/)
    expect(draftSessionService).toMatch(/pausedRemainingSeconds: remaining/)
    expect(draftSessionService).toMatch(/timerEndAt: null/)
  })

  it('resumeDraftSession continues from pausedRemainingSeconds when it is positive', () => {
    expect(draftSessionService).toMatch(/export async function resumeDraftSession/)
    // CONTINUE behavior: prefer pausedRemainingSeconds over configured timer — but only when > 0.
    // pausedRemainingSeconds = 0 means the timer was already expired; fall back to effectiveStored.
    expect(draftSessionService).toMatch(/hasUsableRemaining/)
    expect(draftSessionService).toMatch(/session\.pausedRemainingSeconds > 0/)
    expect(draftSessionService).toMatch(/sec = hasUsableRemaining \? session\.pausedRemainingSeconds/)
    // After resume, paused seconds field is cleared so the next pause writes fresh remaining.
    expect(draftSessionService).toMatch(/pausedRemainingSeconds: null/)
  })

  it('timer state survives reload via computeTimerStateWithPauseWindow reading paused seconds from DB', () => {
    const timerService = read('lib/live-draft-engine/DraftTimerService.ts')
    expect(timerService).toMatch(/input\.status === 'paused' && input\.pausedRemainingSeconds != null/)
    expect(timerService).toMatch(/remainingSeconds: input\.pausedRemainingSeconds/)
  })
})

describe('Slice 3 — soft timer does not duplicate timer logic', () => {
  it('isSoftTimerEnabled is the only soft-timer interpretation in the engine paths', () => {
    // Both expiry processors must reuse the helper (no inline timerMode === "soft_pause" comparisons drifting elsewhere).
    const expired = read('lib/live-draft-engine/expired-picks/processExpiredDraftPicks.ts')
    const slow = read('lib/live-draft-engine/slow-draft/SlowDraftRuntimeService.ts')
    expect(expired).not.toMatch(/timerMode === 'soft_pause'/)
    expect(slow).not.toMatch(/timerMode === 'soft_pause'/)
  })
})
