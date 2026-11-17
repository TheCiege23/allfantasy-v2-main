/**
 * NBA on the Waivers board from the league's own value board (2026-11-16, re-score item 12): the trade
 * grade's per-game numbers under THIS league's scoring, never AllFantasy's default — and a thin free
 * agent is not offered.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const m = vi.hoisted(() => ({ findMyRoster: vi.fn() }))
vi.mock('@/lib/core-app/myRoster', async (orig) => ({ ...(await orig<typeof import('@/lib/core-app/myRoster')>()), findMyRoster: m.findMyRoster }))

const pool = vi.hoisted(() => ({
  newest: vi.fn(),
  resolve: vi.fn(),
  pool: vi.fn(),
  rows: vi.fn(),
  identity: vi.fn(),
}))
vi.mock('@/lib/waivers/seasonRatePool', async (orig) => ({
  ...(await orig<typeof import('@/lib/waivers/seasonRatePool')>()),
  newestSeasonRateSeason: pool.newest,
  resolveRosterIdsToKeys: pool.resolve,
  loadSeasonRatePool: pool.pool,
  loadSeasonRateRows: pool.rows,
  loadIdentityForKeys: pool.identity,
}))

import { loadSeasonRateWaiverBoard } from '@/lib/waivers/seasonRateWaiverBoard'
import type { LeagueValueBoard } from '@/lib/sport-values/leagueValueBoard'
import type { BoardPlayer, SportPointsContext } from '@/lib/decision-os/trade/sportPointsValue'

/* Season-rate rows: AllFantasy's DEFAULT per-game points. The board below disagrees on purpose. */
const row = (key: string, name: string, position: string, perGame: number) => ({ key, name, position, perGame, components: null })
const ROWS = [row('k-mine-g', 'My Guard', 'PG', 20), row('k-fa-1', 'Wire Star', 'PG', 18), row('k-fa-2', 'Default Darling', 'PG', 40), row('k-fa-thin', 'Hot Rookie', 'PG', 50)]

const bp = (id: string, name: string, perGame: number, sampleGames: number | null): BoardPlayer => ({ id, name, position: 'PG', perGame, sampleGames, aliases: [] })
const BOARD: BoardPlayer[] = [bp('k-mine-g', 'My Guard', 25, 40), bp('k-fa-1', 'Wire Star', 31, 28), bp('k-fa-2', 'Default Darling', 22, 50), bp('k-fa-thin', 'Hot Rookie', 60, 4)]
const ctx = (over: Partial<SportPointsContext> = {}): SportPointsContext => ({
  sport: 'NBA',
  board: BOARD,
  replacementByPosition: new Map(),
  window: { season: 2026, seasonLabel: '2026-27', gamesRemaining: 60 },
  scoringBasis: 'league',
  teams: 2,
  ...over,
})
const onBoard = (c: SportPointsContext = ctx()): (() => Promise<LeagueValueBoard>) => async () => ({ kind: 'ok', sport: 'NBA', ctx: c, byId: new Map(c.board.map((p) => [p.id, p])) })

const prisma = { roster: { findMany: async () => [{ playerData: { players: ['s-mine'] } }, { playerData: { players: ['s-other'] } }] } }
const league = { id: 'L', settings: { roster_positions: ['PG', 'BN'] }, platform: 'sleeper' }
const plan = { sport: 'NBA', kind: 'per_game', basis: 'season_per_game_af_default' } as const

beforeEach(() => {
  vi.clearAllMocks()
  m.findMyRoster.mockResolvedValue({ found: true, playerData: { players: ['s-mine'] } })
  pool.newest.mockResolvedValue(2026)
  pool.resolve.mockResolvedValue(new Map([['s-mine', 'k-mine-g']]))
  pool.pool.mockResolvedValue(ROWS)
  pool.rows.mockResolvedValue(new Map([['k-mine-g', ROWS[0]]]))
  pool.identity.mockResolvedValue(
    new Map(['k-fa-1', 'k-fa-2', 'k-fa-thin'].map((k, i) => [k, { team: 'BOS', ids: { sleeperId: `s-fa-${i}` }, ambiguous: new Set() }])),
  )
})

describe('NBA waivers on the league value board', () => {
  it('ranks by the league board, not AllFantasy default scoring, and shows the games behind each add', async () => {
    const b = await loadSeasonRateWaiverBoard({ prisma: prisma as never, league, plan, userId: 'u', limit: 10, valueBoard: onBoard() })
    expect(b.state).toBe('ok')
    expect(b.basis).toBe('league_value_board')
    // Board: Wire Star 31 beats My Guard 25 (+6). Default Darling is 40 by default scoring but 22 on the board: no gain.
    expect(b.candidates.map((c) => [c.name, c.gain, c.sample])).toEqual([['Wire Star', 6, { kind: 'games', count: 28, thin: false }]])
    expect(b.currentLineupPoints).toBe(25)
    expect(b.notes).toContain(
      "Values from this league's own NBA value board — the one its trade grades use — as per-game fantasy points under this league's own scoring. A season rate, not a projection for this week.",
    )
  })

  it('🛑 a free agent on 4 games is not offered, however hot — the trade grade’s sample bar', async () => {
    const b = await loadSeasonRateWaiverBoard({ prisma: prisma as never, league, plan, userId: 'u', limit: 10, valueBoard: onBoard() })
    expect(b.candidates.some((c) => c.name === 'Hot Rookie')).toBe(false)
  })

  it('a category league says which categories priced it, and leaning on last season is said', async () => {
    const b = await loadSeasonRateWaiverBoard({
      prisma: prisma as never, league, plan, userId: 'u', limit: 10,
      valueBoard: onBoard(ctx({ valueKind: 'categories', categoryList: 'PTS, REB and TO', window: { season: 2026, seasonLabel: '2026-27', gamesRemaining: 70, baselineSeasonLabel: '2025-26' } })),
    })
    expect(b.notes).toContain(
      "Values from this league's own NBA value board — the one its trade grades use — as per-game category score under this league's categories (PTS, REB and TO). A season rate, not a projection for this week.",
    )
    expect(b.notes).toContain('Values still lean on the 2025-26 season while this one has few games; each add shows what its value rests on.')
  })

  it('a board that cannot be built falls back to the default basis, and says why', async () => {
    const b = await loadSeasonRateWaiverBoard({
      prisma: prisma as never, league, plan, userId: 'u', limit: 10,
      valueBoard: async () => ({ kind: 'unavailable', sport: 'NBA', reason: 'Only 40% of the board clears the sample bar.' }),
    })
    expect(b.basis).toBe('season_per_game_af_default')
    // Default scoring: Default Darling 40 and Hot Rookie 50 beat My Guard 20.
    expect(b.candidates.map((c) => c.name)).toEqual(['Hot Rookie', 'Default Darling'])
    expect(b.candidates.every((c) => c.sample === undefined)).toBe(true)
    expect(b.notes).toContain(
      "This league's own NBA value board is not available (Only 40% of the board clears the sample bar), so the wire is priced on the basis below instead.",
    )
  })

  it('a sport not on a board reads exactly as before', async () => {
    const b = await loadSeasonRateWaiverBoard({ prisma: prisma as never, league, plan, userId: 'u', limit: 10, valueBoard: async () => ({ kind: 'not_board_sport' }) })
    expect(b.basis).toBe('season_per_game_af_default')
    expect(b.notes.some((n) => n.includes('value board'))).toBe(false)
  })

  describe('MLB (2026-11-16, second sport)', () => {
    const mlbPlan = { sport: 'MLB', kind: 'per_game', basis: 'season_per_game_af_default' } as const
    const mlbLeague = { id: 'M', settings: { roster_positions: ['SP', 'BN'] }, platform: 'sleeper' }
    const P = (id: string, name: string, position: string, perGame: number, unit: 'at_bats' | 'innings', count: number): BoardPlayer => ({
      id, name, position, perGame, sampleGames: 30, aliases: [],
      sampleBar: { ok: count >= (unit === 'at_bats' ? 100 : 30), has: `${count} ${unit}`, needs: '100 at-bats or 30 innings', unit, count },
    })
    const mlbBoard = (players: BoardPlayer[]): (() => Promise<LeagueValueBoard>) => async () => {
      const c = ctx({ sport: 'MLB', board: players, window: { season: 2027, seasonLabel: '2027', gamesRemaining: 162, scheduleKnown: false } })
      return { kind: 'ok', sport: 'MLB', ctx: c, byId: new Map(players.map((p) => [p.id, p])) }
    }

    beforeEach(() => {
      // The projection files every pitcher `P`; only the board knows starter from reliever.
      pool.pool.mockResolvedValue([row('k-mine-g', 'My Starter', 'P', 1), row('k-fa-1', 'Free Starter', 'P', 1), row('k-fa-2', 'Free Closer', 'P', 1), row('k-fa-thin', 'Call-up', 'P', 1)])
      pool.rows.mockResolvedValue(new Map([['k-mine-g', row('k-mine-g', 'My Starter', 'P', 1)]]))
    })

    it('🛑 a reliever does not fill a starter’s slot — the board files him RP, where the projection said P', async () => {
      const b = await loadSeasonRateWaiverBoard({
        prisma: prisma as never, league: mlbLeague, plan: mlbPlan, userId: 'u', limit: 10,
        valueBoard: mlbBoard([
          P('k-mine-g', 'My Starter', 'SP', 2.0, 'innings', 150),
          P('k-fa-1', 'Free Starter', 'SP', 2.6, 'innings', 120),
          P('k-fa-2', 'Free Closer', 'RP', 3.1, 'innings', 60),
          P('k-fa-thin', 'Call-up', 'SP', 4.0, 'innings', 12),
        ]),
      })
      expect(b.basis).toBe('league_value_board')
      // The closer out-scores both starters per team game, and still cannot take the SP slot.
      expect(b.candidates.map((c) => [c.name, c.position, c.gain])).toEqual([['Free Starter', 'SP', 0.6]])
    })

    it('the sample is innings or at-bats, flagged thin under twice the bar (60 innings, 200 at-bats)', async () => {
      const b = await loadSeasonRateWaiverBoard({
        prisma: prisma as never, league: mlbLeague, plan: mlbPlan, userId: 'u', limit: 10,
        valueBoard: mlbBoard([
          P('k-mine-g', 'My Starter', 'SP', 2.0, 'innings', 150),
          P('k-fa-1', 'Free Starter', 'SP', 2.6, 'innings', 45.1),
        ]),
      })
      expect(b.candidates[0]!.sample).toEqual({ kind: 'innings', count: 45.1, thin: true })
    })
  })
})
