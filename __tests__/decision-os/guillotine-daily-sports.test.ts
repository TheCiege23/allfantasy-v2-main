import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardPlayer, SportPointsContext } from '@/lib/decision-os/trade/sportPointsValue'

const h = vi.hoisted(() => ({
  board: [] as BoardPlayer[],
  identities: [] as Array<{ id: string; rollingInsightsId: string | null; sleeperId: string | null }>,
  rosters: [] as Array<{ playerData: unknown; faabRemaining: number | null }>,
  sport: 'NHL' as 'NHL' | 'MLB',
  season: 2026,
  gamesRemaining: 72,
  valueKind: 'points' as 'points' | 'categories',
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findMany: vi.fn(async () => h.rosters) },
    playerIdentityMap: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => h.identities.filter((i) => where.id.in.includes(i.id))),
    },
  },
}))
vi.mock('@/lib/decision-os/trade/sportPointsContext', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/decision-os/trade/sportPointsContext')>()
  return {
    ...real,
    loadSportPointsBase: vi.fn(async () => {
      const ctx: SportPointsContext = {
        sport: h.sport,
        board: h.board,
        replacementByPosition: new Map(),
        window: { season: h.season, seasonLabel: String(h.season), gamesRemaining: h.gamesRemaining },
        scoringBasis: 'league',
        teams: 12,
        valueKind: h.valueKind,
      }
      return { ok: true, ctx }
    }),
  }
})

import { dailyGuillotineWeeksLeft, loadGuillotineContext } from '@/lib/decision-os/trade/guillotineContext'
import { gradeGuillotineDeal, isGuillotineTradeLeague } from '@/lib/decision-os/trade/guillotineValue'

const NHL_NOW = new Date('2026-09-25T15:00:00Z')
const MLB_NOW = new Date('2027-03-20T15:00:00Z')

function player(id: string, position: string, perGame: number, games = 60) {
  h.board.push({ id, name: id, position, perGame, sampleGames: games, aliases: [id], sourceSeason: 2026 })
  h.identities.push({ id, sleeperId: id, rollingInsightsId: id })
}

beforeEach(() => {
  h.board = []
  h.identities = []
  h.rosters = []
  h.sport = 'NHL'
  h.season = 2026
  h.gamesRemaining = 72
  h.valueKind = 'points'
})

describe('daily-sport Guilly values', () => {
  it('counts NHL and MLB chop weeks on their recorded season calendars', () => {
    expect(dailyGuillotineWeeksLeft('NHL', 2026, NHL_NOW)).toBe(24)
    expect(dailyGuillotineWeeksLeft('MLB', 2027, MLB_NOW)).toBe(26)
    expect(dailyGuillotineWeeksLeft('NHL', 2030, NHL_NOW)).toBeNull()
  })

  it('prices NHL skaters, goalies and FAAB on the Guilly basis', async () => {
    player('center', 'C', 10)
    player('goalie', 'G', 12)
    player('free-center', 'C', 4)
    h.rosters.push({ playerData: { players: ['center'] }, faabRemaining: 100 })
    h.rosters.push({ playerData: { players: ['goalie'] }, faabRemaining: 100 })
    const out = await loadGuillotineContext({ id: 'nhl', sport: 'NHL', settings: { roster_positions: ['C', 'G', 'UTIL', 'BN', 'IR'] }, leagueSize: 2 }, NHL_NOW)
    if (!out.ok) throw new Error(out.reason)
    expect(out.ctx.sport).toBe('NHL')
    expect(out.ctx.gamesPerWeek).toBe(3)
    expect(out.ctx.board.find((p) => p.id === 'center')?.perGame).toBe(30)
    expect(out.ctx.seats.find((s) => s.slot === 'UTIL')?.eligible).not.toContain('G')
    const grade = gradeGuillotineDeal({
      give: [{ kind: 'player', playerId: 'center', name: 'center' }],
      get: [{ kind: 'player', playerId: 'goalie', name: 'goalie' }, { kind: 'faab', amount: 20 }],
      ctx: out.ctx,
    })
    expect(grade.graded).toBe(true)
    if (grade.graded) expect(grade.lines.map((l) => l.valueSource)).toEqual(['guillotine_points', 'guillotine_points', 'guillotine_faab'])
    expect(isGuillotineTradeLeague({ sport: 'NHL', leagueType: 'guillotine' })).toBe(true)
  })

  it('prices MLB pitchers and outfielders with the native lineup, and withholds category scoring', async () => {
    h.sport = 'MLB'
    h.season = 2027
    h.gamesRemaining = 156
    player('starter', 'SP', 8)
    player('outfielder', 'LF', 6)
    player('free-pitcher', 'SP', 2)
    h.rosters.push({ playerData: { players: ['starter'] }, faabRemaining: 100 })
    h.rosters.push({ playerData: { players: ['outfielder'] }, faabRemaining: 100 })
    const league = { id: 'mlb', sport: 'MLB', settings: { roster_positions: ['SP', 'OF', 'P', 'BN', 'IL', 'NA'] }, leagueSize: 2 }
    const out = await loadGuillotineContext(league, MLB_NOW)
    if (!out.ok) throw new Error(out.reason)
    expect(out.ctx.gamesPerWeek).toBe(6)
    expect(out.ctx.board.find((p) => p.id === 'starter')?.perGame).toBe(48)
    expect(out.ctx.seats.find((s) => s.slot === 'OF')?.eligible).toContain('LF')
    expect(out.ctx.seats.map((s) => s.slot)).toEqual(['SP', 'OF', 'P'])
    expect(isGuillotineTradeLeague({ sport: 'MLB', leagueType: 'guillotine' })).toBe(true)
    h.valueKind = 'categories'
    expect(await loadGuillotineContext(league, MLB_NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/categories/) })
  })
})
