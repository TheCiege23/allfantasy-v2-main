/**
 * Offseason pick pricing (Guap, 2026-10-12: "go ahead with offseason pick pricing"). Once a season and its
 * playoffs are over, or the league has set its rookie draft order, a pick's slot is KNOWN — the projection
 * stops simulating and the price reads the slot.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const leagueTeams = vi.fn()
const draftSession = vi.fn()
const dynastySeason = vi.fn()
const seasonResults = vi.fn()
const resolveSportWeek = vi.fn()
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: (...a: unknown[]) => leagueTeams(...a) },
    draftSession: { findFirst: (...a: unknown[]) => draftSession(...a) },
    leagueDynastySeason: { findUnique: (...a: unknown[]) => dynastySeason(...a) },
    seasonResult: { findMany: (...a: unknown[]) => seasonResults(...a) },
  },
}))
vi.mock('@/lib/season-week/seasonWeekService', () => ({ resolveSportWeek: (...a: unknown[]) => resolveSportWeek(...a) }))

import type { FantasyCalcPlayer } from '@/lib/fantasycalc'
import { loadPickSlotProjection, priceLeagueTradePick } from '@/lib/trade-value-console/leagueTradePricing'
import { draftOrderFromFinish, projectionFromOrder, type StandingsTeam } from '@/lib/trade-value/pickSlotProjection'

/** Twelve teams' final records: roster "1" worst … "12" best. */
const FINAL: StandingsTeam[] = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), wins: i, losses: 13 - i, ties: 0, pointsFor: 1300 + i * 25 }))

/** A decided 6-team Sleeper bracket as the history sync stores it: seeds 12,11 (byes), 10,9,8,7. */
function storedBracket(): unknown {
  const g = (round: number, matchup: number, team1: number, team2: number, winner: number, placement: number | null = null) =>
    ({ round, matchup, team1, team2, winner, loser: winner === team1 ? team2 : team1, placement })
  return {
    winnersBracket: [
      g(1, 1, 9, 8, 8), // 4 v 5 — the 5 seed wins
      g(1, 2, 10, 7, 10), // 3 v 6
      g(2, 3, 12, 8, 12), // 1 v 5
      g(2, 4, 11, 10, 10), // 2 v 3 — the 3 seed wins
      g(2, 5, 9, 7, 7, 5), // 5th-place game: 7 takes 5th
      g(3, 6, 12, 10, 10, 1), // final: the 3 seed is champion
      g(3, 7, 8, 11, 11, 3), // 3rd-place game
    ],
  }
}
const row = (name: string, value: number) => ({ player: { name, position: 'PICK' }, value }) as FantasyCalcPlayer

describe('draftOrderFromFinish', () => {
  const playoffs = {
    teams: new Set(['12', '11', '10', '9', '8', '7']),
    placeByTeam: new Map([['10', 1], ['12', 2], ['11', 3], ['8', 4], ['7', 5], ['9', 6]]),
  }
  it('non-playoff teams in reverse standings, then playoff teams from worst place to champion', () => {
    expect(draftOrderFromFinish(FINAL, playoffs)).toEqual(['1', '2', '3', '4', '5', '6', '9', '7', '8', '11', '12', '10'])
  })
  it('a bracket team with no decided place: not known yet', () => {
    const undecided = { teams: playoffs.teams, placeByTeam: new Map([...playoffs.placeByTeam].filter(([id]) => id !== '9')) }
    expect(draftOrderFromFinish(FINAL, undecided)).toBeNull()
  })
})

describe('projectionFromOrder', () => {
  const order = FINAL.map((t) => t.id)
  it('a set draft order is taken as it stands', () => {
    const p = projectionFromOrder({ order, source: 'draft_order_set', draftYear: 2027 })!
    expect(p.oddsByTeam.get('1')).toEqual({ early: 1, mid: 0, late: 0 })
    expect(p.slotByTeam!.get('12')).toBe(12)
  })
  it('an order read off the finished season keeps the rule’s doubt', () => {
    const p = projectionFromOrder({ order, source: 'final_standings', draftYear: 2027 })!
    expect(p.oddsByTeam.get('1')!.early).toBeCloseTo(1 - 0.2 + 0.2 / 3, 10)
    expect(p.oddsByTeam.get('1')!.late).toBeCloseTo(0.2 / 3, 10)
  })
})

describe('loadPickSlotProjection between seasons and after the season', () => {
  beforeEach(() => {
    for (const f of [leagueTeams, draftSession, dynastySeason, seasonResults, resolveSportWeek]) f.mockReset()
    resolveSportWeek.mockResolvedValue({ ok: true, sportWeek: 1, seasonType: 'post', state: 'played', nextSportWeek: 2 })
  })

  it('a renewed league (pre_draft) uses the draft order the commissioner set', async () => {
    draftSession.mockResolvedValue({ slotOrder: FINAL.map((t, i) => ({ slot: i + 1, rosterId: t.id, displayName: `M${i}` })) })
    const p = await loadPickSlotProjection({ leagueId: 'L', settings: { playoff_week_start: 15 }, season: 2027, status: 'pre_draft' })
    expect(draftSession).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ leagueId: 'L', status: { in: ['pre_draft', 'in_progress'] }, rounds: { lte: 7 } }) }))
    expect(p).toMatchObject({ draftYear: 2027, orderSource: 'draft_order_set' })
    expect(p!.slotByTeam!.get('1')).toBe(1)
  })

  it('🛑 an order with an unnamed slot is not an order the commissioner set: last season decides', async () => {
    draftSession.mockResolvedValue({ slotOrder: FINAL.map((t, i) => ({ slot: i + 1, rosterId: t.id, displayName: i === 3 ? '' : `M${i}` })) })
    seasonResults.mockResolvedValue(FINAL.map((t) => ({ rosterId: t.id, wins: t.wins, losses: t.losses, pointsFor: t.pointsFor })))
    dynastySeason.mockResolvedValue({ metadata: { playoffStructure: storedBracket() } })
    const p = await loadPickSlotProjection({ leagueId: 'L', settings: {}, season: 2027, status: 'pre_draft' })
    expect(seasonResults).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'L', season: '2026' } }))
    expect(p).toMatchObject({ draftYear: 2027, orderSource: 'final_standings' })
    // The 3 seed won the title: it picks last, though its record ranked 10th.
    expect(p!.slotByTeam!.get('10')).toBe(12)
    expect(p!.slotByTeam!.get('12')).toBe(11)
  })

  it('a renewed league with neither: no projection — 0-0 standings say nothing about this draft', async () => {
    draftSession.mockResolvedValue(null)
    seasonResults.mockResolvedValue([])
    dynastySeason.mockResolvedValue(null)
    expect(await loadPickSlotProjection({ leagueId: 'L', settings: { playoff_week_start: 15 }, season: 2027, status: 'pre_draft' })).toBeNull()
    expect(leagueTeams).not.toHaveBeenCalled()
  })

  it('the regular season over and the playoffs decided: the finished order, for next year’s draft', async () => {
    leagueTeams.mockResolvedValue(FINAL.map((t) => ({ externalId: t.id, wins: t.wins, losses: t.losses, ties: 0, pointsFor: t.pointsFor })))
    dynastySeason.mockResolvedValue({ metadata: { playoffStructure: storedBracket() } })
    const p = await loadPickSlotProjection({ leagueId: 'L', settings: { playoff_week_start: 15, playoff_teams: 6 }, season: 2026, status: 'complete' })
    expect(dynastySeason).toHaveBeenCalledWith(expect.objectContaining({ where: { uniq_league_dynasty_season_league_season: { leagueId: 'L', season: 2026 } } }))
    expect(p).toMatchObject({ draftYear: 2027, orderSource: 'final_standings' })
    expect(p!.slotByTeam!.get('10')).toBe(12)
  })

  it('the playoffs still being played: the bracket is simulated, as before', async () => {
    leagueTeams.mockResolvedValue(FINAL.map((t) => ({ externalId: t.id, wins: t.wins, losses: t.losses, ties: 0, pointsFor: t.pointsFor })))
    const live = storedBracket() as { winnersBracket: Array<Record<string, unknown>> }
    live.winnersBracket = live.winnersBracket.map((g) => (Number(g.round) === 3 ? { ...g, winner: null, loser: null } : g))
    dynastySeason.mockResolvedValue({ metadata: { playoffStructure: live } })
    resolveSportWeek.mockResolvedValue({ ok: true, sportWeek: 16, seasonType: 'regular', state: 'live', nextSportWeek: 17 })
    const p = await loadPickSlotProjection({ leagueId: 'L', settings: { playoff_week_start: 15, playoff_teams: 6 }, season: 2026, status: 'in_season' })
    expect(p!.orderSource).toBeUndefined()
    expect(p!.slotByTeam).toBeUndefined()
  })

  it('a read that fails is "not known", never a lost projection', async () => {
    leagueTeams.mockResolvedValue(FINAL.map((t) => ({ externalId: t.id, wins: t.wins, losses: t.losses, ties: 0, pointsFor: t.pointsFor })))
    dynastySeason.mockRejectedValue(new Error('db down'))
    const p = await loadPickSlotProjection({ leagueId: 'L', settings: { playoff_week_start: 15, playoff_teams: 6 }, season: 2026, status: 'complete' })
    expect(p).not.toBeNull()
    expect(p!.orderSource).toBeUndefined()
  })
})

describe('pricing a known slot', () => {
  const nflCtx = (fc: FantasyCalcPlayer[]) => ({ asOfDate: '2027-02-01', isSuperFlex: false, numTeams: 12, fantasyCalcPlayers: fc })
  const order = FINAL.map((t) => t.id)
  /** The board after the season: the next draft by slot. */
  const SLOTS = [...Array.from({ length: 12 }, (_, i) => row(`2027 Pick 1.${String(i + 1).padStart(2, '0')}`, 6000 - i * 300))]
  const roundAvg = Math.round(SLOTS.reduce((s, r) => s + (r.value as number), 0) / SLOTS.length)

  it('the draft order the league set: that slot’s row', async () => {
    const pickSlots = projectionFromOrder({ order, source: 'draft_order_set', draftYear: 2027 })
    const r = await priceLeagueTradePick({ year: 2027, round: 1, originalRosterId: '2' }, { fcPlayers: SLOTS, nflCtx: nflCtx(SLOTS), pickSlots })
    expect(r.priced.value).toBe(5700)
    expect(r.projection).toBe('2027 1st pick 1.02, the draft order the league set')
  })

  it('last season’s finish: the slot’s row, with the rule’s doubt on the round’s price', async () => {
    const pickSlots = projectionFromOrder({ order, source: 'final_standings', draftYear: 2027 })
    const r = await priceLeagueTradePick({ year: 2027, round: 1, originalRosterId: '2' }, { fcPlayers: SLOTS, nflCtx: nflCtx(SLOTS), pickSlots })
    expect(r.priced.value).toBe(Math.round(0.8 * 5700 + 0.2 * roundAvg))
    expect(r.projection).toBe('2027 1st pick 1.02, by last season’s finish and playoffs')
  })

  it('a board that prices the draft by tier only: the known slot\'s third, named', async () => {
    const TIERS = [row('2027 1st', 2764), row('2027 1st (Early)', 4565), row('2027 1st (Mid)', 3006), row('2027 1st (Late)', 2328)]
    const pickSlots = projectionFromOrder({ order, source: 'draft_order_set', draftYear: 2027 })
    const r = await priceLeagueTradePick({ year: 2027, round: 1, originalRosterId: '2' }, { fcPlayers: TIERS, nflCtx: nflCtx(TIERS), pickSlots })
    expect(r.priced.value).toBe(4565)
    expect(r.projection).toBe('2027 1st pick 1.02, the draft order the league set (early (100%))')
  })

  it('[control] a projected (not known) pick on a slot-only board is priced from the board’s own thirds', async () => {
    // Thirds of the slot rows: early 5,550 · mid 4,350 · late 3,150; round 4,350. Odds .7/.2/.1 → certainty .55.
    const odds = new Map([['2', { early: 0.7, mid: 0.2, late: 0.1 }]])
    const r = await priceLeagueTradePick({ year: 2027, round: 1, originalRosterId: '2' }, { fcPlayers: SLOTS, nflCtx: nflCtx(SLOTS), pickSlots: { draftYear: 2027, oddsByTeam: odds, weeksLeft: 3 } })
    expect(roundAvg).toBe(4350)
    expect(r.priced.value).toBe(Math.round(4350 + 0.55 * (0.7 * 5550 + 0.2 * 4350 + 0.1 * 3150 - 4350)))
    expect(r.projection).toBe('2027 1st projected early (70%)')
  })
})
