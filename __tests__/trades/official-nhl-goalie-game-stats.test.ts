import { describe, expect, it, vi } from 'vitest'
import { carryOfficialNhlGoalieStats, fetchOfficialNhlGoalieDay, matchOfficialNhlGoalieGame,
  OFFICIAL_GOALIE_SOURCE, type OfficialNhlGoalieGame } from '@/lib/nhl-scoring/officialGoalieGameStats'

const official: OfficialNhlGoalieGame = { gameDate: '2026-10-19', gameId: 2026020138,
  playerId: 8478569, goalieFullName: 'Joseph Woll', teamAbbrev: 'TOR', opponentTeamAbbrev: 'MTL',
  saves: 25, goalsAgainst: 2, goals: 0, assists: 0, penaltyMinutes: 2 }
const box = { date: '2026-10-19', team: 'TOR', opponent: 'MTL',
  playerName: 'Joseph Woll', saves: 25, goalsAgainst: 2 }

describe('official NHL goalie game evidence', () => {
  it('requires one exact player/game and matching saves and goals against', () => {
    expect(matchOfficialNhlGoalieGame(box, [official])).toEqual({ row: official, reason: null })
    expect(matchOfficialNhlGoalieGame({ ...box, saves: 24 }, [official]).reason)
      .toBe('official_game_stat_conflict')
    expect(matchOfficialNhlGoalieGame({ ...box, opponent: 'BOS' }, [official]).reason)
      .toBe('official_player_missing')
    expect(matchOfficialNhlGoalieGame(box, [official, official]).reason)
      .toBe('ambiguous_official_player')
  })

  it('paginates only complete, unique official rows', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200,
      json: async () => ({ total: 1, data: [official] }) })) as unknown as typeof fetch
    expect(await fetchOfficialNhlGoalieDay('2026-10-19', fetchImpl)).toEqual([official])
    const url = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as URL
    expect(url.searchParams.get('sort')).toContain('playerId')
    const incomplete = vi.fn(async () => ({ ok: true, status: 200,
      json: async () => ({ total: 2, data: [] }) })) as unknown as typeof fetch
    await expect(fetchOfficialNhlGoalieDay('2026-10-19', incomplete)).rejects.toThrow('INCOMPLETE')
    const duplicate = vi.fn(async () => ({ ok: true, status: 200,
      json: async () => ({ total: 2, data: [official, official] }) })) as unknown as typeof fetch
    await expect(fetchOfficialNhlGoalieDay('2026-10-19', duplicate)).rejects.toThrow('DUPLICATE')
  })

  it('carries verified goals, assists and penalty minutes through an unchanged RI refresh', () => {
    const existing = { providerGameId: 'ri-game', gameDate: new Date('2026-10-19T00:00:00Z'),
      team: 'TOR', opponent: 'MTL', normalizedStatMap: {
        stats: { saves: 25, goals_allowed: 2, goalie_goals: 0,
          goalie_assists: 0, goalie_penalty_minutes: 2 },
        officialGoalieGameStats: { source: OFFICIAL_GOALIE_SOURCE,
          gameId: official.gameId, playerId: official.playerId, gameDate: '2026-10-19' },
      } }
    const identity = { providerGameId: 'ri-game', gameDate: new Date('2026-10-19T00:00:00Z'),
      team: 'TOR', opponent: 'MTL' }
    expect(carryOfficialNhlGoalieStats(existing, { stats: { saves: 25, goals_allowed: 2 } }, identity))
      .toMatchObject({ stats: { goalie_goals: 0, goalie_assists: 0, goalie_penalty_minutes: 2 } })
    expect(carryOfficialNhlGoalieStats(existing, { stats: { saves: 24, goals_allowed: 2 } }, identity))
      .toEqual({ stats: { saves: 24, goals_allowed: 2 } })
    expect(carryOfficialNhlGoalieStats(existing, { stats: { saves: 25, goals_allowed: 2 } },
      { ...identity, providerGameId: 'other' })).toEqual({ stats: { saves: 25, goals_allowed: 2 } })
  })
})
