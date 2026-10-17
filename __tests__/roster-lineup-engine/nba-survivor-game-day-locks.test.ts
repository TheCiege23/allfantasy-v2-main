import { describe, expect, it } from 'vitest'
import { nbaSurvivorGameDayLocks } from '@/lib/roster-lineup-engine/lineupLockService'
import { movedLockedLineupPlayer } from '@/lib/roster-lineup-engine/lineupService'

const before = {
  lineup_sections: {
    starters: [{ id: 'a', position: 'PG' }, { id: 'b', position: 'C' }],
    bench: [{ id: 'c', position: 'SG' }], ir: [], taxi: [], devy: [],
  },
}

describe('NBA Survivor weekly lineup locks', () => {
  it('locks only teams whose games have tipped, across full names and abbreviations', () => {
    const now = new Date('2026-10-21T23:45:00Z')
    const locks = nbaSurvivorGameDayLocks(
      [{ playerId: 'a', team: 'BOS' }, { playerId: 'b', team: 'Los Angeles Lakers' }, { playerId: 'c', team: 'NY' }],
      [
        { homeTeam: 'Boston Celtics', awayTeam: 'New York Knicks', startTime: new Date('2026-10-21T23:00:00Z') },
        { homeTeam: 'LA Lakers', awayTeam: 'Phoenix Suns', startTime: new Date('2026-10-22T01:00:00Z') },
      ], now,
    )
    expect(locks.lockedPlayerIds).toEqual(['a', 'c'])
    expect(locks.reasons.a).toMatch(/started/)
  })

  it('keeps a player locked after an earlier game and honors a preselected later game', () => {
    const games = [
      { homeTeam: 'Boston Celtics', awayTeam: 'New York Knicks', startTime: new Date('2026-10-20T23:00:00Z') },
      { homeTeam: 'Boston Celtics', awayTeam: 'Miami Heat', startTime: new Date('2026-10-23T23:00:00Z') },
    ]
    const now = new Date('2026-10-22T12:00:00Z')
    expect(nbaSurvivorGameDayLocks([{ playerId: 'a', team: 'BOS' }], games, now).lockedPlayerIds).toEqual(['a'])
    const selected = new Map([['a', new Date('2026-10-23T23:00:00Z')]])
    expect(nbaSurvivorGameDayLocks([{ playerId: 'a', team: 'BOS' }], games, now, selected).lockedPlayerIds).toEqual([])
    expect(nbaSurvivorGameDayLocks([{ playerId: 'a', team: 'BOS' }], games, games[1].startTime, selected).lockedPlayerIds).toEqual(['a'])
  })

  it('rejects moving a locked player but allows an unrelated bench swap', () => {
    const changed = { lineup_sections: { ...before.lineup_sections, starters: [before.lineup_sections.starters[1], before.lineup_sections.starters[0]] } }
    expect(movedLockedLineupPlayer(before, changed, ['a'])).toBe('a')
    expect(movedLockedLineupPlayer(before, changed, ['c'])).toBeNull()
    const benched = { lineup_sections: { ...before.lineup_sections, starters: [before.lineup_sections.starters[1]], bench: [before.lineup_sections.bench[0], before.lineup_sections.starters[0]] } }
    expect(movedLockedLineupPlayer(before, benched, ['a'])).toBe('a')
  })
})
