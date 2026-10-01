import { describe, expect, it } from 'vitest'
import { currentSkill, periodOrdinal, replayAll, replaySport, type RatedGame } from '@/lib/rank/skillRating/replay'

function game(season: number, week: number, a: string, b: string, scoreA: number, scoreB: number, sport = 'NFL'): RatedGame {
  return { sport, season, week, leagueKey: 'L1', leagueName: 'League', a, b, aName: a, bName: b, scoreA, scoreB }
}

describe('skill replay', () => {
  it('a manager who keeps winning rises above one who keeps losing, and the record counts every game', () => {
    const games: RatedGame[] = []
    for (let w = 1; w <= 10; w++) games.push(game(2025, w, 'af:winner', 'af:loser', 120, 90))
    const r = replaySport('NFL', games)
    const winner = r.managers.get('af:winner')!
    const loser = r.managers.get('af:loser')!
    expect(winner.rating).toBeGreaterThan(1500)
    expect(loser.rating).toBeLessThan(1500)
    expect(winner).toMatchObject({ games: 10, wins: 10, losses: 0, ties: 0 })
    expect(loser).toMatchObject({ games: 10, wins: 0, losses: 10 })
    expect(winner.rd).toBeLessThan(350)
    expect(r.games).toBe(10)
    expect(r.periods).toBe(10)
  })

  it('reads results from points, so a tie is a tie (writers store a tie as a loss for both)', () => {
    const r = replaySport('NFL', [game(2025, 1, 'a', 'b', 100, 100)])
    expect(r.managers.get('a')).toMatchObject({ ties: 1, wins: 0, losses: 0 })
    expect(r.managers.get('a')!.rating).toBeCloseTo(1500, 6)
  })

  it('updates a period simultaneously, so the order games are read in cannot change a rating', () => {
    const week: RatedGame[] = [
      game(2025, 1, 'a', 'b', 120, 100),
      game(2025, 1, 'c', 'a', 130, 90),
      game(2025, 1, 'b', 'c', 110, 105),
    ]
    const forward = replaySport('NFL', week)
    const backward = replaySport('NFL', [...week].reverse())
    for (const k of ['a', 'b', 'c']) {
      expect(forward.managers.get(k)!.rating).toBeCloseTo(backward.managers.get(k)!.rating, 10)
      expect(forward.managers.get(k)!.rd).toBeCloseTo(backward.managers.get(k)!.rd, 10)
    }
  })

  it('beating a proven strong manager is worth more than beating a proven weak one', () => {
    const history: RatedGame[] = []
    for (let w = 1; w <= 12; w++) {
      history.push(game(2024, w, 'strong', `filler-s${w}`, 140, 80))
      history.push(game(2024, w, 'weak', `filler-w${w}`, 70, 130))
    }
    const vsStrong = replaySport('NFL', [...history, game(2025, 1, 'newA', 'strong', 120, 110)])
    const vsWeak = replaySport('NFL', [...history, game(2025, 1, 'newA', 'weak', 120, 110)])
    expect(vsStrong.managers.get('newA')!.rating).toBeGreaterThan(vsWeak.managers.get('newA')!.rating)
  })

  it('skips self-games and blank keys', () => {
    const r = replaySport('NFL', [game(2025, 1, 'a', 'a', 100, 90), game(2025, 1, '', 'b', 100, 90)])
    expect(r.games).toBe(0)
    expect(r.managers.size).toBe(0)
  })

  it('keeps a game log only for the managers asked for, with before/after and the opponent rating going in', () => {
    const r = replaySport(
      'NFL',
      [game(2025, 1, 'af:me', 'p:sleeper:x', 120, 100), game(2025, 2, 'af:me', 'p:sleeper:y', 80, 100)],
      (k) => k.startsWith('af:'),
    )
    expect(r.logs.has('p:sleeper:x')).toBe(false)
    const log = r.logs.get('af:me')!
    expect(log.map((e) => e.result)).toEqual(['W', 'L'])
    expect(log[0]).toMatchObject({ ratingBefore: 1500, opponentRating: 1500, myScore: 120, oppScore: 100, opponent: 'p:sleeper:x' })
    expect(log[0].ratingAfter).toBeGreaterThan(1500)
    expect(log[1].ratingBefore).toBe(log[0].ratingAfter)
    expect(log[1].ratingAfter).toBeLessThan(log[1].ratingBefore)
    expect(log[0].expected).toBeCloseTo(0.5, 3)
  })

  it('rates each sport separately', () => {
    const all = replayAll([game(2025, 1, 'af:me', 'b', 120, 100, 'NFL'), game(2025, 1, 'af:me', 'c', 80, 100, 'NBA')])
    expect(all.get('NFL')!.managers.get('af:me')!.wins).toBe(1)
    expect(all.get('NBA')!.managers.get('af:me')!.losses).toBe(1)
  })

  it('an offseason makes the system less sure of a manager than a week off does', () => {
    const games: RatedGame[] = []
    for (let w = 1; w <= 17; w++) games.push(game(2024, w, 'a', `o${w}`, 110, 100))
    const r = replaySport('NFL', games)
    const a = r.managers.get('a')!
    const nextWeek = currentSkill(a, periodOrdinal(2024, 18))
    const nextSeason = currentSkill(a, periodOrdinal(2025, 1))
    expect(nextSeason.rd).toBeGreaterThan(nextWeek.rd)
    expect(nextSeason.rating).toBe(a.rating)
  })
})
