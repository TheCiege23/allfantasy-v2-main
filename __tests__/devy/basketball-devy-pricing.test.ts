/**
 * NCAAB → NBA devy prospects (owner, 2026-11-28): an NBA devy league's trades are graded like an NBA dynasty
 * league's, and a held college prospect prices ONLY where something measured prices him — a verified
 * pre-draft NBA rank for the next draft, read onto the league's own NBA rookie pick curve. Everything else
 * stays "unmeasured", and no college basketball prospect ever reaches the NFL (FantasyCalc) devy option.
 *
 * The loader half runs `loadSportPointsBase` for real against a stubbed database, because that is where the
 * devy refusal lived: a grader handed a pre-built dynasty context would have passed before the change.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  projections: [] as Array<{ playerId: string; playerName: string; position: string; season: number; adjustmentFactors: unknown }>,
  games: [] as Array<{ homeTeam: string; awayTeam: string; seasonType: string | null; startTime: Date }>,
  identities: [] as Array<{ id: string; rollingInsightsId: string | null; sleeperId: string | null; canonicalName?: string }>,
  cache: [] as Array<{ cacheKey: string; data: unknown; expiresAt: Date }>,
  sportsPlayers: [] as Array<{ source: string; externalId: string; sleeperId: string | null; age: number | null }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    aFProjectionSnapshot: {
      findFirst: vi.fn(async () => (db.projections.length ? { season: db.projections[0]!.season } : null)),
      findMany: vi.fn(async () => db.projections),
    },
    sportsGame: {
      findFirst: vi.fn(async () => (db.games.length ? { id: 'g' } : null)),
      findMany: vi.fn(async ({ where }: { where: { startTime: { gte: Date } } }) => db.games.filter((g) => g.startTime >= where.startTime.gte)),
    },
    playerIdentityMap: { findMany: vi.fn(async () => db.identities) },
    sportsPlayer: { findMany: vi.fn(async () => db.sportsPlayers) },
    fantasyStatLine: { findMany: vi.fn(async () => []) },
    roster: { findMany: vi.fn(async () => []) },
    draftSession: { findMany: vi.fn(async () => []) },
    sportsDataCache: {
      findMany: vi.fn(async () => db.cache),
      findUnique: vi.fn(async ({ where }: { where: { cacheKey: string } }) => db.cache.find((r) => r.cacheKey === where.cacheKey) ?? null),
    },
  },
}))

import { loadSportPointsBase } from '@/lib/decision-os/trade/sportPointsContext'
import { createSportPointsGrader } from '@/lib/decision-os/trade/sportPointsGrader'
import { multiSeasonFormatReason } from '@/lib/decision-os/trade/sportPointsValue'
import { resolveConceptGrading } from '@/lib/decision-os/trade/conceptGradingRegistry'
import { applyDevyPricing, priceHeldDevyAssets, type HeldDevyPlayer } from '@/lib/decision-os/trade/leagueAssetRules'
import { createLeagueAssetPolicy } from '@/lib/decision-os/trade/leagueAssetPolicy'
import { devyOptionValue } from '@/lib/devy/devyOptionValue'
import { loadDevyCandidates, searchOpenMarketDevy } from '@/lib/devy/openMarketDevy'
import type { PricedAsset } from '@/lib/hybrid-valuation'
import type { TradeConsolePlayerLine } from '@/lib/trade-value-console/types'

const NOW = new Date('2026-10-20T12:00:00Z')
const college = (n: number) => `espn:ncaab:${100 + n}`

function nbaPlayer(id: string, name: string, points: number, age: number) {
  db.projections.push({
    playerId: id, playerName: name, position: 'C', season: 2026,
    adjustmentFactors: { perGameRates: { points }, confidenceReasons: ['60 games in the season sample'], sourceSeason: 2025 },
  })
  db.identities.push({ id, canonicalName: name, rollingInsightsId: `ri-${id}`, sleeperId: null })
  db.sportsPlayers.push({ source: 'rolling_insights', externalId: `ri-${id}`, sleeperId: null, age })
}

/** A licensed pre-draft board for the 2027 NBA draft, in the shape `importNbaProspectRanks` stores. */
function rankBoard(players: Array<{ n: number; rank: number }>, draftYear = 2027) {
  db.cache.push({
    cacheKey: `trade:nba:prospect-ranks:${draftYear}`,
    expiresAt: new Date(NOW.getTime() + 20 * 86_400_000),
    data: {
      source: 'Licensed board', publishedAt: '2026-10-10T00:00:00Z', draftYear, rankBasis: 'nba_draft_projection',
      players: players.map(({ n, rank }) => ({ playerId: college(n), name: `College ${n}`, rank })),
    },
  })
}

const devyLeague = { id: 'L', platform: 'manual', settings: { scoring_mode: 'points' }, leagueType: 'devy', leagueSize: 2, season: 2026, status: 'in_season' }
const gradeIn = (league: typeof devyLeague) =>
  createSportPointsGrader({ sport: 'NBA', league }, { loadBase: (args) => loadSportPointsBase({ ...args, now: NOW }) })!

beforeEach(() => {
  db.projections = []
  db.games = []
  db.identities = []
  db.cache = []
  db.sportsPlayers = []
  nbaPlayer('vet', 'Veteran', 44, 30)
  nbaPlayer('kid', 'Youngster', 34, 21)
  nbaPlayer('kid2', 'Second Youngster', 30, 20)
  nbaPlayer('fa', 'Free Agent', 12, 27)
  // Depth, so the lineup-based replacement level has free agents below the starters.
  for (let i = 0; i < 40; i++) nbaPlayer(`depth${i}`, `Depth ${i}`, 11 - i * 0.1, 29)
  for (let i = 0; i < 40; i++) db.games.push({ homeTeam: 'T1', awayTeam: 'T2', seasonType: null, startTime: new Date(NOW.getTime() + (i + 1) * 86_400_000) })
  rankBoard([1, 2, 3, 4, 5].map((n) => ({ n, rank: n })))
})

describe('an NBA devy league', () => {
  it('grades a trade of a ranked college prospect for an NBA player, on the NBA board', async () => {
    const out = await gradeIn(devyLeague).grade([{ kind: 'player', rosterPlayerId: college(1), name: 'College 1' }], [{ kind: 'player', playerId: 'kid', name: 'Youngster' }])
    expect(out, JSON.stringify(out)).toMatchObject({ graded: true })
    if (!out.graded) return
    const prospect = out.lines!.find((l) => l.name === 'College 1')!
    const pro = out.lines!.find((l) => l.name === 'Youngster')!
    // One scale: the prospect is the rookie pick curve, the pro is points over replacement, both NBA dynasty units.
    expect(prospect).toMatchObject({ source: 'nba-points-dynasty', valueSource: 'pick_curve', valueAsOf: '2026-10-10T00:00:00Z' })
    expect(pro).toMatchObject({ source: 'nba-points-dynasty', valueSource: 'sport_projection' })
    expect(prospect.marketValue).toBeGreaterThan(0)
    expect(out.basis).toContain('pre-draft NBA rank')
  })

  it('withholds an unmeasured prospect rather than pricing him at zero', async () => {
    const unranked = await gradeIn(devyLeague).grade([{ kind: 'player', rosterPlayerId: college(9), name: 'College 9' }], [{ kind: 'player', playerId: 'kid' }])
    expect(unranked).toMatchObject({ graded: false, reason: expect.stringContaining('verified NBA prospect rank') })
    // Ranked, but for a later draft than the next one: the board measures the next class only.
    db.cache = []
    rankBoard([1, 2, 3, 4, 5].map((n) => ({ n, rank: n })), 2028)
    const later = await gradeIn(devyLeague).grade([{ kind: 'player', rosterPlayerId: college(1) }], [{ kind: 'player', playerId: 'kid' }])
    expect(later).toMatchObject({ graded: false })
  })

  it('grades pro-for-pro deals over five seasons, as an NBA dynasty league does', async () => {
    const dynasty = await gradeIn({ ...devyLeague, leagueType: 'dynasty' }).grade([{ kind: 'player', playerId: 'vet' }], [{ kind: 'player', playerId: 'kid' }])
    const devy = await gradeIn(devyLeague).grade([{ kind: 'player', playerId: 'vet' }], [{ kind: 'player', playerId: 'kid' }])
    expect(devy, JSON.stringify(devy)).toMatchObject({ graded: true })
    expect(devy).toEqual(dynasty)
  })

  it('opens only NBA devy: other daily sports keep the season-only refusal', () => {
    expect(multiSeasonFormatReason('devy', 'NBA')).toBeNull()
    for (const sport of ['NCAAB', 'NHL', 'MLB', 'SOCCER'] as const) expect(multiSeasonFormatReason('devy', sport)).toMatch(/count this season only/)
    expect(multiSeasonFormatReason('keeper', 'NBA')).toMatch(/count this season only/)
    expect(resolveConceptGrading({ type: 'devy', sport: 'NBA' }).rule.grader).toBe('sport_points')
  })
})

describe('the NFL devy option never prices a college basketball prospect', () => {
  const ncaafWr: HeldDevyPlayer = { devyPlayerId: 'f1', name: 'Ryan Williams', position: 'WR', sport: 'NCAAF', ppaSeasonTotal: 45, recruitingComposite: 0.98, recruitingStars: 5, draftEligibleYear: 2027 }
  const ncaabG: HeldDevyPlayer = { devyPlayerId: 'b1', name: 'Ryan Williams', position: 'G', sport: 'NCAAB', ppaSeasonTotal: null, recruitingComposite: null, recruitingStars: null, draftEligibleYear: 2027 }
  const unpricedLine = (name: string): TradeConsolePlayerLine => ({ name, unpriced: true } as TradeConsolePlayerLine)
  const unpricedAsset = (name: string): PricedAsset => ({ name, type: 'player', value: 0, unpriced: true, assetValue: { marketValue: 0, impactValue: 0, vorpValue: 0, volatility: 0 } } as PricedAsset)

  it('refuses a non-NCAAF prospect outright, whatever his position reads', () => {
    const asIfFootball = { position: 'WR', ppaSeasonTotal: 45, recruitingComposite: 0.98, recruitingStars: 5, draftEligibleYear: 2027, currentSeason: 2026 }
    expect(devyOptionValue({ ...asIfFootball, sport: 'NCAAF' }).value).toBeGreaterThan(0)
    const refused = devyOptionValue({ ...asIfFootball, sport: 'NCAAB' })
    expect(refused.value).toBeNull()
    expect(refused.basis).toMatch(/not a low value/)
  })

  it('ignores college basketball rows when matching a held prospect by name', () => {
    const control = applyDevyPricing({ inputs: [], lines: [unpricedLine('Ryan Williams')], priced: [unpricedAsset('Ryan Williams')], held: [ncaafWr], currentSeason: 2026 })
    const mixed = applyDevyPricing({ inputs: [], lines: [unpricedLine('Ryan Williams')], priced: [unpricedAsset('Ryan Williams')], held: [ncaafWr, ncaabG], currentSeason: 2026 })
    expect(control.devyPriced).toBe(1)
    expect(mixed.lines[0]).toEqual(control.lines[0])
    expect(mixed.lines[0]).toMatchObject({ position: 'WR', dataSource: 'devy-option' })
    const onlyBasketball = priceHeldDevyAssets({ prices: [unpricedAsset('Ryan Williams')], held: [ncaabG], currentSeason: 2026 })
    expect(onlyBasketball.devyPriced).toEqual([])
    expect(onlyBasketball.prices[0]!.unpriced).toBe(true)
    // The evaluator's first pass, with both rows held: the football prospect still prices.
    const evaluator = priceHeldDevyAssets({ prices: [unpricedAsset('Ryan Williams')], held: [ncaafWr, ncaabG], currentSeason: 2026 })
    expect(evaluator.devyPriced).toEqual(['Ryan Williams'])
    expect(evaluator.prices[0]).toMatchObject({ position: 'WR', source: 'devy-option', value: control.lines[0]!.marketValue })
  })

  it('reads only NCAAF rows for the open analyzer’s NFL board', async () => {
    const findMany = vi.fn(async () => [])
    await loadDevyCandidates({ devyPlayer: { findMany } }, { ids: ['x'], names: ['Ryan Williams'] })
    await searchOpenMarketDevy({ devyPlayer: { findMany } }, 'ryan')
    for (const call of findMany.mock.calls as unknown as Array<[{ where: Record<string, unknown> }]>) expect(call[0].where).toMatchObject({ sport: 'NCAAF' })
  })

  it('keeps an NBA league out of the NFL devy pricing path', async () => {
    const loadHeld = vi.fn(async () => [ncaabG])
    const policy = createLeagueAssetPolicy({ id: 'L', sport: 'NBA', leagueType: { type: 'devy' } as never, season: 2026 }, { loadHeld })
    const out = await policy.priceDevy({ inputs: [], lines: [unpricedLine('Ryan Williams')], priced: [unpricedAsset('Ryan Williams')] })
    expect(out.devyPriced).toBe(0)
    expect(loadHeld).not.toHaveBeenCalled()
  })
})
