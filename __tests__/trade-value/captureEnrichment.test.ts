/**
 * Phase 2 — the redraft capture path stopped hardcoding its value sources to null.
 *
 * 🛑 WHAT THIS CLOSES. `captureRedraftTradeValueSnapshot` wrote three of five sources as `null`:
 *
 *     rankingValue:     null   "deferred"
 *     fantasyCalcValue: null   "live external API excluded from the write path"
 *     idpValue:         null   "this write path carries no league scoring or slots"
 *
 * Every stated reason was obsolete. The consequence was a SPLIT BRAIN: the trade UI rendered an
 * enriched Decision OS memo while the PERSISTED snapshot — the one Chimmy reads — carried
 * projection and ADP alone. Two numbers for one trade, and Chimmy quoted the poorer one.
 *
 * The fix shares `resolveTradeEnrichment` rather than re-implementing it, so the two paths cannot
 * drift. These tests pin the sharing, not a duplicate implementation.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

const calls: { enrichment: unknown[] } = { enrichment: [] }

// What the shared resolver will return. Set per test.
let enrichmentReturn: unknown = { enrichment: {} }

vi.mock('@/lib/decision-os/trade/enrichmentPort', () => ({
  resolveTradeEnrichment: vi.fn(async (args: unknown) => {
    calls.enrichment.push(args)
    return enrichmentReturn
  }),
}))

const BASE_LEAGUE = {
  starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'LB', 'LB', 'DB'],
  settings: { rec: 1, bonus_rec_te: 0.5 } as Record<string, unknown>,
  rosterSize: 18,
  irSlots: 2,
  taxiSlots: 0,
  /*
   * ⚠ THESE THREE WERE ABSENT AND THE SUITE STILL PASSED, which is why they are called out.
   * `captureSnapshot` used to hardcode `leagueType: 'redraft'` into the context it built, so the
   * league row's real format never reached the value engine and no test could tell. They are
   * present now so a mock resembles the row the code actually selects.
   */
  leagueType: 'redraft' as string | null,
  isDynasty: false as boolean | null,
  keeperCount: 0 as number | null,
}

// Reassigned per test; the prisma mock reads it at call time.
let league: Record<string, unknown> = { ...BASE_LEAGUE }

let written: Record<string, unknown> | null = null

vi.mock('@/lib/prisma', () => ({
  prisma: {
    adpDataRecord: { findMany: vi.fn(async () => []) },
    redraftRoster: {
      count: vi.fn(async () => 12),
      findUnique: vi.fn(async () => ({
        id: 'r1', wins: 5, losses: 3, ties: 0, pointsFor: 900, playoffSeed: 3,
        players: [{ position: 'WR' }, { position: 'RB' }],
      })),
    },
    league: { findUnique: vi.fn(async () => league) },
    redraftTradeValueSnapshot: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        written = args.data
        return args.data
      }),
    },
  },
}))

import { captureRedraftTradeValueSnapshot } from '@/lib/trade-value/captureSnapshot'

const baseInput = {
  proposalId: 'p1',
  seasonId: 's1',
  leagueId: 'L1',
  proposerRosterId: 'r1',
  receiverRosterId: 'r2',
  sport: 'NFL',
  scoring: 'ppr',
  rosterFormat: 'standard',
  currentSeason: 2026,
  assets: [
    {
      fromRosterId: 'r1', toRosterId: 'r2', assetType: 'player',
      playerId: '7679', playerName: 'Alim McNeill',
      metadata: { position: 'DT', team: 'DET' },
    },
    {
      fromRosterId: 'r2', toRosterId: 'r1', assetType: 'player',
      playerId: '6813', playerName: 'Jonathan Taylor',
      metadata: { position: 'RB', team: 'IND', restOfSeasonProjection: 240 },
    },
  ],
}

const payload = () => (written?.payload ?? {}) as { sides: Array<{ assets: Array<Record<string, unknown>> }> }
const assetFor = (name: string) =>
  payload().sides.flatMap((s) => s.assets).find((a) => a.playerName === name) as
    | { sources: Record<string, number | null>; internalValue: number }
    | undefined

beforeEach(() => {
  league = { ...BASE_LEAGUE }
  calls.enrichment = []
  written = null
  enrichmentReturn = { enrichment: {} }
})

describe('the three hardcoded nulls are filled from the shared resolver', () => {
  it('writes market value and IDP value that used to be null', async () => {
    enrichmentReturn = {
      enrichment: {
        marketValueByPlayerId: { '6813': 7200 },
        idpValueByPlayerId: { '7679': 2400 },
        adpByPlayerId: { '6813': 14 },
      },
    }

    await captureRedraftTradeValueSnapshot(baseInput as never)

    expect(assetFor('Jonathan Taylor')!.sources.fantasyCalcValue).toBe(7200)
    expect(assetFor('Alim McNeill')!.sources.idpValue).toBe(2400)
    expect(assetFor('Jonathan Taylor')!.sources.adpValue).toBe(14)
  })

  it('an IDP defender now prices from his league value instead of ~nothing', async () => {
    enrichmentReturn = { enrichment: { idpValueByPlayerId: { '7679': 2400 } } }
    await captureRedraftTradeValueSnapshot(baseInput as never)
    // idpValue short-circuits the engine, so the defender is worth his league value.
    expect(assetFor('Alim McNeill')!.internalValue).toBe(2400)
  })

  it('rankingValue stays null — deliberately, not deferred', async () => {
    // Nothing produces a ranking on this scale and computeConfidence does not read it.
    await captureRedraftTradeValueSnapshot(baseInput as never)
    expect(assetFor('Alim McNeill')!.sources.rankingValue).toBeNull()
  })
})

describe('the resolver is told what it needs, or it silently returns null', () => {
  it('supplies valueFormat — without it the market source is skipped entirely', async () => {
    await captureRedraftTradeValueSnapshot(baseInput as never)
    const args = calls.enrichment[0] as { valueFormat?: { format: string; qbFormat: string } }
    expect(args.valueFormat).toEqual({ format: 'REDRAFT', qbFormat: 'ONE_QB' })
  })

  it('derives SUPERFLEX from real roster slots, not from a scoring label', async () => {
    league.starters = ['QB', 'RB', 'WR', 'TE', 'SUPER_FLEX', 'K', 'DEF']
    await captureRedraftTradeValueSnapshot(baseInput as never)
    const args = calls.enrichment[0] as { valueFormat?: { qbFormat: string } }
    expect(args.valueFormat!.qbFormat).toBe('SUPERFLEX')
    league.starters = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'LB', 'LB', 'DB']
  })

  it("supplies idpLeague with the league's OWN slots and team count", async () => {
    await captureRedraftTradeValueSnapshot(baseInput as never)
    const args = calls.enrichment[0] as {
      idpLeague?: { leagueId: string; starterSlots: string[]; numTeams: number }
    }
    expect(args.idpLeague!.leagueId).toBe('L1')
    expect(args.idpLeague!.numTeams).toBe(12)
    expect(args.idpLeague!.starterSlots).toContain('LB')
  })
})

describe('honest degradation — a resolver failure must not lose what already worked', () => {
  it('falls back to client metadata for the projection', async () => {
    enrichmentReturn = { enrichment: {} } // resolver knows nothing
    await captureRedraftTradeValueSnapshot(baseInput as never)
    // metadata.restOfSeasonProjection was 240 and must still be used.
    expect(assetFor('Jonathan Taylor')!.sources.projectionValue).toBe(240)
  })

  it('prefers the resolver projection over client metadata when both exist', async () => {
    enrichmentReturn = { enrichment: { projectionByPlayerId: { '6813': 311 } } }
    await captureRedraftTradeValueSnapshot(baseInput as never)
    // The engine's own number beats whatever the client happened to send.
    expect(assetFor('Jonathan Taylor')!.sources.projectionValue).toBe(311)
  })

  it('survives the resolver throwing, and still writes a snapshot', async () => {
    const mod = await import('@/lib/decision-os/trade/enrichmentPort')
    ;(mod.resolveTradeEnrichment as unknown as { mockRejectedValueOnce: (e: Error) => void })
      .mockRejectedValueOnce(new Error('boom'))
    await captureRedraftTradeValueSnapshot(baseInput as never)
    expect(written).not.toBeNull()
    // The client-supplied projection is still there — the path degrades, it does not fail.
    expect(assetFor('Jonathan Taylor')!.sources.projectionValue).toBe(240)
  })

  it('leaves a source null rather than zero when the resolver has nothing for it', async () => {
    enrichmentReturn = { enrichment: {} }
    await captureRedraftTradeValueSnapshot(baseInput as never)
    // 🛑 null means "not known"; 0 would mean "worth nothing" and the grader acts on that.
    expect(assetFor('Alim McNeill')!.sources.fantasyCalcValue).toBeNull()
    expect(assetFor('Alim McNeill')!.sources.idpValue).toBeNull()
  })
})

describe('🛑 the league\'s real format reaches the value engine', () => {
  /*
   * WHAT THIS CLOSES, AND WHY THE OTHER GUILLOTINE TEST IS NOT ENOUGH.
   * `__tests__/trade-value/guillotineReachability.test.ts` proves the RESOLVER maps a guillotine
   * league to `guillotineModel`. It cannot prove this file hands it a guillotine league, because it
   * calls `applyFormatFit` directly. That is the same gap that nearly shipped `assetState` as dead
   * code: the model worked, and nothing on the real path ever called it with anything.
   *
   * So these assert through `computeRedraftTradeValueSnapshot` — the function production uses.
   */
  it('carries leagueType from the row, not a literal', async () => {
    league = { ...BASE_LEAGUE, leagueType: 'guillotine' }
    const snap = await captureRedraftTradeValueSnapshot(baseInput)
    expect(snap.context.leagueType).toBe('guillotine')
  })

  it('carries aliasTags from conceptRules.extensions', async () => {
    league = {
      ...BASE_LEAGUE,
      leagueType: 'guillotine',
      settings: {
        ...BASE_LEAGUE.settings,
        conceptRules: { concept: 'guillotine', version: 1, extensions: { aliasTags: ['idp'] } },
      },
    }
    const snap = await captureRedraftTradeValueSnapshot(baseInput)
    expect(snap.context.aliasTags).toEqual(['idp'])
    // And the modifier tag must not drag the format back to redraft.
    expect(snap.context.leagueType).toBe('guillotine')
  })

  it('carries the keeper and dynasty fallbacks the resolver needs', async () => {
    league = { ...BASE_LEAGUE, leagueType: null, isDynasty: true, keeperCount: 3 }
    const snap = await captureRedraftTradeValueSnapshot(baseInput)
    expect(snap.context.isDynasty).toBe(true)
    expect(snap.context.keeperCount).toBe(3)
  })

  it('still says redraft when the row says redraft — no behaviour change for the common case', async () => {
    league = { ...BASE_LEAGUE }
    const snap = await captureRedraftTradeValueSnapshot(baseInput)
    expect(snap.context.leagueType).toBe('redraft')
    expect(snap.context.aliasTags).toEqual([])
  })
})
