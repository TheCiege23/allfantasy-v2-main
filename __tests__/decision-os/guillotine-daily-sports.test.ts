import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardPlayer, SportPointsContext } from '@/lib/decision-os/trade/sportPointsValue'

const h = vi.hoisted(() => ({
  board: [] as BoardPlayer[],
  identities: [] as Array<{ id: string; rollingInsightsId: string | null; sleeperId: string | null }>,
  rosters: [] as Array<{ playerData: unknown; faabRemaining: number | null }>,
  sport: 'NHL' as 'NHL' | 'MLB' | 'NCAAB' | 'SOCCER',
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
import { gradeGuillotineDeal, isGuillotineTradeLeague, survivalCurve } from '@/lib/decision-os/trade/guillotineValue'
import { createGuillotineGrader } from '@/lib/decision-os/trade/guillotineGrader'

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

  /*
   * 🛑 COLLEGE BASKETBALL AND SOCCER GUILLY LEAGUES (owner-approved, 2026-11-26). They had no guillotine rule
   * and were graded as whole-season points leagues — every week of a player counted, though a team expects to
   * be chopped long before the season ends. Every input the daily model needs exists for both: the sport's
   * points board, the league's rosters and FAAB, the regular-season weeks in the Guilly sport config, and the
   * season calendar (NCAAB's recorded opener; soccer's 38 recorded gameweeks). Their starting slots come from
   * the sport's redraft lineup, since neither has a daily redraft roster layout.
   */
  it('counts NCAAB chop weeks from the recorded opener, and soccer chop weeks as GAMEWEEKS, across an international break', () => {
    expect(dailyGuillotineWeeksLeft('NCAAB', 2026, new Date('2026-11-26T15:00:00Z'))).toBe(17)
    expect(dailyGuillotineWeeksLeft('NCAAB', 2026, new Date('2026-10-20T15:00:00Z'))).toBe(20)
    expect(dailyGuillotineWeeksLeft('NCAAB', 2031, new Date('2031-11-26T15:00:00Z'))).toBeNull()
    // Gameweek 12 runs from Friday 20 November: 27 of the 38 are still to play.
    expect(dailyGuillotineWeeksLeft('SOCCER', 2026, new Date('2026-11-26T15:00:00Z'))).toBe(27)
    // 13–19 November holds no game in any of the three leagues: the weeks left are the gameweeks still to start.
    expect(dailyGuillotineWeeksLeft('SOCCER', 2026, new Date('2026-11-16T15:00:00Z'))).toBe(27)
  })

  it.each([
    ['NCAAB', { roster_positions: ['PG', 'C', 'UTIL', 'BN'] }, 'PG', 'C', 17, 'UTIL'],
    ['SOCCER', null, 'MID', 'FWD', 27, 'MID'],
  ] as const)('prices a %s Guilly deal on survival-weighted weeks, not the whole season', async (sport, settings, aPos, bPos, weeks, wideSlot) => {
    h.sport = sport
    h.gamesRemaining = weeks * 2
    player('star', aPos, 10)
    player('other', bPos, 12)
    player('free-a', aPos, 4)
    player('free-b', bPos, 5)
    h.rosters.push({ playerData: { players: ['star'] }, faabRemaining: 100 })
    h.rosters.push({ playerData: { players: ['other'] }, faabRemaining: 100 })
    const league = { id: sport.toLowerCase(), sport, settings, leagueSize: 2 }
    const out = await loadGuillotineContext(league, new Date('2026-11-26T15:00:00Z'))
    if (!out.ok) throw new Error(out.reason)
    expect(out.ctx.sport).toBe(sport)
    expect(out.ctx.weeksLeft).toBe(weeks)
    expect(out.ctx.gamesPerWeek).toBe(2)
    expect(out.ctx.seats.some((s) => s.slot === wideSlot)).toBe(true)
    // Two teams alive: one chop left, so a live team expects (2 − 1) / 2 = half a week more — not `weeks` weeks.
    expect(out.ctx.survival).toEqual(survivalCurve(2, weeks))
    expect(out.ctx.survival[0]).toBe(0.5)
    expect(isGuillotineTradeLeague({ sport, leagueType: 'guillotine' })).toBe(true)
    const grader = createGuillotineGrader({ sport, leagueType: 'guillotine', league }, { loadContext: async () => out })
    expect(grader).not.toBeNull()
    const grade = await grader!.grade([{ kind: 'player', playerId: 'star', name: 'star' }], [{ kind: 'faab', amount: 20 }])
    expect(grade.graded).toBe(true)
    if (!grade.graded) return
    const star = grade.lines.find((l) => l.name === 'star')!
    expect(star.valueSource).toBe('guillotine_points')
    // The wire's one free player at his position goes to one of the two live teams, so the slot's level is 0:
    // 10 a game × 2 games a week = 20 a week, × 0.5 expected weeks = 10 — not 20 × `weeks` for the season.
    expect(out.ctx.replacementBySlot.get(aPos)).toMatchObject({ perGame: 0 })
    expect(star.leagueValue).toBe(10)
    expect(grade.basis).toMatch(/^Guilly value/)
  })

  it('a college basketball Guilly league whose season has no recorded opener is withheld with that reason', async () => {
    h.sport = 'NCAAB'
    h.season = 2031
    player('star', 'PG', 10)
    h.rosters.push({ playerData: { players: ['star'] }, faabRemaining: 100 })
    const out = await loadGuillotineContext({ id: 'ncaab', sport: 'NCAAB', settings: null, leagueSize: 2 }, new Date('2031-12-01T15:00:00Z'))
    expect(out).toMatchObject({ ok: false, reason: expect.stringMatching(/opening date is not on file/) })
  })
})
