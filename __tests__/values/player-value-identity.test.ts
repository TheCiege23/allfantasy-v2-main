import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FantasyCalcPlayer } from '@/lib/fantasycalc'
import type { ValuationContext } from '@/lib/hybrid-valuation'

const historical = vi.hoisted(() => vi.fn())
const analytics = vi.hoisted(() => vi.fn())
const playerRows = vi.hoisted(() => new Map<string, Record<string, unknown>>())
const searchRows = vi.hoisted(() => [] as Array<Record<string, unknown>>)
const identityResolve = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/data/players', () => ({ getPlayer: async (id: string) => playerRows.get(id) ?? null, searchPlayers: async () => searchRows }))
vi.mock('@/lib/shared-services/player-identity/PlayerIdentityResolver', () => ({ resolvePlayer: identityResolve }))
vi.mock('@/lib/historical-values', () => ({ getHistoricalPlayerValue: historical, getHistoricalPickValueWeighted: vi.fn() }))
vi.mock('@/lib/player-analytics', () => ({ getPlayerAnalytics: analytics }))
vi.mock('@/lib/fantasycalc-db', () => ({ getFantasyCalcValuesDbFirst: vi.fn(async () => []) }))
import { pricePlayer } from '@/lib/hybrid-valuation'
import { resolveAssets } from '@/lib/trade-value-console/leagueTradePricing'
import { gradeInputsFromPending } from '@/lib/decision-os/trade/tradeGradeInputs'
import { gradeTrade } from '@/lib/decision-os/trade/tradeGrade'
import { buildPendingTradeOfferEmail } from '@/lib/trade-intel/tradeGradeEmail'

const receiver = { value: 9000, redraftValue: 7000, positionRank: 1,
  player: { name: 'Justin Jefferson', sleeperId: 'wr', position: 'WR', maybeAge: 27 },
} as FantasyCalcPlayer
const ambiguous = { code: 'ambiguous_identity' as const, label: 'Multiple players share this name; choose a player ID' }
const gap = { code: 'idp_no_history' as const, label: 'No defensive game history on file for this player' }
const ctx = (): ValuationContext => ({
  asOfDate: new Date().toISOString().slice(0, 10), isSuperFlex: false, fantasyCalcPlayers: [receiver],
  leagueValueByNameLower: new Map(),
  leagueValueBySleeperId: new Map([['lb', { value: 1200, position: 'LB', basis: 'idp-vorp' }]]),
  leagueUnpricedReasonByNameLower: new Map([['justin jefferson', ambiguous]]),
})
beforeEach(() => { playerRows.clear(); searchRows.length = 0; identityResolve.mockReset(); identityResolve.mockResolvedValue({ confidence: 'none' }); historical.mockReturnValue({ value: 8000, snapshotDate: '2026-09-26' }); analytics.mockResolvedValue(null) })

describe('identity-safe player trade pricing', () => {
  it('retains the priced defender board projection without a general player record', async () => {
    const nflCtx = ctx()
    nflCtx.leagueValueBySleeperId = new Map([['lb', {
      value: 1200, position: 'LB', basis: 'idp-vorp', sleeperId: 'lb',
      projection: { points: 17.1, season: 2026, week: 3 },
    }]])
    const resolved = await resolveAssets([{ kind: 'player', name: 'Justin Jefferson',
      providerIdentity: { provider: 'sleeper', id: 'lb', position: 'LB' },
    }], { effectiveSport: 'NFL', nflCtx, fcPlayers: [receiver], waiverBudget: 100, dataGaps: [] })
    expect(resolved.lines[0]).toMatchObject({ marketValue: 1200, effectiveProjection: 17.1,
      projectionSource: 'league_idp_history', projectionScope: { season: 2026, week: 3 } })
    expect(resolved.lines[0].projectionNotes?.join(' ')).toContain('Live injury and weather adjustments are not included')
    const offense = await resolveAssets([{ kind: 'player', name: 'Justin Jefferson',
      providerIdentity: { provider: 'sleeper', id: 'wr', position: 'WR' },
    }], { effectiveSport: 'NFL', nflCtx, fcPlayers: [receiver], waiverBudget: 100, dataGaps: [] })
    expect(offense.lines[0].effectiveProjection).toBeUndefined()
  })
  it('refuses ambiguous college names and never replaces a missing selected ID with a name hit', async () => {
    searchRows.push(...['college-1', 'college-2'].map(id => ({ id, sport: 'NCAAF', name: 'Same College Name',
      position: 'QB', team: 'College', dynastyValue: 10, projections: {} })))
    const opts = { effectiveSport: 'NCAAF' as const, nflCtx: ctx(), fcPlayers: [receiver], waiverBudget: 100, dataGaps: [] }
    expect((await resolveAssets([{ kind: 'player', name: 'Same College Name' }], opts)).unresolved).toEqual(['Same College Name'])
    searchRows.pop()
    expect((await resolveAssets([{ kind: 'player', name: 'Same College Name', playerId: 'missing-id' }], opts)).unresolved).toEqual(['Same College Name'])
  })
  it('prices a verified Yahoo cross-provider match and rejects a position conflict', async () => {
    identityResolve.mockResolvedValue({ confidence: 'name_match_confident', player: {
      sport: 'NFL', canonicalName: 'Justin Jefferson', position: 'LB', team: 'CLE', providerIds: { sleeper: 'lb' },
    } })
    const opts = { effectiveSport: 'NFL' as const, nflCtx: ctx(), fcPlayers: [receiver], waiverBudget: 100, dataGaps: [] }
    const good = await resolveAssets([{ kind: 'player', name: 'Justin Jefferson', providerIdentity: { provider: 'yahoo', id: '123', position: 'LB' } }], opts)
    expect(good.lines[0]).toMatchObject({ marketValue: 1200, position: 'LB' })
    const conflict = await resolveAssets([{ kind: 'player', name: 'Justin Jefferson', providerIdentity: { provider: 'yahoo', id: '123', position: 'WR' } }], opts)
    expect(conflict.lines).toEqual([])
    expect(conflict.unresolved).toEqual(['Justin Jefferson'])
  })
  it('preserves pending-offer identities through pricing, the shared grade and email rendering', async () => {
    const assets = [
      { playerId: 'lb', playerName: 'Justin Jefferson', position: 'LB', team: 'CLE', isPick: false },
      { playerId: 'wr', playerName: 'Justin Jefferson', position: 'WR', team: 'MIN', isPick: false },
    ]
    const inputs = gradeInputsFromPending(assets, 'sleeper')
    expect(inputs.unpriceable).toEqual([])
    const resolved = await resolveAssets(inputs.assets, { effectiveSport: 'NFL', nflCtx: ctx(), fcPlayers: [receiver], waiverBudget: 100, dataGaps: [] })
    expect(resolved.lines.map(l => l.marketValue)).toEqual([1200, 9000])
    const grade = gradeTrade({ giveValue: 10200, getValue: 9000, giveMarket: 10200, getMarket: 9000,
      unpriced: 0, giveCount: 2, getCount: 1, basis: 'Dynasty', scoringApplied: false, needApplied: false, needGap: null,
      lines: [...resolved.lines.map(l => ({ side: 'give' as const, name: l.name, marketValue: l.marketValue, leagueValue: l.marketValue })),
        { side: 'get', name: 'Incoming', marketValue: 9000, leagueValue: 9000 }], moves: [] })
    const { html } = buildPendingTradeOfferEmail({ leagueName: 'IDP', proposerName: 'Manager', youGive: assets,
      youGet: [{ ...assets[1], playerName: 'Incoming' }], grade,
      reviewUrl: 'https://allfantasy.ai/core/trades', baseUrl: 'https://allfantasy.ai' })
    expect(html).toContain('1,200')
    expect(html).toContain('9,000')
    expect(html.indexOf('1,200')).toBeLessThan(html.indexOf('9,000'))
  })
  it('prices each same-name asset using its ID, including the receiver control', async () => {
    expect(await pricePlayer('Justin Jefferson', ctx(), { sleeperId: 'lb', position: 'LB' })).toMatchObject({ value: 1200, source: 'idp-vorp', position: 'LB' })
    expect(await pricePlayer('Justin Jefferson', ctx(), { sleeperId: 'wr', position: 'WR' })).toMatchObject({ value: 9000, source: 'fantasycalc', position: 'WR' })
  })
  it('refuses an ambiguous name-only trade rather than taking the receiver price', async () => {
    expect(await pricePlayer('Justin Jefferson', ctx())).toMatchObject({ unpriced: true, unpricedReason: ambiguous })
  })
  it('does not borrow a historical name price when an explicit offensive ID has no match', async () => {
    expect(await pricePlayer('Unlisted Receiver', ctx(), { sleeperId: 'unlisted', position: 'WR' }))
      .toMatchObject({ unpriced: true, position: 'WR' })
  })
  it('preserves the defensive history refusal without borrowing market, historical or draft value', async () => {
    const context = { ...ctx(), leagueValueBySleeperId: new Map(), leagueUnpricedReasonBySleeperId: new Map([['lb', gap]]) }
    analytics.mockResolvedValue({ position: 'WR', draft: { lifetimeValue: 8500 } })
    expect(await pricePlayer('Justin Jefferson', context, { sleeperId: 'lb', position: 'LB' })).toMatchObject({ unpriced: true, position: 'LB', unpricedReason: gap })
  })
  it('refuses a conflicting market ID even when names and positions match', async () => {
    expect(await pricePlayer('Justin Jefferson', ctx(), { sleeperId: 'other-wr', position: 'WR' })).toMatchObject({ unpriced: true, unpricedReason: { code: 'ambiguous_identity' } })
  })
  it('does not apply a current defender board or receiver history to a past defender trade', async () => {
    expect(await pricePlayer('Justin Jefferson', { ...ctx(), asOfDate: '2024-09-01' }, { sleeperId: 'lb', position: 'LB' })).toMatchObject({ unpriced: true, position: 'LB' })
  })
  it('prices selected roster IDs through the real console pricer with separate positions, teams and enrichment IDs', async () => {
    playerRows.set('lb', { id: 'NFL:lb', name: 'Justin Jefferson', position: 'LB', team: 'CLE', dataSource: 'sleeper' })
    playerRows.set('wr', { id: 'NFL:wr', name: 'Justin Jefferson', position: 'WR', team: 'MIN', dataSource: 'sleeper' })
    const result = await resolveAssets([{ kind: 'player', playerId: 'lb' }, { kind: 'player', playerId: 'wr' }],
      { effectiveSport: 'NFL', nflCtx: ctx(), fcPlayers: [receiver], waiverBudget: 100, dataGaps: [] })
    expect(result.lines).toMatchObject([
      { marketValue: 1200, position: 'LB', team: 'CLE', enrichmentPlayerId: 'lb', pricedSource: 'idp_league' },
      { marketValue: 9000, position: 'WR', team: 'MIN', enrichmentPlayerId: 'wr', pricedSource: 'fantasycalc' },
    ])
  })
  it('keeps an identified defender unpriced on console review and reports his exact history gap', async () => {
    playerRows.set('lb', { id: 'NFL:lb', name: 'Justin Jefferson', position: 'LB', team: 'CLE', dataSource: 'sleeper' })
    const dataGaps: string[] = []
    const result = await resolveAssets([{ kind: 'player', playerId: 'lb' }], {
      effectiveSport: 'NFL', fcPlayers: [receiver], waiverBudget: 100, dataGaps,
      nflCtx: { ...ctx(), leagueValueBySleeperId: new Map(), leagueUnpricedReasonBySleeperId: new Map([['lb', gap]]) },
    })
    expect(result.lines[0]).toMatchObject({ unpriced: true, unpricedReason: gap, position: 'LB', team: 'CLE' })
    expect(dataGaps).toContain(`Justin Jefferson: ${gap.label}.`)
  })
  it('uses the ID-matched market name when a stale input label disagrees and no player row is cached', async () => {
    const result = await resolveAssets([{ kind: 'player', playerId: 'wr', name: 'Wrong label' }],
      { effectiveSport: 'NFL', nflCtx: ctx(), fcPlayers: [receiver], waiverBudget: 100, dataGaps: [], resolveEnrichmentIds: false })
    expect(result.lines[0]).toMatchObject({ name: 'Justin Jefferson', marketValue: 9000, position: 'WR' })
  })
  it('preserves a provider-qualified missing defender instead of borrowing the same-name receiver price', async () => {
    const result = await resolveAssets([{ kind: 'player', name: 'Justin Jefferson', providerIdentity: { provider: 'sleeper', id: 'no-history', position: 'LB' } }],
      { effectiveSport: 'NFL', nflCtx: { ...ctx(), leagueUnpricedReasonBySleeperId: new Map([['no-history', gap]]) }, fcPlayers: [receiver], waiverBudget: 100, dataGaps: [] })
    expect(result.lines[0]).toMatchObject({ unpriced: true, position: 'LB', unpricedReason: gap })
  })
  it('never interprets a Yahoo number as a Sleeper player, even when that number has a market price', async () => {
    const result = await resolveAssets([{ kind: 'player', name: 'Justin Jefferson', providerIdentity: { provider: 'yahoo', id: 'wr', position: 'WR' } }],
      { effectiveSport: 'NFL', nflCtx: ctx(), fcPlayers: [receiver], waiverBudget: 100, dataGaps: [] })
    expect(result.lines).toEqual([])
    expect(result.unresolved).toEqual(['Justin Jefferson'])
    expect(identityResolve).toHaveBeenCalledWith(expect.objectContaining({ provider: 'yahoo', sourceId: 'wr' }))
  })
})
