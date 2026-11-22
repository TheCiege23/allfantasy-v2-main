/**
 * Manager records count a Fantrax league's trades from the commissioner's uploaded trade history (build item 6).
 *
 * Fantrax sends no trades; the upload writes them all-or-nothing, both sides at once, keyed `fantrax-csv:`. Only those
 * rows are read — trades inferred from roster snapshots stay out — and "nothing uploaded" or "owners match no team"
 * are reasons in words, never a league of managers reading "0 trades". Team and player names are invented.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({ histories: vi.fn(), players: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueTradeHistory: { findMany: m.histories } } }))
vi.mock('@/lib/decision-os/trade/tradePlayers', () => ({
  playerIdSpaceFor: () => 'fantrax',
  resolveTradePlayers: m.players,
}))

import { readFantraxUploadedTrades, storedTradeSidesToEdge } from '@/lib/competitive-edge/providerManagerHistory'

const side = (over: Record<string, unknown>) => ({
  transactionId: 'fantrax-csv:aaa',
  season: 2026,
  week: 10,
  tradeDate: new Date('2026-11-16T00:57:00.000Z'),
  createdAt: new Date('2026-11-18T00:00:00.000Z'),
  playersGiven: [],
  playersReceived: [],
  picksGiven: [],
  picksReceived: [],
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  m.players.mockResolvedValue(new Map([['fx-qb', { ok: true, position: 'QB' }]]))
})

describe('storedTradeSidesToEdge', () => {
  it('joins the two owners\' rows of one transaction into one trade with both sides', () => {
    const trades = storedTradeSidesToEdge(
      [
        { ownerId: 'fantrax-user:owls', trades: [side({ playersReceived: ['fx-qb'], picksGiven: [{ season: '2027', round: 1 }] })] },
        { ownerId: 'fantrax-user:comets', trades: [side({ playersGiven: ['fx-qb'], picksReceived: [{ season: '2027', round: 1 }] })] },
      ],
      (id) => (id === 'fx-qb' ? 'QB' : null),
    )
    expect(trades).toHaveLength(1)
    expect(trades[0]).toMatchObject({ id: 'fantrax-csv:aaa', season: '2026', week: 10, createdIso: '2026-11-16T00:57:00.000Z' })
    const owls = trades[0]!.sides.find((s) => s.ownerId === 'fantrax-user:owls')!
    expect(owls.playersIn).toEqual([{ position: 'QB' }])
    expect(owls.picksOut).toHaveLength(1)
    const comets = trades[0]!.sides.find((s) => s.ownerId === 'fantrax-user:comets')!
    expect(comets.playersOut).toEqual([{ position: 'QB' }])
    expect(comets.picksIn).toHaveLength(1)
  })
})

describe('readFantraxUploadedTrades', () => {
  const league = { platformLeagueId: 'fx-league', sport: 'NFL', platform: 'fantrax' }
  const owners = new Set(['fantrax-user:owls', 'fantrax-user:comets'])

  it('reads only the uploaded trades (fantrax-csv:), and counts them per owner', async () => {
    m.histories.mockResolvedValue([
      { sleeperUsername: 'fantrax-user:owls', trades: [side({ playersReceived: ['fx-qb'] })] },
      { sleeperUsername: 'fantrax-user:comets', trades: [side({ playersGiven: ['fx-qb'] })] },
    ])
    const out = await readFantraxUploadedTrades(league, owners, new Date('2026-11-19T00:00:00.000Z'))
    expect(m.histories.mock.calls[0]![0].select.trades.where).toEqual({
      platform: 'fantrax',
      transactionId: { startsWith: 'fantrax-csv:' },
    })
    expect(out.available).toBe(true)
    if (!out.available) return
    expect(out.data.trades).toHaveLength(1)
    expect(out.data.seasonsScanned).toEqual(['2026'])
    expect(out.data.historyGaps[0]).toMatch(/since the last upload/)
  })

  it('nothing uploaded is a reason pointing at the upload — never "0 trades"', async () => {
    m.histories.mockResolvedValue([{ sleeperUsername: 'fantrax-user:owls', trades: [] }])
    const out = await readFantraxUploadedTrades(league, owners)
    expect(out).toMatchObject({ available: false })
    expect(!out.available && out.reason).toMatch(/No Fantrax trade history has been uploaded/)
    expect(!out.available && out.reason).toMatch(/Commissioner → Trades and draft archive/)
  })

  it('owners that match no team in the league are a reason, not a league of zeros', async () => {
    m.histories.mockResolvedValue([{ sleeperUsername: 'fantrax-user:someone-else', trades: [side({})] }])
    const out = await readFantraxUploadedTrades(league, owners)
    expect(!out.available && out.reason).toMatch(/could not be matched/)
  })

  it('a league with no Fantrax id is a reason, with no read', async () => {
    const out = await readFantraxUploadedTrades({ ...league, platformLeagueId: null }, owners)
    expect(out.available).toBe(false)
    expect(m.histories).not.toHaveBeenCalled()
  })
})

describe('in Spanish', () => {
  it('every new reason and gap has a Spanish rendering, without «waiver»', async () => {
    const { coreUiCopy } = await import('@/lib/core-app/coreUiCopy')
    for (const english of [
      'No Fantrax trade history has been uploaded for this league yet. The commissioner adds it under Commissioner → Trades and draft archive.',
      'The uploaded Fantrax trades could not be matched to this league’s managers.',
      'This league has no Fantrax league id on file.',
      'Only trades in the uploaded Fantrax export are counted; trades made since the last upload are not.',
    ]) {
      const es = coreUiCopy(english, 'es')
      expect(es, english).not.toBe(english)
      expect(es.toLowerCase()).not.toContain('waiver')
    }
  })
})
