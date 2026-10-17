import { describe, expect, it } from 'vitest'
import { buildBossRoster, chooseBossTeam } from '@/lib/survivor/exileBoss'

describe("Chimmy's Exile team", () => {
  it('takes the open team with the most games left, alphabetically on ties', () => {
    const games = [
      { homeTeam: 'BOS', awayTeam: 'NYK' }, { homeTeam: 'NYK', awayTeam: 'MIA' },
      { homeTeam: 'MIA', awayTeam: 'BOS' }, { homeTeam: 'NYK', awayTeam: 'LAL' },
    ]
    expect(chooseBossTeam(games, [])).toBe('NYK')
    expect(chooseBossTeam(games, ['NYK'])).toBe('BOS')
    expect(chooseBossTeam([], [])).toBeNull()
  })

  it('anchors on a point guard and fills slots with the best recent producers', () => {
    const players = [
      { id: 'c1', name: 'Center One', position: 'C', team: 'NYK', average: 50 },
      { id: 'g1', name: 'Guard One', position: 'PG', team: 'NYK', average: 30 },
      { id: 'f1', name: 'Forward One', position: 'SF', team: 'NYK', average: 20 },
    ]
    const roster = buildBossRoster('NBA', {}, players, [])
    expect(roster.anchorId).toBe('g1')
    expect(roster.team).toBe('NYK')
    expect(roster.players.map(p => p.id)).toEqual(['g1', 'c1', 'f1'])
  })

  it('fields nobody when the team has no player who can anchor', () => {
    expect(buildBossRoster('NBA', {}, [{ id: 'c1', name: 'Center', position: 'C', team: 'NYK', average: 40 }], []).players).toEqual([])
  })
})
