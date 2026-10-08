import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/push-notifications', () => ({ sendPushToUser: vi.fn() }))
vi.mock('@/lib/notifications/pushGate', () => ({ decidePushForUser: vi.fn() }))
vi.mock('@/lib/player-identity/resolveProviderRosterPlayers', () => ({ resolveProviderRosterPlayers: vi.fn() }))

import { groupProviderTrades, renderProviderTrade, type ProviderTradeRow } from '@/lib/provider-trades/providerTradeAlerts'
import { notifyProviderLeagueTrades, type ProviderTradeNotifyDeps } from '@/lib/provider-trades/notifyProviderLeagueTrades'

const AT = new Date('2026-10-07T07:08:00.955Z')
const NOW = new Date('2026-10-07T07:20:00.000Z')

/** The real ESPN shape from production (2026-10-07): ONE trade as TWO transactions, one per direction. */
const ESPN_SPLIT: ProviderTradeRow[] = [
  { platform: 'espn', platformLeagueId: '35510416', sideId: 'FF3B', transactionId: '9b07', tradeDate: AT, sport: 'nfl', playersReceived: ['4432620'], picksReceived: 0 },
  { platform: 'espn', platformLeagueId: '35510416', sideId: 'B3DB', transactionId: '9b07', tradeDate: AT, sport: 'nfl', playersReceived: [], picksReceived: 0 },
  { platform: 'espn', platformLeagueId: '35510416', sideId: 'B3DB', transactionId: '9ac4', tradeDate: AT, sport: 'nfl', playersReceived: ['3916387'], picksReceived: 0 },
  { platform: 'espn', platformLeagueId: '35510416', sideId: 'FF3B', transactionId: '9ac4', tradeDate: AT, sport: 'nfl', playersReceived: [], picksReceived: 0 },
]

describe('grouping provider trades', () => {
  it('merges ESPN’s two half-transactions into one trade with both sides', () => {
    const trades = groupProviderTrades(ESPN_SPLIT)
    expect(trades).toHaveLength(1)
    expect(trades[0]!.transactionIds.sort()).toEqual(['9ac4', '9b07'])
    expect(Object.fromEntries(trades[0]!.sides.map((s) => [s.sideId, s.players]))).toEqual({ FF3B: ['4432620'], B3DB: ['3916387'] })
  })

  it('keeps trades between different teams, or at different instants, apart', () => {
    const other = { ...ESPN_SPLIT[0]!, transactionId: 'x1', sideId: 'C0C0' }
    const later = ESPN_SPLIT.map((r) => ({ ...r, transactionId: `${r.transactionId}-l`, tradeDate: new Date(AT.getTime() + 60_000) }))
    expect(groupProviderTrades([...ESPN_SPLIT, other, ...later])).toHaveLength(3)
  })

  it('says who got what, never a raw provider id', () => {
    const [trade] = groupProviderTrades(ESPN_SPLIT)
    const names: Record<string, string> = { '4432620': 'Bijan Robinson' }
    const m = renderProviderTrade(trade!, 'Washington Pro Knockout', (s) => (s === 'FF3B' ? 'Gridiron Gang' : 'Hill Toppers'), (id) => names[id] ?? null)
    expect(m.title).toBe('Trade in Washington Pro Knockout')
    expect(m.body).toBe('Gridiron Gang gets Bijan Robinson · Hill Toppers gets a player')
    expect(m.body).not.toContain('3916387')
  })
})

let deps: ProviderTradeNotifyDeps
let claimed: Set<string>
let watermark: Date | null

beforeEach(() => {
  claimed = new Set()
  watermark = new Date(AT.getTime() - 60_000)
  deps = {
    now: () => NOW,
    readWatermark: vi.fn(async () => watermark),
    writeWatermark: vi.fn(async (at: Date) => {
      watermark = at
    }),
    loadRows: vi.fn(async () => ESPN_SPLIT.map((r, i) => ({ ...r, createdAt: new Date(AT.getTime() + 3_000 + i) }))),
    loadLeagues: vi.fn(async () => [
      {
        id: 'L-owner',
        name: 'Washington Pro Knockout',
        ownerUserId: 'u1',
        teams: [
          { claimedByUserId: 'u1', platformUserId: 'FF3B', externalId: '1', name: 'Gridiron Gang' },
          { claimedByUserId: 'u2', platformUserId: 'B3DB', externalId: '2', name: 'Hill Toppers' },
        ],
      },
    ]),
    resolvePlayers: vi.fn(async () => new Map([['4432620', { name: 'Bijan Robinson' }], ['3916387', { name: 'Ja’Marr Chase' }]])),
    allowPush: vi.fn(async () => true),
    claim: vi.fn(async (key: string) => {
      if (claimed.has(key)) return 'taken' as const
      claimed.add(key)
      return 'ours' as const
    }),
    release: vi.fn(async (key: string) => {
      claimed.delete(key)
    }),
    send: vi.fn(async () => true),
  }
})

describe('notifyProviderLeagueTrades', () => {
  it('pushes one trade to each AF member of the league, once, linked to their own copy', async () => {
    const r = await notifyProviderLeagueTrades({}, deps)
    expect(r).toMatchObject({ bootstrapped: false, trades: 1, sent: 2 })
    expect(vi.mocked(deps.send).mock.calls.map((c) => c[0]).sort()).toEqual(['u1', 'u2'])
    expect(vi.mocked(deps.send).mock.calls[0]![1]).toMatchObject({
      title: 'Trade in Washington Pro Knockout',
      body: 'Gridiron Gang gets Bijan Robinson · Hill Toppers gets Ja’Marr Chase',
      href: '/core/trades?league=L-owner',
      type: 'trade',
    })
    // The overlap re-reads the same rows next sweep; the claims stop a second push.
    expect(await notifyProviderLeagueTrades({}, deps)).toMatchObject({ sent: 0, skipped: 2 })
    expect(deps.send).toHaveBeenCalledTimes(2)
  })

  it('🛑 the first run remembers where it is and announces nothing', async () => {
    watermark = null
    expect(await notifyProviderLeagueTrades({}, deps)).toMatchObject({ bootstrapped: true, sent: 0 })
    expect(deps.loadRows).not.toHaveBeenCalled()
    expect(deps.writeWatermark).toHaveBeenCalledWith(NOW)
  })

  it('asks for rows past the watermark (with overlap) and only for fresh trades', async () => {
    const start = watermark!
    await notifyProviderLeagueTrades({}, deps)
    const [since, freshAfter] = vi.mocked(deps.loadRows).mock.calls[0]!
    expect(since.getTime()).toBe(start.getTime() - 15 * 60_000)
    // …and the watermark moves to the newest row read, so the next sweep starts there.
    expect(watermark!.getTime()).toBe(AT.getTime() + 3_003)
    expect(freshAfter.toISOString()).toBe(new Date(NOW.getTime() - 48 * 3_600_000).toISOString())
  })

  it('respects each person’s trade-alert switch', async () => {
    deps.allowPush = vi.fn(async (userId: string) => userId !== 'u2')
    expect(await notifyProviderLeagueTrades({}, deps)).toMatchObject({ sent: 1, skipped: 1 })
  })

  it('a push nobody received gives its claim back for the next sweep', async () => {
    deps.send = vi.fn(async (userId: string) => userId === 'u1')
    expect(await notifyProviderLeagueTrades({}, deps)).toMatchObject({ sent: 1 })
    expect([...claimed].some((k) => k.endsWith(':u2'))).toBe(false)
  })

  it('a league nobody on AllFantasy is in costs a count, not an error', async () => {
    deps.loadLeagues = vi.fn(async () => [])
    expect(await notifyProviderLeagueTrades({}, deps)).toMatchObject({ noRecipients: 1, sent: 0, errors: [] })
  })
})
