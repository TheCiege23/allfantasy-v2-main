/**
 * The league trade chart made two provider calls a league could not use (Fantrax-scale simulation,
 * 2026-11-07):
 *
 *   - FantasyCalc's NFL chart for an NBA, NHL or MLB league — and a cold profile rethrows when the vendor
 *     fails, so an unreachable FantasyCalc failed the WHOLE grade for a sport that never reads the chart.
 *   - Sleeper's league info for a Fantrax / ESPN / native league, keyed by an id Sleeper has never seen
 *     (`loadLeagueTradeValues` is built from the Sleeper league): 63 calls across four leagues.
 *
 * The trade-learning capture also read FantasyCalc on every non-NFL proposal, then dropped the sample
 * because nothing in it was on the NFL chart.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  chart: vi.fn(async () => ({ players: [], syncedAt: null })),
  marketValues: vi.fn(async () => []),
  cached: vi.fn(async () => ({ players: [], syncedAt: null })),
  leagueValues: vi.fn(async () => ({ bySleeperId: new Map(), byNameLower: new Map(), unpricedReasonBySleeperId: new Map(), unpricedReasonByNameLower: new Map() })),
}))

vi.mock('server-only', () => ({}))
// Every other read the chart makes (FAAB balances, the week) answers "nothing on file".
vi.mock('@/lib/prisma', () => {
  const delegate = new Proxy({}, { get: () => vi.fn(async () => null) })
  return { prisma: new Proxy({}, { get: () => delegate }) }
})
vi.mock('@/lib/fantasycalc-db', async (load) => ({
  ...(await load<typeof import('@/lib/fantasycalc-db')>()),
  getFantasyCalcChartDbFirst: h.chart,
  getFantasyCalcValuesDbFirst: h.marketValues,
  readFantasyCalcValuesFromDb: h.cached,
}))
vi.mock('@/lib/league-values/leagueTradeValues', () => ({ loadLeagueTradeValues: h.leagueValues }))

import { resolveLeagueTradeChart } from '@/lib/trade-value-console/leagueTradePricing'
import { captureLiveTradeOffer } from '@/lib/league-trade-engine/tradeLearningCapture'

const leagueRow = (sport: string, platform: string | undefined, leagueSize: number | null = 12) =>
  ({ id: `lg-${sport}-${platform}`, sport, platform, platformLeagueId: 'source-league-1', leagueType: 'redraft', settings: {}, leagueSize, season: 2026, status: 'in_season' }) as never

const chartFor = (sport: string, platform: string | undefined) =>
  resolveLeagueTradeChart({ leagueRow: leagueRow(sport, platform), leagueSnapshot: null, leagueNormCtx: null })

beforeEach(() => {
  // mockReset, not mockClear: an unconsumed `mockRejectedValueOnce` would otherwise leak into the next test.
  h.chart.mockReset().mockImplementation(async () => ({ players: [], syncedAt: null }))
  h.marketValues.mockReset().mockImplementation(async () => [])
  h.leagueValues.mockClear()
  h.cached.mockClear()
})

describe('the FantasyCalc chart is read only where the NFL path reads it', () => {
  it.each(['NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'])('%s: not fetched, so a FantasyCalc outage cannot fail the grade', async (sport) => {
    h.chart.mockRejectedValueOnce(new Error('FantasyCalc API error: 503'))
    const chart = await chartFor(sport, 'fantrax')
    expect(h.chart).not.toHaveBeenCalled()
    expect(chart.fcPlayers).toEqual([])
  })

  it.each([['NFL', 'sleeper'], ['NFL', 'fantrax']])('%s (%s): fetched as before', async (sport, platform) => {
    await chartFor(sport, platform)
    expect(h.chart).toHaveBeenCalledTimes(1)
  })

  it('reads an existing 12-team dynasty profile for 150 teams without fetching', async () => {
    const league = { ...(leagueRow('NFL', 'manual', 150) as Record<string, unknown>), leagueType: 'dynasty' } as never
    const chart = await resolveLeagueTradeChart({ leagueRow: league, leagueSnapshot: null, leagueNormCtx: null })
    expect(h.chart).not.toHaveBeenCalled()
    expect(h.cached).toHaveBeenCalledWith(expect.objectContaining({ numTeams: 12, isDynasty: true }), { allowStale: false })
    expect(chart.nflCtx).toMatchObject({ numTeams: 150, largeLeagueRookiePicks: true })
  })

  it('a league of unknown sport (the console with no league) still gets it', async () => {
    await resolveLeagueTradeChart({ leagueRow: null, leagueSnapshot: null, leagueNormCtx: null })
    expect(h.chart).toHaveBeenCalledTimes(1)
  })
})

describe("the Sleeper-built league values are read only for a Sleeper league", () => {
  it.each(['fantrax', 'espn', 'manual'])('%s: not read — its id is not a Sleeper league id', async (platform) => {
    await chartFor('NFL', platform)
    expect(h.leagueValues).not.toHaveBeenCalled()
  })

  it('sleeper: read as before', async () => {
    await chartFor('NFL', 'sleeper')
    expect(h.leagueValues).toHaveBeenCalledWith(expect.objectContaining({ platformLeagueId: 'source-league-1' }))
  })

  it('a row that does not say its platform keeps the old behaviour', async () => {
    await chartFor('NFL', undefined)
    expect(h.leagueValues).toHaveBeenCalledTimes(1)
  })
})

it('discloses an assumed count and honors a stored large-league count', async () => {
  const read = (count: number | null) => resolveLeagueTradeChart({
    leagueRow: leagueRow('NBA', 'fantrax', count), leagueSnapshot: null, leagueNormCtx: null,
  })
  const unknown = await read(null)
  expect(unknown.leagueSize).toBe(12)
  expect(unknown.valuationGaps).toContain('This league has no verified team count. The grade uses 12 teams.')
  const large = await read(150)
  expect(large.leagueSize).toBe(150)
  expect(large.valuationGaps?.join(' ')).not.toContain('no verified team count')
})

describe('the trade-learning capture', () => {
  const offer = (sport: string) => ({
    tradeId: 't1',
    leagueId: 'lg',
    proposerRosterId: 'r1',
    receiverRosterId: 'r2',
    items: [{ itemType: 'player', itemReference: 'n0006j', fromRosterId: 'r1', toRosterId: 'r2' }],
    league: { id: 'lg', sport, settings: {}, leagueType: 'redraft', isDynasty: false } as never,
  })

  it.each(['NBA', 'NHL', 'MLB'])('%s: skips before the NFL chart read', async (sport) => {
    await expect(captureLiveTradeOffer(offer(sport) as never)).resolves.toBeNull()
    expect(h.marketValues).not.toHaveBeenCalled()
  })

  it('omits 150-team dynasty offers from the round-based learning sample', async () => {
    const input = offer('NFL')
    input.league = { ...(input.league as object), leagueSize: 150, leagueType: 'dynasty' } as never
    await expect(captureLiveTradeOffer(input as never)).resolves.toBeNull()
    expect(h.marketValues).not.toHaveBeenCalled()
  })

  it('NFL: still reads the chart', async () => {
    await captureLiveTradeOffer(offer('NFL') as never)
    expect(h.marketValues).toHaveBeenCalledTimes(1)
  })
})
