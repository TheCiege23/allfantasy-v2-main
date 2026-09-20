import { describe, expect, it } from 'vitest'
import { scopeLiveGamesToLeague } from '@/components/core-app/screens/LiveScores'
import type { LiveGameCard } from '@/lib/live/liveScoresPage'

function game(id: string, leagueIds: string[]): LiveGameCard {
  return {
    gameId: id,
    sport: 'NFL',
    week: 1,
    status: 'scheduled',
    statusDetail: 'Sun',
    clockLabel: null,
    isLive: false,
    completed: false,
    startTime: '2026-09-20T17:00:00.000Z',
    home: { abbrev: 'A', name: 'A', logo: '', score: null, record: null, linescores: [], hits: null, errors: null, leaders: [], shooting: null },
    away: { abbrev: 'B', name: 'B', logo: '', score: null, record: null, linescores: [], hits: null, errors: null, leaders: [], shooting: null },
    winProbability: null,
    topPerformer: null,
    leaders: [],
    situation: null,
    venue: null,
    broadcast: null,
    espnDetail: true,
    leadersArePregame: false,
    tieIns: leagueIds.map((leagueId) => ({
      leagueId,
      leagueName: leagueId,
      playerId: `${leagueId}-player`,
      playerName: `${leagueId} player`,
      position: 'WR',
      imageUrl: null,
      isStarter: true,
      points: 4.2,
    })),
    leaguesAffected: leagueIds.length,
  }
}

describe('league-scoped live scores', () => {
  it('keeps only games and starter rows belonging to the selected league', () => {
    const result = scopeLiveGamesToLeague(
      [game('shared', ['league-a', 'league-b']), game('other', ['league-b'])],
      'league-a',
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.gameId).toBe('shared')
    expect(result[0]?.tieIns.map((tieIn) => tieIn.leagueId)).toEqual(['league-a'])
    expect(result[0]?.leaguesAffected).toBe(1)
  })

  it('keeps the complete slate when no league is selected', () => {
    const games = [game('one', ['league-a']), game('two', ['league-b'])]
    expect(scopeLiveGamesToLeague(games, null)).toBe(games)
  })
})
