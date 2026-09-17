/**
 * `rosterImpact` on the canonical evaluation.
 *
 * 🛑 THE FIRST ASSERTION EXISTS BECAUSE I WROTE THAT BUG. The impact was computed into a local and
 * never added to the returned object — the same "computed and thrown away" shape this repo keeps
 * finding in other people's code. Nothing failed; the field was simply always `undefined`, which is
 * indistinguishable from "not asked for".
 *
 * 🛑 THE BASIS MOVED 2026-09-17 (user decision, option (a)). The lineup used to be AllFantasy's
 * per-game figure, which is FULL PPR in every league; it is now this week's projection scored under
 * the league's own rules (`leagueWeekPricing.ts`), and a league that cannot be priced that way is
 * refused by name. The league-week seam is injected; `computeLeagueProjectedPoints` is the real one,
 * so every number below is a component line run through a real rulebook.
 *
 * The rest pin the cost decision (opt-in) and the refusals, since each of those failures produces a
 * plausible NUMBER rather than an absent one.
 */
import { describe, expect, it, vi } from 'vitest'

import { evaluateCanonicalTrade } from '@/lib/decision-os/trade/canonicalEvaluator'
import type { TradeAssetSummary } from '@/lib/decision-os/trade/dco'
import type { LeagueWeekPricingDeps } from '@/lib/decision-os/trade/leagueWeekPricing'

const ROSTER = ['qb1', 'rb1', 'rb2', 'rb3', 'wr1', 'wr2', 'te1']
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN']
const FULL_PPR = { rec: 1, rec_yd: 0.1, rush_yd: 0.1 }
const HALF_PPR = { rec: 0.5, rec_yd: 0.1, rush_yd: 0.1 }
const WEEK = { season: '2026', week: 3 }

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
  // The canonical world carries the WRAPPER, as `narrowScoringSettings` builds it.
  scoringSettings: { scoring_settings: FULL_PPR },
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

/** A line worth `points` under any rulebook here: rushing yards only, at 0.1 a yard. */
const yards = (points: number) => ({ rush_yd: points * 10 })

/** This week: QB20 RB15 RB12 WR14 WR11 TE9 FLEX(rb3 6) = 87 before; wr9 (25) replaces rb3 → 106. */
const LINES: Record<string, Record<string, unknown>> = {
  qb1: yards(20), rb1: yards(15), rb2: yards(12), rb3: yards(6), wr1: yards(14), wr2: yards(11), te1: yards(9), wr9: yards(25),
}

/*
 * 🛑 THE ENRICHMENT'S PER-GAME MAP CARRIES DIFFERENT, BIGGER NUMBERS ON PURPOSE. It is AllFantasy's
 * full-PPR per-game figure — the basis this field used to read. If the evaluator ever reads it again,
 * every total below moves.
 */
const enrichment = () =>
  vi.fn(async () => ({
    enrichment: {
      positionByPlayerId: POSITIONS,
      perGameProjectionByPlayerId: Object.fromEntries(Object.keys(POSITIONS).map((id) => [id, 40])),
      projectionByPlayerId: Object.fromEntries(Object.keys(POSITIONS).map((id) => [id, 680])),
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

const leagueWeek = (lines: Record<string, Record<string, unknown>> = LINES, week: typeof WEEK | null = WEEK) => {
  const loadWeekLines = vi.fn(async (args: { playerIds: string[]; positions: ReadonlyMap<string, string | null> }) =>
    new Map(args.playerIds.filter((id) => lines[id]).map((id) => [id, { position: args.positions.get(id) ?? null, componentStats: lines[id]! }])),
  )
  const latestWeek = vi.fn(async () => week)
  return { latestWeek, loadWeekLines } as unknown as LeagueWeekPricingDeps & {
    latestWeek: ReturnType<typeof vi.fn>
    loadWeekLines: ReturnType<typeof vi.fn>
  }
}

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
    { resolveWorld: async () => world(), resolveEnrichment: enrichment(), leagueWeek: leagueWeek(), ...deps } as never,
  )

describe('rosterImpact on the canonical evaluation', () => {
  /** 🛑 The regression this file was written for: computed into a local, never returned. */
  it('actually returns the impact it computed', async () => {
    const r = await run({ includeRosterImpact: true })
    expect(r.rosterImpact).toBeTruthy()
    expect(r.rosterImpact?.startingPointsDelta).toBe(19)
  })

  it("🛑 is this week's projection under the league's rules — never the full-PPR per-game map", async () => {
    const r = await run({ includeRosterImpact: true })
    expect(r.rosterImpact?.unit).toBe('league_points_week')
    expect(r.rosterImpact?.week).toBe(3)
    expect(r.rosterImpact?.startingPointsBefore).toBe(87)
    expect(r.rosterImpact?.startingPointsAfter).toBe(106)
    // The per-game map says 40 for everyone: 7 starters × 40 = 280, and a delta of 0.
    expect(r.rosterImpact?.startingPointsBefore).not.toBe(280)
  })

  /*
   * 🛑 THE CASE THIS CHANGE EXISTS FOR. The same component lines, two rulebooks: a receiver-heavy
   * incoming player is worth less in a half-PPR league, and the delta says so.
   */
  it('prices a half-PPR league differently from a full-PPR one on the same lines', async () => {
    const lines = { ...LINES, wr9: { rec: 10, rec_yd: 150 } } // full PPR 25, half PPR 20
    const full = await run({ includeRosterImpact: true }, { leagueWeek: leagueWeek(lines) })
    const half = await run(
      { includeRosterImpact: true },
      { resolveWorld: async () => world({ scoringSettings: { scoring_settings: HALF_PPR } }), leagueWeek: leagueWeek(lines) },
    )
    expect(full.rosterImpact?.startingPointsDelta).toBe(19)
    expect(half.rosterImpact?.startingPointsDelta).toBe(14)
  })

  it('hands the pricing the unwrapped rulebook, the whole roster plus the incoming player, and their positions', async () => {
    const lw = leagueWeek()
    await run({ includeRosterImpact: true }, { leagueWeek: lw })
    const call = lw.loadWeekLines.mock.calls[0]![0] as { rules: unknown; playerIds: string[]; positions: Map<string, string | null> }
    expect(call.rules).toEqual(FULL_PPR)
    expect([...call.playerIds].sort()).toEqual([...ROSTER, 'wr9'].sort())
    expect(call.positions.get('wr9')).toBe('WR')
  })

  /*
   * 🛑 THE USER'S STANDING DECISION: REFUSE, NEVER A GENERIC NUMBER UNDER A "YOUR LEAGUE" LABEL.
   * A refusal is a blocked impact with the reason — not `null`, which the renderers read as
   * "unavailable right now" and would not explain.
   */
  it('refuses, by name, a league with no rulebook, a non-NFL league, and a missing feed week', async () => {
    const noRules = await run({ includeRosterImpact: true }, { resolveWorld: async () => world({ scoringSettings: null }) })
    expect(noRules.rosterImpact?.startingPointsDelta).toBeNull()
    expect(noRules.rosterImpact?.blockedReason).toMatch(/generic projection would not be yours/)
    expect(noRules.rosterImpact?.unit).toBe('league_points_week')

    const metadataOnly = await run(
      { includeRosterImpact: true },
      { resolveWorld: async () => world({ scoringSettings: { scoring_settings: { rules: {}, preset: 'custom' } } }) },
    )
    expect(metadataOnly.rosterImpact?.blockedReason).toMatch(/generic projection would not be yours/)

    const lw = leagueWeek()
    const nba = await run({ includeRosterImpact: true }, { resolveWorld: async () => world({ sport: 'nba' }), leagueWeek: lw })
    expect(nba.rosterImpact?.blockedReason).toMatch(/NFL leagues only/)
    expect(lw.loadWeekLines).not.toHaveBeenCalled()

    const noWeek = await run({ includeRosterImpact: true }, { leagueWeek: leagueWeek(LINES, null) })
    expect(noWeek.rosterImpact?.blockedReason).toMatch(/no weekly projection feed/)
    expect(noWeek.rosterImpact?.week).toBeNull()
  })

  /**
   * ⚠ OPT-IN IS A COST DECISION. Computing always would widen enrichment from the handful of
   * traded players to a whole roster for ~60 trade routes at once, and the one that notices is
   * whichever surface gets slow first.
   */
  it('is absent — not null — when it was not asked for, and prices nothing', async () => {
    const lw = leagueWeek()
    const r = await run({}, { leagueWeek: lw })
    expect(r.rosterImpact).toBeUndefined()
    expect(lw.latestWeek).not.toHaveBeenCalled()
    expect(lw.loadWeekLines).not.toHaveBeenCalled()
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

  /** ⚠ An unpriced traded asset must block, not produce a delta — the enrichment's number notwithstanding. */
  it('blocks when the incoming player has no line this week', async () => {
    const { wr9: _gone, ...noIncoming } = LINES
    const r = await run({ includeRosterImpact: true }, { leagueWeek: leagueWeek(noIncoming) })
    expect(r.rosterImpact?.startingPointsDelta).toBeNull()
    expect(r.rosterImpact?.blockedReason).toMatch(/no projection/i)
  })

  it('discloses a bench player nothing prices this week, and leaves the lineup to the priced ones', async () => {
    const { rb3: _bench, ...noBench } = LINES
    // rb3 is traded away here, so trade a different asset set: only wr9 comes in.
    const r = await run(
      { includeRosterImpact: true, assets: [ASSETS[1]!] },
      { leagueWeek: leagueWeek(noBench) },
    )
    expect(r.rosterImpact?.unpricedExcluded).toBe(1)
    // 20+15+12+14+11+9 = 81 before (FLEX empty); wr9 takes a WR slot, wr2 moves to FLEX: 81 + 25 = 106.
    expect(r.rosterImpact?.startingPointsAfter).toBe(106)
  })

  it('leaves the value verdict untouched', async () => {
    const withImpact = await run({ includeRosterImpact: true })
    const without = await run()
    expect(withImpact.grade).toBe(without.grade)
    expect(withImpact.action).toBe(without.action)
  })
})
