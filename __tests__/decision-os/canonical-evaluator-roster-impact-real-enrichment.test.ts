/**
 * `rosterImpact` with the REAL enrichment running beside it.
 *
 * 🛑 WHY THIS FILE EXISTS NEXT TO `canonical-evaluator-roster-impact.test.ts`. That suite stubs
 * `resolveEnrichment`, and a stub is only as honest as whoever last updated it. It once carried a
 * single map of per-game-looking numbers while production filled that map with AF's REST-OF-SEASON
 * totals, so the Trade Center printed "gains N pts per game" ~17x too large (fixed in 517b6f948).
 *
 * 🛑 AND THE BASIS HAS MOVED SINCE (2026-09-17). The lineup no longer reads the enrichment's
 * projections at all: AF's per-game figure is full PPR in every league, so the lineup is now this
 * week's projection scored under the league's own rules (`leagueWeekPricing.ts`). Here the REAL
 * `resolveTradeEnrichment` still runs on an in-memory port whose AF rows carry big, distinct numbers
 * — if the evaluator ever reads them for the lineup again, the totals below move — while the value
 * engine must keep receiving its rest-of-season input exactly as before.
 */
import { describe, expect, it } from 'vitest'

import { evaluateCanonicalTrade } from '@/lib/decision-os/trade/canonicalEvaluator'
import {
  resolveTradeEnrichment,
  type TradeEnrichmentPort,
  type TradeEnrichmentResult,
} from '@/lib/decision-os/trade/enrichmentPort'
import type { TradeAssetSummary } from '@/lib/decision-os/trade/dco'
import type { LeagueWeekPricingDeps } from '@/lib/decision-os/trade/leagueWeekPricing'
import type { NormalizedPlayerMetadata } from '@/lib/decision-os/world'
import type { RawAfProjectionRow } from '@/lib/decision-os/world/port'

const ROS_GAMES = 17
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN']
const ROSTER = ['qb1', 'rb1', 'rb2', 'rb3', 'wr1', 'wr2', 'te1']
const RULES = { rec: 0.5, rec_yd: 0.1, rush_yd: 0.1 }

const POSITIONS: Record<string, string> = {
  qb1: 'QB', rb1: 'RB', rb2: 'RB', rb3: 'RB', wr1: 'WR', wr2: 'WR', te1: 'TE', wr9: 'WR',
}
/** AF's full-PPR per-game numbers — deliberately NOT the week's league-scored ones below. */
const AF_PER_GAME: Record<string, number> = {
  qb1: 30, rb1: 30, rb2: 30, rb3: 30, wr1: 30, wr2: 30, te1: 30, wr9: 30,
}
/** This week under RULES: QB20 RB15 RB12 WR14 WR11 TE9 FLEX(rb3 6) = 87 before; wr9 (25) in → 106. */
const yards = (points: number) => ({ rush_yd: points * 10 })
const WEEK_LINES: Record<string, Record<string, unknown>> = {
  qb1: yards(20), rb1: yards(15), rb2: yards(12), rb3: yards(6), wr1: yards(14), wr2: yards(11), te1: yards(9), wr9: yards(25),
}

/* Same fixture shape as the stubbed suite (itself modelled on trade-memo.test.ts's `makeWorld`). */
const leagueFacts = () => ({
  leagueId: 'lg1',
  sport: 'nfl',
  season: 2026,
  leagueType: 'redraft',
  isDynasty: false,
  scoringPresetId: 'half_ppr',
  scoringSettings: { scoring_settings: RULES },
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

const world = () =>
  ({
    league: leagueFacts(),
    teams: [],
    rosters: [roster('A', 'tA', ROSTER), roster('B', 'tB', ['wr9'])],
    provenance: {
      sourceModels: ['League', 'Roster'],
      provider: 'sleeper',
      sourceLeagueId: 'lg1',
      assembledAt: '2026-09-16T00:00:00.000Z',
      freshness: { lastSyncedAt: null, isStale: false, staleReason: null },
    },
    completeness: { dataCompleteness: 90, warnings: [], unsupported: [] },
  }) as never

/** rb3 out, wr9 in — an upgrade at the FLEX. */
const ASSETS: TradeAssetSummary[] = [
  { assetType: 'player', itemReference: 'rb3', fromRosterId: 'A', toRosterId: 'B', playerId: 'rb3', playerName: 'RB Three', position: 'RB', team: null, pickSeason: null, pickRound: null, pickNumber: null, pickOriginalRosterId: null, pickLabel: null, faabAmount: null },
  { assetType: 'player', itemReference: 'wr9', fromRosterId: 'B', toRosterId: 'A', playerId: 'wr9', playerName: 'WR Nine', position: 'WR', team: null, pickSeason: null, pickRound: null, pickNumber: null, pickOriginalRosterId: null, pickLabel: null, faabAmount: null },
]

const NOW = new Date()

const afRow = (playerId: string, afProjection: number): RawAfProjectionRow => ({
  playerId,
  sport: 'nfl',
  season: 2026,
  week: 3,
  afProjection,
  rosProjection: afProjection * ROS_GAMES,
  rosWeeksRemaining: ROS_GAMES,
  confidenceLevel: 'high',
  computedAt: NOW,
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

function makePort(opts: { failAll?: boolean } = {}): TradeEnrichmentPort {
  const fail = async (): Promise<never> => {
    throw new Error('source down')
  }
  if (opts.failAll) {
    return { loadAdp: fail, resolveMetadata: fail, loadProjections: fail, loadAfProjections: fail, loadMarketValue: fail, loadIdpValue: fail }
  }
  const af = Object.entries(AF_PER_GAME).map(([id, pg]) => afRow(id, pg))
  return {
    loadAdp: async () => [],
    resolveMetadata: async (_sport, ids) => ({
      byId: new Map(ids.map((id) => [id, meta(id)])),
      complete: ids.every((id) => POSITIONS[id]),
      unresolvedIds: ids.filter((id) => !POSITIONS[id]),
      warnings: [],
    }),
    loadAfProjections: async (_sport, ids) => af.filter((r) => ids.includes(r.playerId)),
    loadProjections: async () => [],
    loadMarketValue: async () => [],
    loadIdpValue: async () => [],
  }
}

const leagueWeek = (opts: { down?: boolean } = {}): LeagueWeekPricingDeps => ({
  latestWeek: async () => ({ season: '2026', week: 3 }),
  loadWeekLines: async ({ playerIds, positions }) => {
    if (opts.down) throw new Error('feed down')
    return new Map(
      playerIds.filter((id) => WEEK_LINES[id]).map((id) => [id, { position: positions.get(id) ?? null, componentStats: WEEK_LINES[id]! }]),
    )
  },
})

async function run(opts: { port: TradeEnrichmentPort; includeRosterImpact?: boolean; weekDown?: boolean }) {
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
      resolveWorld: async () => world(),
      // The REAL enrichment — only its data source is injected.
      resolveEnrichment: async (args) => {
        enriched = await resolveTradeEnrichment(args, opts.port)
        return enriched
      },
      leagueWeek: leagueWeek({ down: opts.weekDown }),
    },
  )
  return { result, enriched: enriched as TradeEnrichmentResult | null }
}

describe('rosterImpact beside the real resolveTradeEnrichment', () => {
  it("🛑 totals the lineup from this week's league-scored lines, not AF's full-PPR per-game rows", async () => {
    const { result, enriched } = await run({ port: makePort() })
    // The enrichment really did fill the per-game map — with 30s the lineup must not use.
    expect(enriched?.enrichment.perGameProjectionByPlayerId?.qb1).toBe(30)
    expect(result.rosterImpact?.unit).toBe('league_points_week')
    expect(result.rosterImpact?.week).toBe(3)
    expect(result.rosterImpact?.blockedReason).toBeNull()
    expect(result.rosterImpact?.startingPointsBefore).toBe(87)
    expect(result.rosterImpact?.startingPointsAfter).toBe(106)
    expect(result.rosterImpact?.startingPointsDelta).toBe(19)
  })

  it('leaves the value engine its rest-of-season input', async () => {
    const { enriched } = await run({ port: makePort() })
    expect(enriched?.enrichment.projectionByPlayerId?.qb1).toBe(30 * ROS_GAMES)
  })
})

describe('the opt-in and the absent-vs-unusable distinction, end to end', () => {
  it('is absent when not asked for, and the roster is not enriched', async () => {
    const asked: string[][] = []
    const port = makePort()
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
    const { result } = await run({ port: makePort({ failAll: true }), weekDown: true })
    expect(result.rosterImpact).not.toBeUndefined()
    expect(result.rosterImpact?.startingPointsDelta ?? null).toBeNull()
  })
})
