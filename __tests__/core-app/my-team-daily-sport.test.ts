// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * My Team for NBA / NHL / MLB (lib/core-app/myTeamDailySport.ts). Reported on a Fantrax NHL league:
 * every row read "no game found for this week" and the lineup "none of them could be priced", because
 * My Team only read the NFL feeds. The daily-sport outlook the roster screen uses now fills both.
 */

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({
  identity: vi.fn(),
  outlook: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { playerIdentityMap: { findMany: h.identity } } }))
vi.mock('@/lib/projections/dailySportOutlook', () => ({ loadDailySportOutlook: h.outlook }))

import { applyDailySportToLineup, dailyGameContext } from '@/lib/core-app/myTeamDailySport'
import type { LineupPlayer } from '@/lib/core-app/myTeam'
import { kickoffText } from '@/lib/core-app/kickoffText'

const row = (id: string, team: string, extra: Partial<LineupPlayer> = {}): LineupPlayer =>
  ({
    sleeperId: id, name: id, position: 'C', team, sport: 'NHL', imageUrl: null,
    gameContext: null, kickoff: null, preseason: false, venue: null, injuryStatus: null, ruledOut: false,
    projectedPoints: null, afProjectedPoints: null, indoors: null, weather: null, market: null, onBye: false,
    ...extra,
  }) as LineupPlayer

const weekly = (byKey: Record<string, { projectedPoints: number | null; periodGames: number | null }>) => ({
  byKey: new Map(Object.entries(byKey).map(([k, v]) => [k, { perGame: 1, recentGames: 5, seasonPoints: null, positionRank: null, ...v }])),
  period: { kind: 'week', season: 2026, week: 4, day: null },
  label: 'AF',
})

const LEAGUE = { sport: 'NHL', season: 2026, settings: { scoring: 'points' }, platform: 'fantrax' }

beforeEach(() => {
  h.identity.mockReset().mockResolvedValue([])
  h.outlook.mockReset()
})

describe('applyDailySportToLineup', () => {
  it('prices an NHL lineup and gives each row its games, under the league\'s own scoring', async () => {
    h.outlook.mockResolvedValue(weekly({ fx1: { projectedPoints: 11.5, periodGames: 3 }, fx2: { projectedPoints: 6, periodGames: 0 } }))
    const m = new Map([['fx1', row('fx1', 'NJ')], ['fx2', row('fx2', 'NYR')]])
    await applyDailySportToLineup(m, LEAGUE)
    expect(m.get('fx1')).toMatchObject({ afProjectedPoints: 11.5, gameContext: '3 games this week' })
    expect(m.get('fx2')).toMatchObject({ afProjectedPoints: 6, gameContext: 'no games this week' })
    // The league's own settings reach the scorer.
    expect(h.outlook).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      league: { sport: 'NHL', season: 2026, settings: LEAGUE.settings },
    }))
  })

  it('Fantrax: looks players up by the identity their Fantrax id is linked to', async () => {
    h.identity.mockResolvedValue([{ id: 'ident-1', fantraxId: 'fx1' }])
    h.outlook.mockResolvedValue(weekly({ fx1: { projectedPoints: 9, periodGames: 2 } }))
    await applyDailySportToLineup(new Map([['fx1', row('fx1', 'NJ')], ['fx9', row('fx9', 'BOS')]]), LEAGUE)
    expect(h.identity).toHaveBeenCalledWith(expect.objectContaining({ where: { sport: 'NHL', fantraxId: { in: ['fx1', 'fx9'] } } }))
    const players = h.outlook.mock.calls[0][1].players
    expect(players).toEqual([
      { key: 'fx1', lookupId: 'ident-1', team: 'NJ', injuryStatus: null },
      // Unlinked: tried under its own id rather than dropped.
      { key: 'fx9', lookupId: 'fx9', team: 'BOS', injuryStatus: null },
    ])
  })

  it('a ruled-out player projects 0, not his healthy rate', async () => {
    h.outlook.mockResolvedValue(weekly({ fx1: { projectedPoints: 11.5, periodGames: 3 } }))
    const m = new Map([['fx1', row('fx1', 'NJ', { ruledOut: true, injuryStatus: 'Out' })]])
    await applyDailySportToLineup(m, LEAGUE)
    expect(m.get('fx1')!.afProjectedPoints).toBe(0)
  })

  it('never overwrites what the existing path already filled', async () => {
    h.outlook.mockResolvedValue(weekly({ a: { projectedPoints: 99, periodGames: 4 } }))
    const m = new Map([['a', row('a', 'NJ', { afProjectedPoints: 7, gameContext: 'NJ vs NYR · Thu 7:00p ET' })]])
    await applyDailySportToLineup(m, LEAGUE)
    expect(h.outlook).not.toHaveBeenCalled()
    expect(m.get('a')).toMatchObject({ afProjectedPoints: 7, gameContext: 'NJ vs NYR · Thu 7:00p ET' })
  })

  it('CONTROL: NFL is left to the NFL path — no outlook read at all', async () => {
    const m = new Map([['a', row('a', 'KC', { sport: 'NFL' })]])
    await applyDailySportToLineup(m, { ...LEAGUE, sport: 'NFL', platform: 'sleeper' })
    expect(h.outlook).not.toHaveBeenCalled()
    expect(h.identity).not.toHaveBeenCalled()
  })

  it('a failed outlook leaves the rows exactly as they were', async () => {
    h.outlook.mockRejectedValue(new Error('db down'))
    const m = new Map([['fx1', row('fx1', 'NJ')]])
    expect(await applyDailySportToLineup(m, LEAGUE)).toBeNull()
    expect(m.get('fx1')).toMatchObject({ afProjectedPoints: null, gameContext: null })
    expect(m.get('fx1')!.noGamePeriod).toBeUndefined()
  })

  // Redraft /core batch B2: the off-day / idle-week badge and the period chip read these.
  it('returns the period it priced, and marks a team with no game in it — weekly → "week"', async () => {
    h.outlook.mockResolvedValue(weekly({ fx1: { projectedPoints: 11.5, periodGames: 3 }, fx2: { projectedPoints: 6, periodGames: 0 }, fx3: { projectedPoints: 4, periodGames: null } }))
    const m = new Map([['fx1', row('fx1', 'NJ')], ['fx2', row('fx2', 'NYR')], ['fx3', row('fx3', 'SEA')]])
    expect(await applyDailySportToLineup(m, LEAGUE)).toEqual({ kind: 'week', day: null, week: 4 })
    expect(m.get('fx1')!.noGamePeriod).toBeUndefined()
    expect(m.get('fx2')!.noGamePeriod).toBe('week')
    // An unknown slate (periodGames null) is NOT an idle week.
    expect(m.get('fx3')!.noGamePeriod).toBeUndefined()
  })

  it('daily lineup: no game today is an off day, said as today rather than "this week"', async () => {
    const daily = weekly({ a: { projectedPoints: 20, periodGames: 0 }, b: { projectedPoints: 30, periodGames: 1 } })
    daily.period = { kind: 'day', season: 2026, week: 4, day: '2026-10-30' } as never
    ;(daily.byKey.get('b') as Record<string, unknown>).opponent = 'NYK'
    ;(daily.byKey.get('b') as Record<string, unknown>).homeAway = 'home'
    ;(daily.byKey.get('a') as Record<string, unknown>).opponent = null
    h.outlook.mockResolvedValue(daily)
    const m = new Map([['a', row('a', 'BOS', { sport: 'NBA' })], ['b', row('b', 'DEN', { sport: 'NBA' })]])
    expect(await applyDailySportToLineup(m, { ...LEAGUE, sport: 'NBA' })).toEqual({ kind: 'day', day: '2026-10-30', week: 4 })
    expect(m.get('a')).toMatchObject({ noGamePeriod: 'day', gameContext: 'no game today' })
    expect(m.get('b')).toMatchObject({ gameContext: 'DEN vs NYK' })
    expect(m.get('b')!.noGamePeriod).toBeUndefined()
  })

  it('CONTROL: NFL returns no period', async () => {
    const m = new Map([['a', row('a', 'KC', { sport: 'NFL' })]])
    expect(await applyDailySportToLineup(m, { ...LEAGUE, sport: 'NFL', platform: 'sleeper' })).toBeNull()
  })
})

describe('dailyGameContext', () => {
  it('daily league: the day\'s opponent, home or away', () => {
    expect(dailyGameContext('BOS', { opponent: 'NYR', homeAway: 'home', periodGames: 1 })).toBe('BOS vs NYR')
    expect(dailyGameContext('BOS', { opponent: 'NYR', homeAway: 'away', periodGames: 1 })).toBe('BOS @ NYR')
  })
  it('reads in Spanish through kickoffText, as the row renders it', () => {
    expect(kickoffText('3 games this week', 'es')).toBe('3 partidos esta semana')
    expect(kickoffText('1 game this week', 'es')).toBe('1 partido esta semana')
    expect(kickoffText('no games this week', 'es')).toBe('sin partidos esta semana')
    expect(kickoffText('3 games this week', 'en')).toBe('3 games this week')
  })

  it('unknown slate stays null rather than a guessed zero', () => {
    expect(dailyGameContext('BOS', { periodGames: null })).toBeNull()
  })

  it('a DAY period counts one day: "no game today", not "no games this week"', () => {
    expect(dailyGameContext('BOS', { opponent: null, periodGames: 0 }, 'day')).toBe('no game today')
    expect(dailyGameContext('BOS', { opponent: null, periodGames: 1 }, 'day')).toBe('game today')
    expect(dailyGameContext('BOS', { periodGames: 0 }, 'week')).toBe('no games this week')
    expect(dailyGameContext('BOS', { periodGames: null }, 'day')).toBeNull()
    expect(kickoffText('no game today', 'es')).toBe('sin partido hoy')
    expect(kickoffText('game today', 'es')).toBe('juega hoy')
  })
})
