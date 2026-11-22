import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { chimmyManagesRoster } from '@/lib/commissioner-ai-draft-manager/chimmyManagerPick'
import { CHIMMY_PICK_DELAY_MS, chimmyThinkingTimeElapsed } from '@/lib/commissioner-ai-draft-manager/chimmyPickTiming'
import { DEFAULT_TRADE_RULES, type CommissionerAiManagersBlob } from '@/lib/commissioner-ai-draft-manager/types'

function blob(assignments: Array<{ rosterId: string; active: boolean }>): CommissionerAiManagersBlob {
  return {
    assignments: assignments.map((a) => ({ ...a, aiStyle: 'BALANCED', tradeAggression: 'medium' })),
    tradeRules: DEFAULT_TRADE_RULES,
  }
}

describe('chimmyManagesRoster', () => {
  const base = { orphanRosterIds: ['r-orphan'], orphanAiManagerEnabled: true }

  it('is true only for an orphan with an active Chimmy assignment', () => {
    expect(chimmyManagesRoster({ ...base, blob: blob([{ rosterId: 'r-orphan', active: true }]), rosterId: 'r-orphan' }))
      .toEqual({ eligible: true })
  })

  it('leaves an orphan nobody assigned to the old behaviour', () => {
    expect(chimmyManagesRoster({ ...base, blob: blob([]), rosterId: 'r-orphan' }))
      .toEqual({ eligible: false, reason: 'not_assigned' })
    expect(chimmyManagesRoster({ ...base, blob: blob([{ rosterId: 'r-orphan', active: false }]), rosterId: 'r-orphan' }))
      .toEqual({ eligible: false, reason: 'not_assigned' })
  })

  it('never drafts for a team a person has claimed, even if an old assignment remains', () => {
    expect(chimmyManagesRoster({ ...base, blob: blob([{ rosterId: 'r-human', active: true }]), rosterId: 'r-human' }))
      .toEqual({ eligible: false, reason: 'not_orphan' })
  })

  it('is off when the league turned the orphan AI manager off', () => {
    expect(
      chimmyManagesRoster({
        ...base,
        orphanAiManagerEnabled: false,
        blob: blob([{ rosterId: 'r-orphan', active: true }]),
        rosterId: 'r-orphan',
      }),
    ).toEqual({ eligible: false, reason: 'ai_manager_disabled' })
  })
})

describe('chimmyThinkingTimeElapsed', () => {
  const now = new Date('2026-10-27T12:00:00Z')
  const endsIn = (seconds: number) => new Date(now.getTime() + seconds * 1000).toISOString()

  it('waits for the thinking time after the clock starts', () => {
    // 90s timer that started 1s ago.
    expect(chimmyThinkingTimeElapsed({ timerSeconds: 90, timerEndAt: endsIn(89), now })).toBe(false)
    // Started CHIMMY_PICK_DELAY_MS ago.
    expect(
      chimmyThinkingTimeElapsed({ timerSeconds: 90, timerEndAt: endsIn(90 - CHIMMY_PICK_DELAY_MS / 1000), now }),
    ).toBe(true)
  })

  it('allows half a second of clock skew between browser and server', () => {
    expect(chimmyThinkingTimeElapsed({ timerSeconds: 90, timerEndAt: endsIn(86.4), now })).toBe(true)
    expect(chimmyThinkingTimeElapsed({ timerSeconds: 90, timerEndAt: endsIn(87), now })).toBe(false)
  })

  it('does not hold an untimed pick, which has no clock to measure', () => {
    expect(chimmyThinkingTimeElapsed({ timerSeconds: null, timerEndAt: null, now })).toBe(true)
    expect(chimmyThinkingTimeElapsed({ timerSeconds: 90, timerEndAt: null, now })).toBe(true)
    expect(chimmyThinkingTimeElapsed({ timerSeconds: 90, timerEndAt: 'not a date', now })).toBe(true)
  })
})
