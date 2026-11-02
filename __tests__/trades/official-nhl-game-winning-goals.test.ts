import { describe, expect, it, vi } from 'vitest'
import { carryOfficialNhlGameWinningGoals, fetchOfficialNhlSkaterDay, matchOfficialNhlSkaterGame,
  type OfficialNhlSkaterGame } from '@/lib/nhl-scoring/officialGameWinningGoals'

const official: OfficialNhlSkaterGame = {
  gameDate: '2026-10-19', gameId: 2026020138, playerId: 8478569,
  skaterFullName: 'Noel Acciari', teamAbbrev: 'PHI', opponentTeamAbbrev: 'COL',
  goals: 1, gameWinningGoals: 1,
}
const box = { date: '2026-10-19', team: 'PHI', opponent: 'COL',
  playerName: 'Noel Acciari', goals: 1 }

describe('official NHL game-winning-goal evidence', () => {
  it('matches one player only when date, teams, name, and goals agree', () => {
    expect(matchOfficialNhlSkaterGame(box, [official])).toEqual({ row: official, reason: null })
    expect(matchOfficialNhlSkaterGame({ ...box, goals: 2 }, [official]).reason)
      .toBe('official_game_stat_conflict')
    expect(matchOfficialNhlSkaterGame({ ...box, team: 'COL' }, [official]).reason)
      .toBe('official_player_missing')
    expect(matchOfficialNhlSkaterGame(box, [official, official]).reason)
      .toBe('ambiguous_official_player')
  })

  it('recognizes provider and NHL team-code aliases without relaxing the player join', () => {
    const sanJose = { ...official, teamAbbrev: 'SJS', opponentTeamAbbrev: 'TBL' }
    expect(matchOfficialNhlSkaterGame({ ...box, team: 'SJ', opponent: 'TB' }, [sanJose]))
      .toEqual({ row: sanJose, reason: null })
  })

  it('paginates a date and rejects an incomplete official response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true,
      json: async () => ({ total: 1, data: [official] }) })) as unknown as typeof fetch
    expect(await fetchOfficialNhlSkaterDay('2026-10-19', fetchImpl)).toEqual([official])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const broken = vi.fn(async () => ({ ok: true,
      json: async () => ({ total: 2, data: [] }) })) as unknown as typeof fetch
    await expect(fetchOfficialNhlSkaterDay('2026-10-19', broken)).rejects.toThrow('INCOMPLETE')
  })

  it('retries a rate-limited official page and then checks its contents', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ status: 429, headers: { get: () => '0.001' } })
      .mockResolvedValueOnce({ status: 200, ok: true,
        json: async () => ({ total: 1, data: [official] }) }) as unknown as typeof fetch
    expect(await fetchOfficialNhlSkaterDay('2026-10-19', fetchImpl)).toEqual([official])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('stops before an expired cron deadline without requesting another page', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    await expect(fetchOfficialNhlSkaterDay('2026-10-19', fetchImpl, Date.now() - 1))
      .rejects.toThrow('NHL_OFFICIAL_DEADLINE')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('preserves official evidence across an unchanged game refresh and drops it on a stat correction', () => {
    const existing = { providerGameId: 'ri-game', gameDate: new Date('2026-10-19T00:00:00Z'),
      team: 'SJ', opponent: 'TB', normalizedStatMap: {
        stats: { goals: 1, game_winning_goals: 1 },
        officialGameWinningGoals: { source: 'nhl_stats_rest_game_summary_v1',
          gameId: 2026020138, playerId: 8478569, gameDate: '2026-10-19' },
      } }
    const nextIdentity = { providerGameId: 'ri-game', gameDate: new Date('2026-10-19T00:00:00Z'),
      team: 'SJS', opponent: 'TBL' }
    expect(carryOfficialNhlGameWinningGoals(existing, { stats: { goals: 1, assists: 2 } }, nextIdentity))
      .toMatchObject({ stats: { goals: 1, assists: 2, game_winning_goals: 1 } })
    expect(carryOfficialNhlGameWinningGoals(existing, { stats: { goals: 0 } }, nextIdentity))
      .toEqual({ stats: { goals: 0 } })
  })
})
