import { describe, expect, it } from 'vitest'
import { canCaptureNbaCampusCarryover } from '@/lib/c2c/nbaCampusCarryover'
import type { ScheduleGame } from '@/lib/sports-data/riScheduleCache'
const game: ScheduleGame = { gameId: '1', day: '2026-11-01', startTime: '2026-11-01T18:00:00Z', status: 'scheduled', seasonType: 'regular', eventName: null, replacedBy: null, homeTeamId: '1', awayTeamId: '2' }
const base = { now: new Date('2026-11-01T17:00:00Z'), window: { start: new Date('2026-10-27T00:00:00Z'), end: new Date('2026-11-03T00:00:00Z') }, schedule: [game], meta: { firstDay: '2026-11-01', lastDay: '2027-03-07', syncedAt: '2026-11-01T12:00:00Z' } }
describe('NBA campus weekly carryover safety', () => {
  it('allows a roster snapshot before the first college game', () => { expect(canCaptureNbaCampusCarryover(base)).toBe(true) })
  it('refuses a snapshot after any game, even for an unrelated school', () => { expect(canCaptureNbaCampusCarryover({ ...base, now: new Date('2026-11-01T18:00:00Z') })).toBe(false) })
  it('rejects missing, postponed or unpublished schedules', () => {
    expect(canCaptureNbaCampusCarryover({ ...base, schedule: null })).toBe(false)
    expect(canCaptureNbaCampusCarryover({ ...base, meta: { ...base.meta, syncedAt: '2026-10-01T00:00:00Z' } })).toBe(false)
    expect(canCaptureNbaCampusCarryover({ ...base, schedule: [{ ...game, status: 'postponed' }] })).toBe(false)
    expect(canCaptureNbaCampusCarryover({ ...base, meta: { firstDay: '2026-11-01', lastDay: '2026-11-01' } })).toBe(false)
  })
})
