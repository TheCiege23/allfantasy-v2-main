/**
 * FAAB at its purchasing power in a league (Guap, 2026-10-11): `leagueFaabValue`, the state it reads
 * (`loadLeagueFaabState`), and the grade path that uses it (`resolveAssets`, `withDatedMarket`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rosters: [] as Array<{ playerData: unknown; faabRemaining: number | null }>,
  week: { ok: true, sportWeek: 6, state: 'live', nextSportWeek: 7 } as Record<string, unknown>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { roster: { findMany: vi.fn(async () => h.rosters) } } }))
vi.mock('@/lib/season-week/seasonWeekService', () => ({ resolveSportWeek: vi.fn(async () => h.week) }))
vi.mock('@/lib/data/players', () => ({ getPlayer: async () => null, searchPlayers: async () => [] }))

import { leagueFaabValue, normalizedFaabValue } from '@/lib/trade-value/faabValue'
import { loadLeagueFaabState, resolveAssets, withDatedMarket } from '@/lib/trade-value-console/leagueTradePricing'
import type { LoadedTradeLeague } from '@/lib/trade-value-console/league-loader'
import type { ValuationContext } from '@/lib/hybrid-valuation'

const team = (faab: number | null, players: string[] = ['p']) => ({ playerData: { players }, faabRemaining: faab })
const LEAGUE = { id: 'L', sport: 'NFL', season: 2026, settings: { playoff_start_week: 15 }, leagueVariant: null } as unknown as LoadedTradeLeague

beforeEach(() => {
  h.rosters = []
  h.week = { ok: true, sportWeek: 6, state: 'live', nextSportWeek: 7 }
})

describe('leagueFaabValue', () => {
  it('is the linear formula in week 1, when every team holds the full budget', () => {
    for (const budget of [100, 200, 1000]) {
      const state = { balances: Array(12).fill(budget), weeksLeft: 14, seasonWeeks: 14 }
      for (const amount of [5, 25, budget]) expect(leagueFaabValue(amount, state)).toBe(normalizedFaabValue(amount, budget))
    }
  })

  it('is worth more a dollar once the league has spent down, and less as the season runs out', () => {
    const fresh = leagueFaabValue(10, { balances: Array(12).fill(100), weeksLeft: 14, seasonWeeks: 14 })!
    const spent = leagueFaabValue(10, { balances: Array(12).fill(20), weeksLeft: 14, seasonWeeks: 14 })!
    const late = leagueFaabValue(10, { balances: Array(12).fill(100), weeksLeft: 2, seasonWeeks: 14 })!
    expect(spent).toBe(fresh * 5)
    expect(late).toBe(Math.round(fresh * 2 / 14))
  })

  it('cannot buy more than every dollar left, is nothing after the season, and says nothing without state', () => {
    expect(leagueFaabValue(500, { balances: [10, 10], weeksLeft: 14, seasonWeeks: 14 })).toBe(1800 * 2)
    expect(leagueFaabValue(10, { balances: [100, 100], weeksLeft: 0, seasonWeeks: 14 })).toBe(0)
    expect(leagueFaabValue(10, null)).toBeNull()
    expect(leagueFaabValue(10, { balances: [], weeksLeft: 5, seasonWeeks: 14 })).toBeNull()
    expect(leagueFaabValue(10, { balances: [0, 0], weeksLeft: 5, seasonWeeks: 14 })).toBeNull()
  })
})

describe('loadLeagueFaabState', () => {
  it('reads every live team’s balance and the weeks FAAB bought now can still be used in', async () => {
    h.rosters = [team(100), team(40), team(null)]
    // Week 6 under way: FAAB bought now first helps in week 7; the regular season is weeks 1–14.
    expect(await loadLeagueFaabState(LEAGUE)).toEqual({ balances: [100, 40], weeksLeft: 8, seasonWeeks: 14 })
    h.week = { ok: true, sportWeek: 6, state: 'upcoming', nextSportWeek: 7 }
    expect((await loadLeagueFaabState(LEAGUE))?.weeksLeft).toBe(9)
  })

  it('leaves out a chopped guillotine roster, whose FAAB will never be spent', async () => {
    h.rosters = [team(100), team(200, [])]
    const out = await loadLeagueFaabState({ ...LEAGUE, leagueVariant: 'guillotine' } as LoadedTradeLeague)
    expect(out?.balances).toEqual([100])
  })

  it('says nothing for another sport, a league with no playoff week, or no week on the schedule', async () => {
    h.rosters = [team(100)]
    expect(await loadLeagueFaabState({ ...LEAGUE, sport: 'NBA' } as unknown as LoadedTradeLeague)).toBeNull()
    expect(await loadLeagueFaabState({ ...LEAGUE, settings: {} } as LoadedTradeLeague)).toBeNull()
    expect(await loadLeagueFaabState({ ...LEAGUE, settings: { playoff_start_week: 0 } } as LoadedTradeLeague)).toBeNull()
    h.week = { ok: false, reason: 'NO_SCHEDULE_ROWS' }
    expect(await loadLeagueFaabState(LEAGUE)).toBeNull()
  })
})

describe('the grade path', () => {
  const nflCtx = { asOfDate: '2026-10-11', isSuperFlex: false, numTeams: 12, fantasyCalcPlayers: [] } as unknown as ValuationContext
  const price = async (faabState: Parameters<typeof resolveAssets>[1]['faabState']) =>
    (await resolveAssets([{ kind: 'faab', amount: 10 }], { effectiveSport: 'NFL', nflCtx, waiverBudget: 100, faabState, dataGaps: [], fcPlayers: [] })).priced[0]!.value

  it('prices FAAB on the league’s state when the chart carries it, and on the budget when it does not', async () => {
    expect(await price({ balances: Array(12).fill(20), weeksLeft: 7, seasonWeeks: 14 })).toBe(450)
    expect(await price(null)).toBe(180)
  })

  it('never prices a past trade on today’s balances: a dated chart drops the state', () => {
    const chart = { faabState: { balances: [20], weeksLeft: 7, seasonWeeks: 14 }, nflCtx } as never
    expect(withDatedMarket(chart, { capturedOn: '2026-09-20', players: [] }).faabState).toBeNull()
  })
})
