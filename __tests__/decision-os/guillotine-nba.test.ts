/**
 * NBA guillotine trades (`lib/decision-os/trade/guillotineContext.ts` NBA branch): recognised as a guillotine
 * league, weeks left counted on the NBA period calendar the native chop runs on, the per-GAME points board
 * put on the WEEK, the NBA lineup's slots, the points grade's ten-game bar for a replacement level, and the
 * rosters matched in ONE id space. The points board itself is stubbed — `sportPointsContext` is its own suite.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardPlayer, SportPointsContext } from '@/lib/decision-os/trade/sportPointsValue'

const h = vi.hoisted(() => ({
  board: [] as BoardPlayer[],
  identities: [] as Array<{ id: string; rollingInsightsId: string | null; sleeperId: string | null }>,
  rosters: [] as Array<{ playerData: unknown; faabRemaining: number | null }>,
  season: 2026,
  gamesRemaining: 72,
  valueKind: 'points' as 'points' | 'categories',
  baseRefusal: null as string | null,
  baseCalls: [] as unknown[],
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
    loadSportPointsBase: vi.fn(async (args: unknown) => {
      h.baseCalls.push(args)
      if (h.baseRefusal) return { ok: false, reason: h.baseRefusal }
      const ctx: SportPointsContext = {
        sport: 'NBA',
        board: h.board,
        replacementByPosition: new Map(),
        window: { season: h.season, seasonLabel: '2026-27', gamesRemaining: h.gamesRemaining },
        scoringBasis: 'league',
        teams: 12,
        valueKind: h.valueKind,
      }
      return { ok: true, ctx }
    }),
  }
})

import { loadGuillotineContext, nbaGuillotineWeeksLeft } from '@/lib/decision-os/trade/guillotineContext'
import { createGuillotineGrader } from '@/lib/decision-os/trade/guillotineGrader'
import { gradeGuillotineDeal, isGuillotineTradeLeague } from '@/lib/decision-os/trade/guillotineValue'

const SETTINGS = { roster_positions: ['PG', 'G', 'UTIL', 'BN', 'BN', 'IL'], scoring_settings: { pts: 1 } }
const league = { id: 'NBA-G', settings: SETTINGS, leagueSize: 12, sport: 'NBA' }
const PRESEASON = new Date('2026-10-17T15:00:00Z')

/** A board player, per GAME, with his identity row (Sleeper and Rolling Insights ids). */
function player(id: string, name: string, position: string, perGame: number, sleeper: string, ri: string, games = 60) {
  h.board.push({ id, name, position, perGame, sampleGames: games, aliases: [ri, sleeper], sourceSeason: 2025 })
  h.identities.push({ id, sleeperId: sleeper, rollingInsightsId: ri })
}
const roster = (ids: string[], faab: number | null) => h.rosters.push({ playerData: { players: ids, starters: [] }, faabRemaining: faab })

beforeEach(() => {
  h.board = []
  h.identities = []
  h.rosters = []
  h.season = 2026
  h.gamesRemaining = 72
  h.valueKind = 'points'
  h.baseRefusal = null
  h.baseCalls = []
})

describe('isGuillotineTradeLeague', () => {
  it('takes an NBA Guilly league, by type or variant — not another sport, and not survivor_guillotine', () => {
    expect(isGuillotineTradeLeague({ sport: 'NBA', leagueType: 'guillotine' })).toBe(true)
    expect(isGuillotineTradeLeague({ sport: 'nba', leagueType: 'redraft', leagueVariant: 'guillotine' })).toBe(true)
    expect(isGuillotineTradeLeague({ sport: 'NFL', leagueType: 'guillotine' })).toBe(true)
    expect(isGuillotineTradeLeague({ sport: 'NHL', leagueType: 'guillotine' })).toBe(false)
    expect(isGuillotineTradeLeague({ sport: 'NBA', leagueType: 'survivor_guillotine' })).toBe(false)
    expect(isGuillotineTradeLeague({ sport: 'NBA', leagueType: 'redraft' })).toBe(false)
  })
})

describe('nbaGuillotineWeeksLeft — the NBA period calendar, 24 weeks, the week in progress counted', () => {
  it('counts all 24 before the 2026-27 opener (20 Oct 2026, Eastern) and one fewer per seven Eastern days', () => {
    expect(nbaGuillotineWeeksLeft(2026, PRESEASON)).toBe(24)
    // 00:30Z on the 20th is still the 19th in New York: before the opener.
    expect(nbaGuillotineWeeksLeft(2026, new Date('2026-10-20T00:30:00Z'))).toBe(24)
    expect(nbaGuillotineWeeksLeft(2026, new Date('2026-10-21T18:00:00Z'))).toBe(24) // week 1 in progress
    expect(nbaGuillotineWeeksLeft(2026, new Date('2026-10-28T18:00:00Z'))).toBe(23) // week 2
    expect(nbaGuillotineWeeksLeft(2026, new Date('2027-03-31T18:00:00Z'))).toBe(1) // week 24
    expect(nbaGuillotineWeeksLeft(2026, new Date('2027-04-20T18:00:00Z'))).toBe(0)
  })

  it('is null for a season whose opener is not recorded — never a guessed anchor', () => {
    expect(nbaGuillotineWeeksLeft(2031, PRESEASON)).toBeNull()
  })
})

describe('loadGuillotineContext — NBA', () => {
  function standardLeague() {
    // Sleeper ids 1xx; Rolling Insights ids that are OTHER players' Sleeper ids (the NFL's Bijan clash).
    player('star', 'Star Guard', 'PG', 50, '101', '102')
    player('wing', 'Rostered Wing', 'SF', 30, '102', '101')
    player('fa1', 'Free One', 'SG', 25, '201', '901')
    player('fa2', 'Free Two', 'PG', 22, '202', '902')
    player('thin', 'Thin Sample', 'PG', 40, '203', '903', 4) // 4 games: never sets the replacement level
    player('fa3', 'Free Three', 'C', 20, '204', '904')
    player('fa4', 'Free Four', 'PF', 10, '205', '905')
    roster(['101'], 100)
    roster(['102'], 60)
    roster([], 100) // chopped
  }

  it('puts the per-game board on the week, counts 24 weeks preseason, and reads the NBA lineup', async () => {
    standardLeague()
    const out = await loadGuillotineContext(league, PRESEASON)
    if (!out.ok) throw new Error(out.reason)
    const { ctx } = out
    expect(ctx.sport).toBe('NBA')
    expect(ctx.weeksLeft).toBe(24)
    expect(ctx.gamesPerWeek).toBe(3) // 72 games ÷ 24 weeks
    expect(ctx.board.find((p) => p.id === 'star')?.perGame).toBe(150)
    expect(ctx.seats.map((s) => s.slot)).toEqual(['PG', 'G', 'UTIL'])
    expect(ctx.seats.find((s) => s.slot === 'G')?.eligible).toEqual(['PG', 'SG'])
    expect(ctx.lineupLabel).toBe('1 PG, 1 G, 1 UTIL')
    expect(ctx.teamsAlive).toBe(2)
    expect(ctx.liveFaab).toBe(160)
    expect(ctx.minReplacementGames).toBe(10)
    expect(h.baseCalls[0]).toMatchObject({ sport: 'NBA', league: { id: 'NBA-G', leagueType: 'guillotine' } })
  })

  it('matches rosters in one id space, so a Rolling Insights id that is someone else’s Sleeper id hides nobody', async () => {
    standardLeague()
    const out = await loadGuillotineContext(league, PRESEASON)
    if (!out.ok) throw new Error(out.reason)
    // Both rostered stars stay off the wire. Two live teams: the third eligible free agent sets the level,
    // and the four-game line is skipped. UTIL's wire (by week): Free One 75, Free Two 66, Free Three 60.
    expect(out.ctx.replacementBySlot.get('UTIL')).toEqual({ name: 'Free Three', perGame: 60 })
    // G takes PG/SG: Free One, Free Two, then nobody with ten games — the level is zero.
    expect(out.ctx.replacementBySlot.get('G')?.perGame).toBe(0)
  })

  it('grades an NBA guillotine deal on the guillotine basis — players over the free level, FAAB at its purchasing power', async () => {
    standardLeague()
    const grader = createGuillotineGrader(
      { sport: 'NBA', leagueType: 'guillotine', league: { id: 'NBA-G', settings: SETTINGS, leagueSize: 12 } },
      { loadContext: (l) => loadGuillotineContext(l, PRESEASON) },
    )
    expect(grader).not.toBeNull()
    const view = await grader!.grade(
      [{ kind: 'player', name: 'Rostered Wing', playerId: '102' }],
      [{ kind: 'player', name: 'Star Guard', playerId: '101' }, { kind: 'faab', amount: 40 }],
    )
    if (!view.graded) throw new Error(view.reason)
    expect(view.lines.map((l) => [l.name, l.valueSource])).toEqual([
      ['Rostered Wing', 'guillotine_points'],
      ['Star Guard', 'guillotine_points'],
      ['$40 FAAB', 'guillotine_faab'],
    ])
    expect(view.basis).toMatch(/^Guilly value/)
    expect(view.basis).toMatch(/An NBA week is about 3 games a team/)
  })

  it('withholds a player whose NBA projection rests on too few games, as the NBA points grade does', async () => {
    standardLeague()
    const out = await loadGuillotineContext(league, PRESEASON)
    if (!out.ok) throw new Error(out.reason)
    const view = gradeGuillotineDeal({
      give: [{ kind: 'player', name: 'Thin Sample', playerId: '203' }],
      get: [{ kind: 'player', name: 'Free One', playerId: '201' }],
      ctx: out.ctx,
    })
    expect(view).toMatchObject({ graded: false, reason: expect.stringMatching(/rests on 4 games/) })
  })

  it('refuses a category league, a season with no recorded opener, and passes the points board’s own refusal through', async () => {
    standardLeague()
    h.valueKind = 'categories'
    expect(await loadGuillotineContext(league, PRESEASON)).toMatchObject({ ok: false, reason: expect.stringMatching(/categories/) })
    h.valueKind = 'points'
    h.season = 2031
    expect(await loadGuillotineContext(league, PRESEASON)).toMatchObject({ ok: false, reason: expect.stringMatching(/opening date is not on file/) })
    h.season = 2026
    h.baseRefusal = 'No NBA projections are on file, so this deal cannot be graded yet.'
    expect(await loadGuillotineContext(league, PRESEASON)).toEqual({ ok: false, reason: h.baseRefusal })
  })

  it('refuses a lineup slot that takes no NBA position rather than dropping the seat', async () => {
    standardLeague()
    const out = await loadGuillotineContext({ ...league, settings: { roster_positions: ['PG', 'QB', 'BN'] } }, PRESEASON)
    expect(out).toMatchObject({ ok: false, reason: expect.stringMatching(/lineup/) })
  })
})
