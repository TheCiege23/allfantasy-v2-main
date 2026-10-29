// @vitest-environment node
/**
 * The season recap from stored data. Every award is checked against a season small enough to work out
 * by hand, and an award whose data is absent must be reported missing — never shown as zero.
 */
import { describe, expect, it } from 'vitest'
import { computeSeasonRecap, seasonRecapHeadline, type SeasonRecapInput } from '@/lib/season-recap/computeSeasonRecap'
import { recapWeekAt, redraftTradeSides } from '@/lib/season-recap/loadSeasonRecapInput'

const team = (rosterId: string, name: string, wins: number, losses: number, pointsFor: number, playoffSeed: number | null, ownerId = `u-${rosterId}`) => ({
  rosterId, name, ownerId, wins, losses, ties: 0, pointsFor, pointsAgainst: 0, playoffSeed,
})

function season(over: Partial<SeasonRecapInput> = {}): SeasonRecapInput {
  return {
    leagueId: 'L',
    season: 2026,
    sport: 'NFL',
    playoffStartWeek: 5,
    teams: [team('a', 'Aces', 3, 1, 480, 1), team('b', 'Bears', 2, 2, 470, 2), team('c', 'Cats', 2, 2, 430, null), team('d', 'Dogs', 1, 3, 400, null)],
    regularGames: [
      { week: 1, homeRosterId: 'a', awayRosterId: 'b', homeScore: 120, awayScore: 119.5 }, // closest: 0.5
      { week: 1, homeRosterId: 'c', awayRosterId: 'd', homeScore: 100, awayScore: 90 },
      { week: 2, homeRosterId: 'a', awayRosterId: 'c', homeScore: 150, awayScore: 80 }, // blowout: 70, high: 150
      { week: 2, homeRosterId: 'b', awayRosterId: 'd', homeScore: 110, awayScore: 100 },
      { week: 3, homeRosterId: 'a', awayRosterId: 'd', homeScore: 100, awayScore: 110 },
      { week: 3, homeRosterId: 'b', awayRosterId: 'c', homeScore: 120, awayScore: 125 },
      { week: 4, homeRosterId: 'a', awayRosterId: 'b', homeScore: 110, awayScore: 121 },
      { week: 4, homeRosterId: 'c', awayRosterId: 'd', homeScore: 125, awayScore: 100 },
      { week: 4, homeRosterId: 'a', awayRosterId: 'd', homeScore: 0, awayScore: 0 }, // never played
    ],
    championRosterId: 'b',
    runnerUpRosterId: 'a',
    playoffRosterIds: ['a', 'b'],
    lowerBracketFinal: { mode: 'toilet_bowl', winnerRosterId: 'c', loserRosterId: 'd' },
    trades: [
      { tradeId: 't1', executedAt: null, sides: [{ rosterId: 'a', valueIn: 900, valueOut: 600 }, { rosterId: 'c', valueIn: 600, valueOut: 900 }] },
      { tradeId: 't2', executedAt: null, sides: [{ rosterId: 'b', valueIn: 500, valueOut: 450 }, { rosterId: 'd', valueIn: 450, valueOut: 500 }] },
    ],
    pickups: [
      { rosterId: 'b', playerId: 'p1', playerName: 'Waiver Hero', position: 'RB', pickupWeek: 1, pointsAfter: 64.2, weeksCounted: 3 },
      { rosterId: 'd', playerId: 'p2', playerName: 'Depth Guy', position: 'WR', pickupWeek: 2, pointsAfter: 20, weeksCounted: 2 },
    ],
    priorSeasonByOwnerId: { 'u-a': { wins: 1, losses: 3, ties: 0 }, 'u-b': { wins: 2, losses: 2, ties: 0 } },
    computedAt: '2027-01-10T00:00:00.000Z',
    ...over,
  }
}

describe('computeSeasonRecap', () => {
  const recap = computeSeasonRecap(season())

  it('champion, runner-up and the regular-season #1 seed', () => {
    expect(recap.champion).toEqual({ rosterId: 'b', name: 'Bears' })
    expect(recap.runnerUp).toEqual({ rosterId: 'a', name: 'Aces' })
    expect(recap.topSeed).toMatchObject({ rosterId: 'a', wins: 3, losses: 1 })
    expect(seasonRecapHeadline(recap)).toBe('Bears won the 2026 title')
  })

  it('most points for, the highest week, the biggest blowout and the closest game', () => {
    expect(recap.mostPointsFor).toEqual({ rosterId: 'a', name: 'Aces', points: 480 })
    expect(recap.highestWeek).toEqual({ rosterId: 'a', name: 'Aces', week: 2, points: 150 })
    expect(recap.biggestBlowout).toMatchObject({ week: 2, winner: { rosterId: 'a' }, loser: { rosterId: 'c' }, margin: 70 })
    expect(recap.closestGame).toMatchObject({ week: 1, winner: { rosterId: 'a' }, loser: { rosterId: 'b' }, margin: 0.5, tie: false })
  })

  it('a 0-0 placeholder game is not the closest game of the season', () => {
    expect(recap.closestGame?.margin).not.toBe(0)
  })

  it('best and worst trade by value are the biggest gain and the biggest loss', () => {
    expect(recap.bestTrade).toMatchObject({ rosterId: 'a', tradeId: 't1', net: 300, partner: { rosterId: 'c' } })
    expect(recap.worstTrade).toMatchObject({ rosterId: 'c', tradeId: 't1', net: -300 })
    expect(recap.tradeCount).toBe(2)
  })

  it('the waiver pickup with the most points after pickup', () => {
    expect(recap.bestPickup).toMatchObject({ rosterId: 'b', playerName: 'Waiver Hero', pointsAfter: 64.2, pickupWeek: 1 })
  })

  it('most improved against last season, by win rate', () => {
    expect(recap.mostImproved).toMatchObject({ rosterId: 'a', basis: 'prior_season', before: 0.25, after: 0.75, delta: 0.5 })
  })

  it('without a prior season it falls back to the second half against the first, and says so', () => {
    const r = computeSeasonRecap(season({ priorSeasonByOwnerId: null }))
    expect(r.mostImproved?.basis).toBe('second_half')
    // Cats: weeks 1-2 avg 90, weeks 3-4 avg 125 → +35, the largest.
    expect(r.mostImproved).toMatchObject({ rosterId: 'c', before: 90, after: 125, delta: 35 })
  })

  it('the toilet bowl result names the last-place team', () => {
    expect(recap.lowerBracket).toEqual({ mode: 'toilet_bowl', winner: { rosterId: 'c', name: 'Cats' }, loser: { rosterId: 'd', name: 'Dogs' } })
  })

  it('standings put the champion and runner-up first, then regular-season order, with each team\'s line', () => {
    expect(recap.teamLines.map((l) => l.team.rosterId)).toEqual(['b', 'a', 'c', 'd'])
    const aces = recap.teamLines.find((l) => l.team.rosterId === 'a')!
    expect(aces).toMatchObject({ finish: 'runner_up', bestWeek: { week: 2, points: 150 }, worstWeek: { week: 3, points: 100 }, longestWinStreak: 2 })
    expect(recap.teamLines.find((l) => l.team.rosterId === 'c')!.finish).toBe('missed_playoffs')
  })

  it('every team carrying an in-season seed is NOT the playoff field — the seed table is', () => {
    const seededAll = season({
      teams: season().teams.map((t, i) => ({ ...t, playoffSeed: i + 1 })),
      championRosterId: null,
      runnerUpRosterId: null,
      playoffRosterIds: ['a', 'b'],
    })
    const r = computeSeasonRecap(seededAll)
    expect(r.teamLines.filter((l) => l.finish === 'playoffs').map((l) => l.team.rosterId).sort()).toEqual(['a', 'b'])
  })

  it('a stored finish order wins over the fallback', () => {
    const r = computeSeasonRecap(season({ finishOrder: ['b', 'a', 'd', 'c'] }))
    expect(r.teamLines.map((l) => l.team.rosterId)).toEqual(['b', 'a', 'd', 'c'])
  })

  it('🛑 missing data is reported missing, not shown as zero', () => {
    const r = computeSeasonRecap(season({ trades: null, pickups: null, championRosterId: null, runnerUpRosterId: null, regularGames: [] }))
    expect(r.bestTrade).toBeNull()
    expect(r.bestPickup).toBeNull()
    expect(r.champion).toBeNull()
    expect(r.highestWeek).toBeNull()
    expect(r.missing.join(' ')).toMatch(/Trades could not be read/)
    expect(r.missing.join(' ')).toMatch(/Waiver pickups could not be measured/)
    expect(r.missing.join(' ')).toMatch(/No champion/)
    expect(r.missing.join(' ')).toMatch(/No final regular-season scores/)
  })

  it('unvalued trades are counted and named, not ranked', () => {
    const r = computeSeasonRecap(season({ trades: [], unvaluedTradeCount: 3 }))
    expect(r.bestTrade).toBeNull()
    expect(r.tradeCount).toBe(3)
    expect(r.missing.join(' ')).toMatch(/3 trade\(s\) had no stored trade value/)
  })
})

describe('loader helpers', () => {
  it('redraftTradeSides nets each roster from the frozen snapshot assets', () => {
    const payload = {
      grade: { insufficientData: false },
      sides: [
        { rosterId: 'a', assets: [{ fromRosterId: 'a', toRosterId: 'b', internalValue: 40 }] },
        { rosterId: 'b', assets: [{ fromRosterId: 'b', toRosterId: 'a', internalValue: 55 }] },
      ],
    }
    expect(redraftTradeSides(payload)).toEqual([
      { rosterId: 'a', valueIn: 55, valueOut: 40 },
      { rosterId: 'b', valueIn: 40, valueOut: 55 },
    ])
  })

  it('an ungradeable snapshot is no value, not zero value', () => {
    expect(redraftTradeSides({ grade: { insufficientData: true }, sides: [] })).toBeNull()
  })

  it('recapWeekAt places an NFL date in its week, and refuses a date from another season', () => {
    expect(recapWeekAt('NFL', 2026, new Date('2026-09-05T12:00:00Z'))).toBe(1)
    expect(recapWeekAt('NFL', 2026, new Date('2026-09-20T12:00:00Z'))).toBe(3)
    expect(recapWeekAt('NFL', 2025, new Date('2026-09-20T12:00:00Z'))).toBeNull()
    expect(recapWeekAt('SOCCER', 2026, new Date('2026-09-20T12:00:00Z'))).toBeNull()
  })
})
