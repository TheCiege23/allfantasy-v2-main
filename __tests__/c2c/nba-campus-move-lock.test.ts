import { describe, expect, it } from 'vitest'
import { nbaCampusMoveLock } from '@/lib/c2c/nbaCampusMoveLock'
import type { ScheduleGame } from '@/lib/sports-data/riScheduleCache'
const game = (status: string, startTime: string | null): ScheduleGame => ({ gameId: '1', day: '2026-11-01', startTime, status, homeTeamId: '10', awayTeamId: '20', seasonType: 'regular', eventName: null, replacedBy: null })
const base = { changedPlayerIds: ['p'], teamForPlayer: new Map([['p', '10']]), now: new Date('2026-11-01T18:00:00Z') }
describe('NBA campus move lock', () => {
  it('locks a player after the first scheduled game starts', () => {
    expect(nbaCampusMoveLock({ ...base, games: [game('scheduled', '2026-11-01T17:00:00Z')] }).lockedPlayerIds).toEqual(['p'])
    expect(nbaCampusMoveLock({ ...base, games: [game('final', null)] }).lockedPlayerIds).toEqual(['p'])
    expect(nbaCampusMoveLock({ ...base, games: [game('scheduled', '2026-11-01T19:00:00Z')] })).toEqual({ lockedPlayerIds: [], unknownPlayerIds: [] })
  })
  it('refuses to infer a safe move from missing schedule or team evidence', () => {
    expect(nbaCampusMoveLock({ ...base, games: null }).unknownPlayerIds).toEqual(['p'])
    expect(nbaCampusMoveLock({ ...base, games: [game('scheduled', null)] }).unknownPlayerIds).toEqual(['p'])
    expect(nbaCampusMoveLock({ ...base, games: [], teamForPlayer: new Map() }).unknownPlayerIds).toEqual(['p'])
  })
})
