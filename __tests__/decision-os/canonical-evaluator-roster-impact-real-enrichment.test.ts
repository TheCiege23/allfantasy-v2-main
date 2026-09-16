/**
 * `rosterImpact` through the REAL enrichment path.
 *
 * 🛑 WHY THIS FILE EXISTS NEXT TO `canonical-evaluator-roster-impact.test.ts`. That suite stubs
 * `resolveEnrichment`, and a stub is only as honest as whoever last updated it. It once carried a
 * single map of per-game-looking numbers while production filled that map with AF's
 * REST-OF-SEASON totals plus a per-WEEK provider fallback, so the Trade Center printed "gains N pts
 * per game" ~17x too large and the stubbed test stayed green (fixed in 517b6f948).
 *
 * Here nothing between the port and the evaluator is replaced: `resolveTradeEnrichment` runs for
 * real on an injected, in-memory `TradeEnrichmentPort` whose rows carry the units production
 * stores — `afProjection` per game, `rosProjection` = 17 games of it, provider `projectedPoints`
 * per week. If the evaluator ever reads the wrong map again, or the enrichment starts filling the
 * per-game map from a source in another unit, the lineup totals below move.
 */
import { describe, expect, it } from 'vitest'

import { evaluateCanonicalTrade } from '@/lib/decision-os/trade/canonicalEvaluator'
import {
  resolveTradeEnrichment,
  type TradeEnrichmentPort,
  type TradeEnrichmentResult,
} from '@/lib/decision-os/trade/enrichmentPort'
import type { TradeAssetSummary } from '@/lib/decision-os/trade/dco'
import type { NormalizedPlayerMetadata } from '@/lib/decision-os/world'
import type { RawProjectionRow } from '@/lib/decision-os/world/facts'
import type { RawAfProjectionRow } from '@/lib/decision-os/world/port'

const ROS_GAMES = 17
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN']
const ROSTER = ['qb1', 'rb1', 'rb2', 'rb3', 'wr1', 'wr2', 'te1']

const POSITIONS: Record<string, string> = {
  qb1: 'QB', rb1: 'RB', rb2: 'RB', rb3: 'RB', wr1: 'WR', wr2: 'WR', te1: 'TE', wr7: 'WR', wr9: 'WR',
}
/** AF's per-game numbers. Starters before the trade: 20 + 15 + 12 + 14 + 11 + 9 + FLEX 6 = 87. */
const PER_GAME: Record<string, number> = {
  qb1: 20, rb1: 15, rb2: 12, rb3: 6, wr1: 14, wr2: 11, te1: 9, wr9: 25,
}

/* Same fixture shape as the stubbed suite (itself modelled on trade-memo.test.ts's `makeWorld`). */
const leagueFacts = () => ({
  leagueId: 'lg1',
  sport: 'nfl',
  season: 2026,
  leagueType: 'redraft',
  isDynasty: false,
  scoringPresetId: 'ppr',
  scoringSettings: null,
  rosterSettings: { rosterSize: null, starterSlots: SLOTS, irSlots: null, taxiSlots: null },
  waiverSettings: { type: null, budget: null, minBid: null, hours: null },
  tradeSettings: { reviewHours: null, deadlineWeek: null, pickTrading: true },
  currentWeek: 3,
  currentWeekBasis: 'team_performance',
})

const roster = (rosterId: string, teamId: string, playerIds: string[]) => ({
  rosterId,
  teamId,
  playerIds,
  starterIds: [],
  benchIds: [],
  reserveIds: [],
  taxiIds: [],
  playerCount: playerIds.length,
  waiverPriority: null,
  playerMetadataEnriched: false,
})

const world = (viewerRoster: string[]) =>
  ({
    league: leagueFacts(),
    teams: [],
    rosters: [roster('A', 'tA', viewerRoster), roster('B', 'tB', ['wr9'])],
    provenance: {
      sourceModels: ['League', 'Roster'],
      provider: 'sleeper',
      sourceLeagueId: 'lg1',
      assembledAt: '2026-09-16T00:00:00.000Z',
      freshness: { lastSyncedAt: null, isStale: false, staleReason: null },
    },
    completeness: { dataCompleteness: 90, warnings: [], unsupported: [] },
  }) as never

/** rb3 out, wr9 in — an upgrade at the FLEX: 87 → 87 - 6 + 25 = 106 per game. */
const ASSETS: TradeAssetSummary[] = [
  { assetType: 'player', itemReference: 'rb3', fromRosterId: 'A', toRosterId: 'B', playerId: 'rb3', playerName: 'RB Three', position: 'RB', team: null, pickSeason: null, pickRound: null, pickNumber: null, pickOriginalRosterId: null, pickLabel: null, faabAmount: null },
  { assetType: 'player', itemReference: 'wr9', fromRosterId: 'B', toRosterId: 'A', playerId: 'wr9', playerName: 'WR Nine', position: 'WR', team: null, pickSeason: null, pickRound: null, pickNumber: null, pickOriginalRosterId: null, pickLabel: null, faabAmount: null },
]

const NOW = new Date()

const afRow = (playerId: string, afProjection: number, over: Partial<RawAfProjectionRow> = {}): RawAfProjectionRow => ({
  playerId,
  sport: 'nfl',
  season: 2026,
  week: 3,
  afProjection,
  rosProjection: afProjection * ROS_GAMES,
  rosWeeksRemaining: ROS_GAMES,
  confidenceLevel: 'high',
  computedAt: NOW,
  ...over,
})

const providerRow = (playerId: string, projectedPoints: number): RawProjectionRow => ({
  playerId,
  sport: 'nfl',
  season: '2026',
  week: 3,
  scoringPresetId: 'ppr',
  projectedPoints,
  stats: null,
  source: 'sleeper',
  fetchedAt: NOW,
  expiresAt: new Date(NOW.getTime() + 7 * 86_400_000),
})

const meta = (playerId: string): NormalizedPlayerMetadata => ({
  playerId,
  name: playerId.toUpperCase(),
  position: POSITIONS[playerId] ?? null,
  team: null,
  injuryStatus: null,
  byeWeek: null,
  projectedPoints: null,
  projectionConfidence: null,
  source: 'test',
  resolved: Boolean(POSITIONS[playerId]),
})

/**
 * An in-memory port holding rows in the order the real readers return them: week-scoped AF rows
 * first, then season-long baselines.
 */
function makePort(opts: { af: RawAfProjectionRow[]; provider?: RawProjectionRow[]; failAll?: boolean }): TradeEnrichmentPort {
  const fail = async (): Promise<never> => {
    throw new Error('source down')
  }
  const pick = <T extends { playerId: string }>(rows: T[], ids: string[]) => rows.filter((r) => ids.includes(r.playerId))
  if (opts.failAll) {
    return { loadAdp: fail, resolveMetadata: fail, loadProjections: fail, loadAfProjections: fail, loadMarketValue: fail, loadIdpValue: fail }
  }
  return {
    loadAdp: async () => [],
    resolveMetadata: async (_sport, ids) => ({
      byId: new Map(ids.map((id) => [id, meta(id)])),
      complete: ids.every((id) => POSITIONS[id]),
      unresolvedIds: ids.filter((id) => !POSITIONS[id]),
      warnings: [],
    }),
    loadAfProjections: async (_sport, ids) => pick(opts.af, ids),
    loadProjections: async (_sport, ids) => pick(opts.provider ?? [], ids),
    loadMarketValue: async () => [],
    loadIdpValue: async () => [],
  }
}

const AF_ALL = Object.entries(PER_GAME).map(([id, pg]) => afRow(id, pg))

async function run(opts: {
  port: TradeEnrichmentPort
  viewerRoster?: string[]
  includeRosterImpact?: boolean
}) {
  let enriched: TradeEnrichmentResult | null = null
  const result = await evaluateCanonicalTrade(
    {
      leagueId: 'lg1',
      proposalId: 'p1',
      proposerRosterId: 'A',
      receiverRosterId: 'B',
      viewerRosterId: 'A',
      assets: ASSETS,
      includeRosterImpact: opts.includeRosterImpact ?? true,
    },
    {
      resolveWorld: async () => world(opts.viewerRoster ?? ROSTER),
      // The REAL enrichment — only its data source is injected.
      resolveEnrichment: async (args) => {
        enriched = await resolveTradeEnrichment(args, opts.port)
        return enriched
      },
    },
  )
  return { result, enriched: enriched as TradeEnrichmentResult | null }
}

describe('rosterImpact over the real resolveTradeEnrichment', () => {
  it('🛑 totals the lineup in per-game points, not rest-of-season ones', async () => {
    const { result } = await run({ port: makePort({ af: AF_ALL }) })
    expect(result.rosterImpact?.unit).toBe('projected_points_per_game')
    expect(result.rosterImpact?.blockedReason).toBeNull()
    expect(result.rosterImpact?.startingPointsBefore).toBe(87)
    expect(result.rosterImpact?.startingPointsAfter).toBe(106)
    expect(result.rosterImpact?.startingPointsDelta).toBe(19)
    // The ROS reading would be 17x: 1,479 → 1,802, a "+323 per game" headline.
    expect(result.rosterImpact?.startingPointsDelta).not.toBe(19 * ROS_GAMES)
  })

  it('leaves the value engine its rest-of-season input', async () => {
    const { enriched } = await run({ port: makePort({ af: AF_ALL }) })
    expect(enriched?.enrichment.projectionByPlayerId?.qb1).toBe(20 * ROS_GAMES)
    expect(enriched?.enrichment.perGameProjectionByPlayerId?.qb1).toBe(20)
  })

  it('reads the week-scoped per-game row before the season-long baseline', async () => {
    const af = [...AF_ALL, afRow('wr9', 5, { week: null })]
    const { result } = await run({ port: makePort({ af }) })
    expect(result.rosterImpact?.startingPointsDelta).toBe(19)
  })

  it('uses the per-game number of an AF row that predates the rest-of-season columns', async () => {
    const af = AF_ALL.map((r) => (r.playerId === 'wr9' ? { ...r, rosProjection: null, rosWeeksRemaining: null } : r))
    const { result, enriched } = await run({ port: makePort({ af }) })
    expect(result.rosterImpact?.startingPointsDelta).toBe(19)
    // …while valuation still skips it rather than inventing a season total.
    expect(enriched?.enrichment.projectionByPlayerId?.wr9 ?? null).toBeNull()
  })

  /*
   * 🛑 A PER-WEEK NUMBER NEVER ENTERS A PER-GAME LINEUP. wr7 has only a provider row, and a big one:
   * if it leaked into the per-game map it would start at WR/FLEX and move both totals.
   */
  it('keeps a provider-only bench player out of the lineup, and says so', async () => {
    const { result, enriched } = await run({
      port: makePort({ af: AF_ALL, provider: [providerRow('wr7', 30)] }),
      viewerRoster: [...ROSTER, 'wr7'],
    })
    expect(result.rosterImpact?.startingPointsBefore).toBe(87)
    expect(result.rosterImpact?.startingPointsDelta).toBe(19)
    expect(result.rosterImpact?.unpricedExcluded).toBeGreaterThanOrEqual(1)
    // The provider fallback still feeds valuation, exactly as before.
    expect(enriched?.enrichment.projectionByPlayerId?.wr7).toBe(30)
    expect(enriched?.enrichment.perGameProjectionByPlayerId?.wr7 ?? null).toBeNull()
  })

  it('blocks rather than mixing units when the incoming player has only a provider number', async () => {
    const af = AF_ALL.filter((r) => r.playerId !== 'wr9')
    const { result } = await run({ port: makePort({ af, provider: [providerRow('wr9', 25)] }) })
    expect(result.rosterImpact?.startingPointsDelta).toBeNull()
    expect(result.rosterImpact?.blockedReason).toMatch(/no projection/i)
    expect(result.rosterImpact?.unit).toBe('projected_points_per_game')
  })
})

describe('the opt-in and the absent-vs-unusable distinction, end to end', () => {
  it('is absent when not asked for, and the roster is not enriched', async () => {
    const asked: string[][] = []
    const port = makePort({ af: AF_ALL })
    const spying: TradeEnrichmentPort = {
      ...port,
      loadAfProjections: async (sport, ids, season, week) => {
        asked.push([...ids])
        return port.loadAfProjections(sport, ids, season, week)
      },
    }
    const { result } = await run({ port: spying, includeRosterImpact: false })
    expect(result.rosterImpact).toBeUndefined()
    expect(asked.flat().sort()).toEqual(['rb3', 'wr9'])
  })

  it('never produces a number when every source is down', async () => {
    const { result } = await run({ port: makePort({ af: [], failAll: true }) })
    expect(result.rosterImpact).not.toBeUndefined()
    expect(result.rosterImpact?.startingPointsDelta ?? null).toBeNull()
  })
})
