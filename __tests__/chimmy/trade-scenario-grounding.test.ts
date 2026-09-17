import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildTradeScenario,
  looksLikeDescribedTrade,
  renderTradeScenarioBlock,
  type TradeScenarioDeps,
} from '@/lib/chimmy/tradeScenarioGrounding'
import type { CanonicalTradeEvaluation } from '@/lib/decision-os/trade/canonicalEvaluator'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'

/**
 * Chimmy item 8: a described trade, resolved against the league's real rosters and evaluated by
 * the canonical trade evaluator. Everything below the resolver is injected, so these pin the
 * RESOLUTION — which roster gives, which receives, and when to refuse.
 */

const team = (teamId: string, managerUserId: string, displayName: string) =>
  ({ teamId, managerUserId, displayName, ownerName: `${displayName} owner` }) as unknown as CanonicalWorld['teams'][number]
const roster = (rosterId: string, teamId: string, playerIds: string[]) =>
  ({ rosterId, teamId, playerIds }) as unknown as CanonicalWorld['rosters'][number]

const WORLD = {
  league: { sport: 'NFL', season: 2026 },
  teams: [team('t1', 'viewer-1', 'My Team'), team('t2', 'rival-2', 'Rival'), team('t3', 'other-3', 'Third')],
  rosters: [
    roster('r1', 't1', ['p-bijan', 'p-allen-qb', 'p-mhj-mine']),
    roster('r2', 't2', ['p-puka', 'p-allen-lb']),
    roster('r3', 't3', ['p-lamb', 'p-allen-lb2']),
  ],
} as unknown as CanonicalWorld

const NAMES = new Map<string, { name: string | null; position: string | null }>([
  ['p-bijan', { name: 'Bijan Robinson', position: 'RB' }],
  ['p-allen-qb', { name: 'Josh Allen', position: 'QB' }],
  ['p-mhj-mine', { name: 'Garrett Wilson', position: 'WR' }],
  ['p-puka', { name: 'Puka Nacua', position: 'WR' }],
  ['p-allen-lb', { name: 'Josh Allen', position: 'LB' }],
  ['p-lamb', { name: 'CeeDee Lamb', position: 'WR' }],
  ['p-allen-lb2', { name: 'Josh Allen', position: 'DL' }],
])

function evaluation(over: Partial<CanonicalTradeEvaluation> = {}): CanonicalTradeEvaluation {
  return {
    decisionType: 'manager.trade.evaluate',
    proposalId: 'chimmy-scenario',
    evaluatedAt: '2026-09-16T00:00:00.000Z',
    action: 'counter',
    recommendation: 'x',
    valueGiven: 8450,
    valueReceived: 7900,
    valueDelta: -550,
    grade: 'C+',
    fairnessScore: 70,
    confidenceScore: 80,
    coverageStatus: 'complete',
    coveragePct: 100,
    memo: {} as CanonicalTradeEvaluation['memo'],
    rosterImpact: {
      startingPointsBefore: 118.4,
      startingPointsAfter: 116.9,
      startingPointsDelta: -1.5,
      blockedReason: null,
      unpricedExcluded: 0,
      depth: [],
      replacement: [],
      unit: 'league_points_week',
      week: 3,
    },
    ...over,
  }
}

let deps: TradeScenarioDeps
const resolveWorld = vi.fn()
const loadPlayerNames = vi.fn()
const evaluate = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  resolveWorld.mockResolvedValue(WORLD)
  loadPlayerNames.mockResolvedValue(NAMES)
  evaluate.mockResolvedValue(evaluation())
  deps = { resolveWorld, loadPlayerNames, evaluate }
})

const run = (message: string, userId = 'viewer-1') =>
  buildTradeScenario({ message, leagueId: 'league-1', userId }, deps)

describe('a described trade is resolved against real rosters', () => {
  it('gives the viewer\'s player and receives the partner\'s', async () => {
    const s = await run('Should I trade Bijan Robinson for Puka Nacua?')
    expect(s?.status).toBe('ready')
    if (s?.status !== 'ready') return
    expect(s.give.map((p) => p.playerId)).toEqual(['p-bijan'])
    expect(s.get.map((p) => p.playerId)).toEqual(['p-puka'])
    expect(s.partnerTeamName).toBe('Rival')

    const [args, evalDeps] = evaluate.mock.calls[0]!
    expect(args).toMatchObject({
      leagueId: 'league-1',
      proposerRosterId: 'r1',
      receiverRosterId: 'r2',
      viewerRosterId: 'r1',
      includeRosterImpact: true,
    })
    expect(args.assets).toEqual([
      expect.objectContaining({ playerId: 'p-bijan', fromRosterId: 'r1', toRosterId: 'r2', assetType: 'player' }),
      expect.objectContaining({ playerId: 'p-puka', fromRosterId: 'r2', toRosterId: 'r1', assetType: 'player' }),
    ])
    // The loaded world is handed on, not fetched twice.
    expect(await evalDeps.resolveWorld('league-1')).toBe(WORLD)
    expect(resolveWorld).toHaveBeenCalledTimes(1)
  })

  it('orients by roster, not by word order', async () => {
    const s = await run('Would you do Puka Nacua for Bijan Robinson?')
    expect(s?.status).toBe('ready')
    if (s?.status !== 'ready') return
    expect(s.give.map((p) => p.playerId)).toEqual(['p-bijan'])
    expect(s.get.map((p) => p.playerId)).toEqual(['p-puka'])
  })

  it('finds the name inside a run that opens with a capitalised verb', async () => {
    const s = await run('Trade Bijan Robinson for Puka Nacua')
    expect(s?.status).toBe('ready')
  })

  it('carries value and lineup, and never a playoff number', async () => {
    const s = await run('Should I trade Bijan Robinson for Puka Nacua?')
    if (s?.status !== 'ready') throw new Error('not ready')
    expect(s.value).toMatchObject({ given: 8450, received: 7900, delta: -550, grade: 'C+' })
    expect(s.lineup).toEqual({ before: 118.4, after: 116.9, delta: -1.5, unit: 'league_points_week' })
    expect(s.lineupWeek).toBe(3)
    expect(s.playoffOdds.available).toBe(false)
  })
})

describe('the same name on two rosters (the QB and the IDP Josh Allen)', () => {
  it('is narrowed by the roster the side needs', async () => {
    const s = await run('Should I trade Josh Allen for Puka Nacua?')
    expect(s?.status).toBe('ready')
    if (s?.status !== 'ready') return
    expect(s.give).toEqual([{ playerId: 'p-allen-qb', name: 'Josh Allen', position: 'QB' }])
  })

  it('is refused when it still matches two other teams', async () => {
    const s = await run('Should I trade Bijan Robinson for Josh Allen?')
    expect(s).toMatchObject({ status: 'unresolved', reason: 'ambiguous_player' })
    expect(evaluate).not.toHaveBeenCalled()
  })
})

describe('it refuses rather than guessing', () => {
  it('a trade that spans two partner teams', async () => {
    const s = await run('Should I trade Bijan Robinson for Puka Nacua and CeeDee Lamb?')
    expect(s).toMatchObject({ status: 'unresolved', reason: 'multiple_partners' })
  })

  it('a player who is not on any roster, and names him', async () => {
    const s = await run('Should I trade Bijan Robinson for Ja\'Marr Chase?')
    expect(s).toMatchObject({ status: 'unresolved', reason: 'players_not_rostered' })
    if (s?.status === 'unresolved') expect(s.detail).toContain("Ja'Marr Chase")
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('a viewer with no claimed team in the league', async () => {
    const s = await run('Should I trade Bijan Robinson for Puka Nacua?', 'stranger-9')
    expect(s).toMatchObject({ status: 'unresolved', reason: 'no_viewer_roster' })
  })

  it('a league that will not load', async () => {
    resolveWorld.mockResolvedValue(null)
    const s = await run('Should I trade Bijan Robinson for Puka Nacua?')
    expect(s).toMatchObject({ status: 'unresolved', reason: 'no_league_world' })
  })

  it('an evaluator that throws', async () => {
    evaluate.mockRejectedValue(new Error('boom'))
    const s = await run('Should I trade Bijan Robinson for Puka Nacua?')
    expect(s).toMatchObject({ status: 'unresolved', reason: 'evaluation_failed' })
  })
})

describe('draft picks', () => {
  it.each([
    'Should I trade Bijan Robinson for Puka Nacua and a 2027 1st?',
    'Bijan Robinson for Puka Nacua plus a first-round pick',
    'Bijan Robinson for Puka Nacua and a 2nd',
    'Bijan Robinson for Puka Nacua and a first',
    'Bijan Robinson for Puka Nacua and two future firsts',
    'Bijan Robinson for Puka Nacua and a pick',
  ])('refuses before loading the league: %s', async (message) => {
    const s = await run(message)
    expect(s).toMatchObject({ status: 'unresolved', reason: 'includes_picks' })
    expect(resolveWorld).not.toHaveBeenCalled()
  })

  it.each([
    'Should I trade Bijan Robinson for Puka Nacua first, or wait?',
    "Bijan Robinson for Puka Nacua? I'm in 1st place",
    'Bijan Robinson for Puka Nacua, he is a 2nd-string back anyway',
    'Bijan Robinson for Puka Nacua, is that a first-time mistake?',
  ])('is not fooled by an ordinary ordinal: %s', async (message) => {
    const s = await run(message)
    expect(s?.status).toBe('ready')
  })
})

describe('lineup availability is reported, not invented', () => {
  it('passes the evaluator\'s blocked reason through', async () => {
    evaluate.mockResolvedValue(
      evaluation({
        rosterImpact: {
          startingPointsBefore: null,
          startingPointsAfter: null,
          startingPointsDelta: null,
          blockedReason: 'Puka Nacua has no projection',
          unpricedExcluded: 0,
          depth: [],
          replacement: [],
          unit: 'league_points_week',
          week: null,
        },
      }),
    )
    const s = await run('Should I trade Bijan Robinson for Puka Nacua?')
    if (s?.status !== 'ready') throw new Error('not ready')
    expect(s.lineup).toBeNull()
    expect(s.lineupUnavailable).toBe('Puka Nacua has no projection')
  })

  it('says why when the evaluator could not produce one at all', async () => {
    evaluate.mockResolvedValue(evaluation({ rosterImpact: null }))
    const s = await run('Should I trade Bijan Robinson for Puka Nacua?')
    if (s?.status !== 'ready') throw new Error('not ready')
    expect(s.lineup).toBeNull()
    expect(s.lineupUnavailable).toMatch(/could not be priced/)
  })
})

describe('what is not a described trade', () => {
  it.each(['Is Bijan Robinson a buy?', 'Bijan Robinson or Puka Nacua this week?', 'trade for someone good'])(
    'returns null: %s',
    async (message) => {
      expect(looksLikeDescribedTrade(message)).toBe(false)
      expect(await run(message)).toBeNull()
      expect(resolveWorld).not.toHaveBeenCalled()
    },
  )
})

describe('the prompt block', () => {
  it('states the numbers and forbids estimating playoff odds', async () => {
    const s = await run('Should I trade Bijan Robinson for Puka Nacua?')
    const block = renderTradeScenarioBlock(s!)
    expect(block).toContain('You give: Bijan Robinson (RB). You get: Puka Nacua (WR) from Rival.')
    expect(block).toContain('you send 8450, you receive 7900 (-550); grade C+.')
    expect(block).toContain(
      "Starting lineup, week 3 projections scored under this league's own rules: 118.4 before, 116.9 after (-1.5). This is one week, not the rest of the season",
    )
    expect(block).not.toMatch(/per game/)
    expect(block).toMatch(/Playoff odds: not computed\..*Do not estimate them\./)
  })

  it('tells the model not to present a comparison it does not have', async () => {
    const s = await run('Should I trade Bijan Robinson for Puka Nacua and CeeDee Lamb?')
    const block = renderTradeScenarioBlock(s!)
    expect(block).toMatch(/^TRADE SCENARIO: NOT COMPUTED\./)
    expect(block).toContain('Do not present a before/after comparison')
  })
})
