/**
 * `rosterImpact` on the canonical trade evaluation.
 *
 * 🛑 THE FIRST ASSERTION EXISTS BECAUSE I WROTE THAT BUG. The impact was computed into a local and
 * never added to the returned object — the same "computed and thrown away" shape this repo keeps
 * finding in other people's code. Nothing failed; the field was simply always `undefined`, which is
 * indistinguishable from "not asked for".
 *
 * The rest pin the cost decision (opt-in) and the refusals, since each of those failures produces a
 * plausible NUMBER rather than an absent one.
 */
import { describe, expect, it, vi } from 'vitest'

import { evaluateCanonicalTrade } from '@/lib/decision-os/trade/canonicalEvaluator'
import type { TradeAssetSummary } from '@/lib/decision-os/trade/dco'

const ROSTER = ['qb1', 'rb1', 'rb2', 'rb3', 'wr1', 'wr2', 'te1']
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN']

/*
 * ⚠ MODELLED ON `__tests__/decision-os/trade-memo.test.ts`'s `makeWorld`, NOT HAND-GROWN.
 * The first version of this fixture carried only the fields this test cares about, and the
 * evaluator crashed twice on unrelated ones it happens to read — `waiverSettings.budget`, then
 * `tradeSettings.deadlineWeek`. Each failure named a field rather than a behaviour, which points
 * at the fixture and not at anything under test. Copying the established shape ends that loop.
 */
const leagueFacts = (over: Record<string, unknown> = {}) => ({
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
  ...over,
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

const world = (leagueOver: Record<string, unknown> = {}) =>
  ({
    league: leagueFacts(leagueOver),
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

const POSITIONS: Record<string, string> = {
  qb1: 'QB', rb1: 'RB', rb2: 'RB', rb3: 'RB', wr1: 'WR', wr2: 'WR', te1: 'TE', wr9: 'WR',
}
const PROJECTIONS: Record<string, number> = {
  qb1: 20, rb1: 15, rb2: 12, rb3: 6, wr1: 14, wr2: 11, te1: 9, wr9: 25,
}

/*
 * 🛑 THE TWO PROJECTION MAPS CARRY DIFFERENT NUMBERS ON PURPOSE. `projectionByPlayerId` is
 * rest-of-season (modelled here as 17 games' worth); `perGameProjectionByPlayerId` is per game.
 * This stub used to supply only `projectionByPlayerId` with per-game-looking values, so it passed
 * while production read a season total and labelled it per game — a "gains N pts per game" line
 * ~17x too large. With distinct values, reading the wrong map moves every delta below.
 */
const enrichment = (projections: Record<string, number | null> = PROJECTIONS) =>
  vi.fn(async () => ({
    enrichment: {
      positionByPlayerId: POSITIONS,
      perGameProjectionByPlayerId: projections,
      projectionByPlayerId: Object.fromEntries(
        Object.entries(projections).map(([id, v]) => [id, v == null ? null : v * 17]),
      ),
    },
    valuationSource: null,
    adpResolved: 0,
    positionResolved: 0,
    projectionResolved: 0,
    idpValueResolved: 0,
    thinlyPricedIds: [],
    unresolvedIds: [],
    warnings: [],
  })) as never

/** rb3 out, wr9 in — an upgrade at the FLEX. */
const ASSETS: TradeAssetSummary[] = [
  { assetType: 'player', itemReference: 'rb3', fromRosterId: 'A', toRosterId: 'B', playerId: 'rb3', playerName: 'RB Three', position: 'RB', team: null, pickSeason: null, pickRound: null, pickNumber: null, pickOriginalRosterId: null, pickLabel: null, faabAmount: null },
  { assetType: 'player', itemReference: 'wr9', fromRosterId: 'B', toRosterId: 'A', playerId: 'wr9', playerName: 'WR Nine', position: 'WR', team: null, pickSeason: null, pickRound: null, pickNumber: null, pickOriginalRosterId: null, pickLabel: null, faabAmount: null },
]

const run = (over: Record<string, unknown> = {}, deps: Record<string, unknown> = {}) =>
  evaluateCanonicalTrade(
    {
      leagueId: 'lg1',
      proposalId: 'p1',
      proposerRosterId: 'A',
      receiverRosterId: 'B',
      viewerRosterId: 'A',
      assets: ASSETS,
      ...over,
    },
    { resolveWorld: async () => world(), resolveEnrichment: enrichment(), ...deps } as never,
  )

describe('rosterImpact on the canonical evaluation', () => {
  /** 🛑 The regression this file was written for: computed into a local, never returned. */
  it('actually returns the impact it computed', async () => {
    const r = await run({ includeRosterImpact: true })
    expect(r.rosterImpact).toBeTruthy()
    expect(r.rosterImpact?.startingPointsDelta).toBe(19)
  })

  it('🛑 is denominated PER GAME — built from the per-game map, never the rest-of-season one', async () => {
    const r = await run({ includeRosterImpact: true })
    expect(r.rosterImpact?.unit).toBe('projected_points_per_game')
    // Per game: QB20 RB15 RB12 WR14 WR11 TE9 FLEX(rb3 6) = 87. The ROS map would say 1,479.
    expect(r.rosterImpact?.startingPointsBefore).toBe(87)
    expect(r.rosterImpact?.startingPointsDelta).not.toBe(19 * 17)
  })

  it('treats a player with only a rest-of-season number as NOT projected per game', async () => {
    const onlyRos = vi.fn(async () => ({
      enrichment: {
        positionByPlayerId: POSITIONS,
        // wr9 (incoming) has a season total but no per-game value.
        perGameProjectionByPlayerId: { ...PROJECTIONS, wr9: null },
        projectionByPlayerId: { ...PROJECTIONS, wr9: 425 },
      },
      valuationSource: null, adpResolved: 0, positionResolved: 0, projectionResolved: 0,
      idpValueResolved: 0, thinlyPricedIds: [], unresolvedIds: [], warnings: [],
    })) as never
    const r = await run({ includeRosterImpact: true }, { resolveEnrichment: onlyRos })
    expect(r.rosterImpact?.startingPointsDelta).toBeNull()
    expect(r.rosterImpact?.blockedReason).toMatch(/no projection/)
  })

  /**
   * ⚠ OPT-IN IS A COST DECISION. Computing always would widen enrichment from the handful of
   * traded players to a whole roster for ~60 trade routes at once, and the one that notices is
   * whichever surface gets slow first.
   */
  it('is absent — not null — when it was not asked for', async () => {
    const r = await run()
    expect(r.rosterImpact).toBeUndefined()
  })

  it('does not enrich the roster when it was not asked for', async () => {
    const spy = enrichment()
    await run({}, { resolveEnrichment: spy })
    const ids = (spy as unknown as { mock: { calls: Array<[{ playerIds: string[] }]> } }).mock.calls[0][0].playerIds
    expect(ids.sort()).toEqual(['rb3', 'wr9'])
  })

  it('enriches the viewer roster once, deduped against the traded players', async () => {
    const spy = enrichment()
    await run({ includeRosterImpact: true }, { resolveEnrichment: spy })
    const ids = (spy as unknown as { mock: { calls: Array<[{ playerIds: string[] }]> } }).mock.calls[0][0].playerIds
    // rb3 is both traded and rostered; paying for him twice is the obvious version of this mistake.
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('wr9')
    expect(ids).toContain('qb1')
  })

  /**
   * 🛑 A MISSING LINEUP IS NOT AN EMPTY ONE. With `[]` every lineup scores zero on both sides and
   * the delta is a confident 0.0 — "this trade changes nothing" about a league whose slots we do
   * not know.
   */
  it('returns null rather than a zero delta when the league has no starter slots', async () => {
    const r = await run(
      { includeRosterImpact: true },
      { resolveWorld: async () => world({ rosterSettings: { rosterSize: null, starterSlots: null, irSlots: null, taxiSlots: null } }) },
    )
    expect(r.rosterImpact).toBeNull()
  })

  /**
   * 🛑 THE EMPTY ARRAY IS WHAT THE GUARD ACTUALLY EXISTS FOR, AND THE `null` CASE ABOVE DOES NOT
   * COVER IT. Verified by mutation: deleting the guard left that test GREEN, because `null` slots
   * make `fillLineup` throw and the surrounding try/catch returns null anyway — the right answer by
   * the wrong route. An empty array throws nothing: every lineup scores zero on both sides and the
   * delta comes back a confident 0.0 — "this trade changes nothing" — about a league whose slots we
   * simply do not have.
   */
  it('returns null for an empty slot list rather than a confident zero delta', async () => {
    const r = await run(
      { includeRosterImpact: true },
      { resolveWorld: async () => world({ rosterSettings: { rosterSize: null, starterSlots: [], irSlots: null, taxiSlots: null } }) },
    )
    expect(r.rosterImpact).toBeNull()
  })

  /** ⚠ An unpriced traded asset must block, not produce a delta. */
  it('blocks when the incoming player has no projection', async () => {
    const r = await run(
      { includeRosterImpact: true },
      { resolveEnrichment: enrichment({ ...PROJECTIONS, wr9: null }) },
    )
    expect(r.rosterImpact?.startingPointsDelta).toBeNull()
    expect(r.rosterImpact?.blockedReason).toMatch(/no projection/i)
  })

  /** ⚠ The unit ships with the value — per-game and rest-of-season are not interchangeable. */
  it('names the unit of the number it reports', async () => {
    const r = await run({ includeRosterImpact: true })
    expect(r.rosterImpact?.unit).toBe('projected_points_per_game')
  })

  it('leaves the value verdict untouched', async () => {
    const withImpact = await run({ includeRosterImpact: true })
    const without = await run()
    expect(withImpact.grade).toBe(without.grade)
    expect(withImpact.action).toBe(without.action)
  })
})
