import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FantasyCalcPlayer } from '@/lib/fantasycalc'
import type { ValuationContext } from '@/lib/hybrid-valuation'

const historical = vi.hoisted(() => vi.fn())
const analytics = vi.hoisted(() => vi.fn())
const playerRows = vi.hoisted(() => new Map<string, Record<string, unknown>>())
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/data/players', () => ({ getPlayer: async (id: string) => playerRows.get(id) ?? null, searchPlayers: async () => [] }))
vi.mock('@/lib/shared-services/player-identity/PlayerIdentityResolver', () => ({ resolvePlayer: async () => ({ confidence: 'none' }) }))
vi.mock('@/lib/historical-values', () => ({ getHistoricalPlayerValue: historical, getHistoricalPickValueWeighted: vi.fn() }))
vi.mock('@/lib/player-analytics', () => ({ getPlayerAnalytics: analytics }))
vi.mock('@/lib/fantasycalc-db', () => ({ getFantasyCalcValuesDbFirst: vi.fn(async () => []) }))
import { pricePlayer } from '@/lib/hybrid-valuation'
import { resolveAssets } from '@/lib/trade-value-console/leagueTradePricing'

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
beforeEach(() => { playerRows.clear(); historical.mockReturnValue({ value: 8000, snapshotDate: '2026-09-26' }); analytics.mockResolvedValue(null) })

describe('identity-safe player trade pricing', () => {
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
})
