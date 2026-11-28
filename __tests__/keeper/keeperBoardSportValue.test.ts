import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The player card's keeper VALUE line outside the NFL (NBA, MLB, NHL, and every other sport on a league
 * value board): his rank on the LEAGUE'S OWN board against the pick his keeper round uses — the Keepers
 * tab's `keeperValue`, through the same `loadKeeperMarketRanks`. The card and the Keepers tab are both
 * run for real here, against one mocked board, so "they agree" is measured rather than assumed.
 */

const m = vi.hoisted(() => ({
  league: vi.fn(),
  leagueFirst: vi.fn(),
  keeps: vi.fn(),
  picks: vi.fn(),
  draft: vi.fn(),
  evaluate: vi.fn(),
  rosterPlayers: vi.fn(),
  chart: vi.fn(),
  board: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: m.league, findFirst: m.leagueFirst },
    keeperRecord: { findMany: m.keeps },
    draftPick: { findMany: m.picks },
    draftSession: { findFirst: m.draft },
    draftFact: { findMany: vi.fn(async () => []) },
    redraftRosterPlayer: { findMany: m.rosterPlayers },
  },
}))
vi.mock('@/lib/subscription/FeatureGateService', () => ({
  FeatureGateService: class {
    evaluateUserFeatureAccess = m.evaluate
  },
}))
vi.mock('@/lib/fantasycalc-db', () => ({ getFantasyCalcValuesDbFirst: m.chart }))
vi.mock('@/lib/sport-values/leagueValueBoard', async (orig) => ({
  ...(await orig<typeof import('@/lib/sport-values/leagueValueBoard')>()),
  loadLeagueValueBoard: m.board,
}))

import { loadPlayerKeeperCardCost } from '@/lib/keeper/keeperCardCost'
import { keeperValueReport } from '@/lib/keeper/keeperValueReport'
import { boardMarketRanks } from '@/lib/keeper/keeperMarketValues'
import type { BoardPlayer, PointsGradedSport, SportPointsContext } from '@/lib/decision-os/trade/sportPointsValue'
import type { LeagueValueBoard } from '@/lib/sport-values/leagueValueBoard'

const p = (id: string, name: string, position: string, perGame: number, aliases: string[] = []): BoardPlayer => ({
  id, name, position, perGame, sampleGames: 30, aliases,
})

/** Five players over a replacement of 20 per game, highest first: values 30, 25, 20, 15, 10 (× games). */
const BOARDS: Record<'NBA' | 'MLB' | 'NHL', { pos: string; players: BoardPlayer[]; him: { sleeperId: string; name: string; rank: number } }> = {
  NBA: {
    pos: 'C',
    players: [
      p('pim-n1', 'Big One', 'C', 50, ['901']),
      p('pim-n2', 'Big Two', 'C', 45, ['902']),
      // Sleeper NBA 1466 is JaVale McGee; Sleeper NFL 1466 is Travis Kelce.
      p('pim-mcgee', 'JaVale McGee', 'C', 40, ['1466']),
      p('pim-n4', 'Big Four', 'C', 35, ['904']),
      p('pim-n5', 'Big Five', 'C', 30, ['905']),
      p('pim-nwire', 'Wire Center', 'C', 20, ['906']),
    ],
    him: { sleeperId: '1466', name: 'JaVale McGee', rank: 3 },
  },
  MLB: {
    pos: 'SP',
    players: [
      p('pim-m1', 'Ace One', 'SP', 50, ['m1']),
      p('pim-m2', 'Ace Two', 'SP', 45, ['m2']),
      p('pim-m3', 'Ace Three', 'SP', 40, ['m3']),
      p('pim-m4', 'Ace Four', 'SP', 35, ['m4']),
      p('pim-m5', 'Ace Five', 'SP', 30, ['m5']),
    ],
    him: { sleeperId: 'm4', name: 'Ace Four', rank: 4 },
  },
  NHL: {
    pos: 'D',
    players: [
      p('pim-h1', 'Rear One', 'D', 50, ['h1']),
      p('pim-h2', 'Rear Two', 'D', 45, ['h2']),
      p('pim-h3', 'Rear Three', 'D', 40, ['h3']),
    ],
    him: { sleeperId: 'h1', name: 'Rear One', rank: 1 },
  },
}

const ctxFor = (sport: PointsGradedSport, pos: string, board: BoardPlayer[], over: Partial<SportPointsContext> = {}): SportPointsContext => ({
  sport,
  board,
  replacementByPosition: new Map([[pos, { name: 'Wire', perGame: 20 }]]),
  window: { season: 2026, seasonLabel: '2026-27', gamesRemaining: 60, baselineSeasonLabel: '2025-26' },
  scoringBasis: 'league',
  teams: 12,
  ...over,
} as SportPointsContext)

const okBoard = (ctx: SportPointsContext): LeagueValueBoard => ({ kind: 'ok', sport: ctx.sport, ctx, byId: new Map(ctx.board.map((x) => [x.id, x])) })

const keeperLeague = (sport: string) => ({
  id: 'L', userId: 'commish', sport, settings: {}, leagueType: 'keeper', leagueSize: 12, scoringPresetId: null,
  keeperCostSystem: 'round_based', keeperRoundPenalty: 1, keeperInflationRate: 1, keeperConflictRule: 'player_chooses',
})

/** Drafted Round 6, league rule 1 round earlier → Round 5, which in 12 teams uses about the #54 pick. */
function setup(sport: string, him: { sleeperId: string; name: string }, position: string) {
  m.league.mockResolvedValue(keeperLeague(sport))
  m.leagueFirst.mockResolvedValue(keeperLeague(sport))
  m.picks.mockResolvedValue([{ playerId: him.sleeperId, playerName: him.name, position, round: 6 }])
  m.rosterPlayers.mockResolvedValue([{ rosterId: 'R', playerId: him.sleeperId, playerName: him.name, position }])
}

const cardFor = (him: { sleeperId: string; name: string }, position: string) =>
  loadPlayerKeeperCardCost({ leagueId: 'L', sleeperId: him.sleeperId, externalId: null, name: him.name, position })
const tabFor = (him: { sleeperId: string }) => keeperValueReport('L', [{ playerId: him.sleeperId, rosterId: 'R', projectedCostRound: 5 }])

beforeEach(() => {
  vi.clearAllMocks()
  m.evaluate.mockResolvedValue({ allowed: true })
  m.keeps.mockResolvedValue([])
  m.draft.mockResolvedValue({ rounds: 15 })
  // The NFL chart: Sleeper NFL 1466 is Travis Kelce at #5. An NBA card must never be priced on it.
  m.chart.mockResolvedValue([{ player: { sleeperId: '1466', name: 'Travis Kelce', position: 'TE' }, overallRank: 5 }])
})

describe('keeper value line on a league value board — NBA, MLB, NHL', () => {
  for (const sport of ['NBA', 'MLB', 'NHL'] as const) {
    it(`${sport}: a ranked player gets the value line, and the Keepers tab says the same number`, async () => {
      const { pos, players, him } = BOARDS[sport]
      m.board.mockResolvedValue(okBoard(ctxFor(sport, pos, players)))
      setup(sport, him, pos)

      const card = await cardFor(him, pos)
      expect(card).toMatchObject({ costRound: 5, headline: 'Keeper cost: Round 5' })
      expect(card?.value).toMatchObject({ marketRank: him.rank, pickSlot: 54, surplus: 54 - him.rank })
      expect(card?.value?.sentence).toBe(`Market rank #${him.rank}; a Round 5 keeper uses about the #54 pick — ${54 - him.rank} picks of value.`)

      const tab = await tabFor(him)
      expect(tab).toEqual({ available: true, values: { [him.sleeperId]: { marketRank: him.rank, pickSlot: 54, surplus: 54 - him.rank } } })
      const { sentence: _s, ...cardValue } = card!.value!
      expect(cardValue).toEqual(tab.available ? tab.values[him.sleeperId] : null)

      expect(m.board).toHaveBeenCalledWith('L', undefined)
      expect(m.chart).not.toHaveBeenCalled()
    })
  }

  it('an NBA player whose Sleeper id collides with an NFL player (1466 McGee / Kelce) is priced on the NBA board', async () => {
    const { pos, players, him } = BOARDS.NBA
    m.board.mockResolvedValue(okBoard(ctxFor('NBA', pos, players)))
    setup('NBA', him, pos)
    const card = await cardFor(him, pos)
    // NBA board rank #3 (54 − 3 = 51), never Kelce's NFL #5 (which would read 49).
    expect(card?.value).toMatchObject({ marketRank: 3, surplus: 51 })
    expect(m.chart).not.toHaveBeenCalled()
  })

  it('[control] the NFL keeps FantasyCalc: Sleeper NFL 1466 is Kelce at #5', async () => {
    setup('NFL', { sleeperId: '1466', name: 'Travis Kelce' }, 'TE')
    const card = await cardFor({ sleeperId: '1466', name: 'Travis Kelce' }, 'TE')
    expect(card?.value).toMatchObject({ marketRank: 5, surplus: 49 })
    expect(m.board).not.toHaveBeenCalled()
  })
})

describe('no board, or no rank → the cost line alone', () => {
  it('a sport with no value board (NCAAF): cost line, no value, nothing priced', async () => {
    setup('NCAAF', { sleeperId: '777', name: 'Campus Back' }, 'RB')
    const card = await cardFor({ sleeperId: '777', name: 'Campus Back' }, 'RB')
    expect(card).toMatchObject({ costRound: 5, headline: 'Keeper cost: Round 5', value: null })
    expect(m.board).not.toHaveBeenCalled()
    expect(m.chart).not.toHaveBeenCalled()
    expect(await tabFor({ sleeperId: '777' })).toEqual({ available: false, reason: 'no_market_values' })
  })

  it('a board sport whose board cannot be built: cost line only', async () => {
    m.board.mockResolvedValue({ kind: 'unavailable', sport: 'NBA', reason: 'No projections yet.' })
    setup('NBA', BOARDS.NBA.him, 'C')
    expect(await cardFor(BOARDS.NBA.him, 'C')).toMatchObject({ costRound: 5, value: null })
    expect(m.chart).not.toHaveBeenCalled()
  })

  it('a player not on the board, or at replacement level, has no rank: cost line only (the tab leaves him out too)', async () => {
    const { pos, players } = BOARDS.NBA
    m.board.mockResolvedValue(okBoard(ctxFor('NBA', pos, players)))
    for (const him of [{ sleeperId: '5555', name: 'Not On Board' }, { sleeperId: '906', name: 'Wire Center' }]) {
      setup('NBA', him, pos)
      expect(await cardFor(him, pos)).toMatchObject({ costRound: 5, headline: 'Keeper cost: Round 5', value: null })
      expect(await tabFor(him)).toEqual({ available: true, values: {} })
    }
  })
})

describe('boardMarketRanks', () => {
  const { pos, players } = BOARDS.NBA
  it('orders by the board price, shares a rank on a tie, and resolves by alias, own id or name', () => {
    const tie = [...players, p('pim-tie', 'Twin Big', 'C', 45, ['907'])]
    const rankOf = boardMarketRanks(okBoard(ctxFor('NBA', pos, tie)))!
    expect(rankOf({ playerId: '901', name: null, position: null })).toBe(1)
    expect(rankOf({ playerId: '902', name: null, position: null })).toBe(2)
    expect(rankOf({ playerId: '907', name: null, position: null })).toBe(2)
    expect(rankOf({ playerId: 'pim-mcgee', name: null, position: null })).toBe(4)
    expect(rankOf({ playerId: 'nope', name: 'Big Five', position: 'C' })).toBe(6)
    expect(rankOf({ playerId: '906', name: null, position: null })).toBeNull()
  })
  it('no ranks when the board is not ok, or the season has no games left', () => {
    expect(boardMarketRanks({ kind: 'not_board_sport' })).toBeNull()
    expect(boardMarketRanks({ kind: 'unavailable', sport: 'NBA', reason: 'x' })).toBeNull()
    expect(boardMarketRanks(okBoard(ctxFor('NBA', pos, players, { window: { season: 2026, seasonLabel: '2026-27', gamesRemaining: 0 } as SportPointsContext['window'] })))).toBeNull()
  })
})
