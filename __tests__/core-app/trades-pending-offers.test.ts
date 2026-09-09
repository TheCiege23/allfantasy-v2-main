/**
 * 🛑 THE TRADES SCREEN TOLD MANAGERS THE PRODUCT COULD NOT DO SOMETHING IT WAS
 * ALREADY DOING ONE SCREEN OVER.
 *
 * `getTradesData` hardcoded `inbox: { available: false, reason: 'pending offers
 * are not ingested — open your platform to see anything waiting' }`, with a
 * comment reasoning that nothing ingests them. The reasoning was sound and the
 * premise was false: `scanPendingSleeperTrades` reads exactly these offers live
 * off `platformLeagueId`, and the Trade Center has been serving them the whole
 * time. Nothing INGESTS them — true, and irrelevant, because they are never
 * meant to be written to a table.
 *
 * ⚠ WHAT THIS FILE GUARDS IS THE DISTINCTION, NOT THE HAPPY PATH. Four outcomes
 * have to stay apart, and the old code collapsed all four into one sentence that
 * claimed the wrong one:
 *
 *   scanned, offers        -> available, populated
 *   scanned, none waiting  -> AVAILABLE and EMPTY   ("we looked, nothing there")
 *   not scanned            -> unavailable, carrying the scan's own reason
 *   not Sleeper            -> unavailable, naming the platform
 *
 * The second is the one worth the most: an empty inbox that means "not scanned"
 * is a claim about the manager's league that nobody ever checked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const LEAGUE_ID = 'lg-1'
const USER_ID = 'user-1'
const SLEEPER_ID = '591462610482806784'

let leagueRow: Record<string, unknown> = {}
let scanResult: unknown = null
let claimedTeam: unknown = null
let profileRow: unknown = null

vi.mock('@/lib/provider-trades/scanPendingSleeperTrades', () => ({
  scanPendingSleeperTrades: vi.fn(async () => scanResult),
}))

vi.mock('@/lib/prisma', () => {
  const empty = new Proxy(
    {},
    {
      get: (_t, m: string) => {
        if (m === 'findMany' || m === 'groupBy') return async () => []
        if (m === 'count') return async () => 12
        return async () => null
      },
    },
  )
  const overrides: Record<string, Record<string, unknown>> = {
    league: { findUnique: async () => leagueRow },
    leagueTeam: {
      findFirst: async () => claimedTeam,
      findMany: async () => [],
      count: async () => 12,
    },
    userProfile: { findUnique: async () => profileRow },
  }
  const prisma = new Proxy(
    {},
    {
      get: (_t, model: string) => {
        const o = overrides[model]
        if (!o) return empty
        return new Proxy(o, {
          get: (t, m: string) =>
            (t as Record<string, unknown>)[m] ?? (empty as Record<string, unknown>)[m],
        })
      },
    },
  )
  return { prisma, default: prisma }
})

const load = async () => (await import('@/lib/core-app/trades')).getTradesData

const SLEEPER_LEAGUE = {
  id: LEAGUE_ID,
  name: 'KBFL',
  platform: 'sleeper',
  leagueType: 'dynasty',
  settings: {},
  platformLeagueId: '1338541390891606016',
  season: 2026,
  sport: 'NFL',
}

const OFFER_TO_ME = {
  transactionId: 'tx-in',
  proposedBy: 'Border Town Bandits',
  proposedByViewer: false,
  proposedAt: '2026-09-08T12:00:00.000Z',
  assetsGiven: [{ playerId: '1', playerName: 'My Guy', position: 'WR', team: 'DAL' }],
  assetsReceived: [{ playerId: '2', playerName: 'Their Guy', position: 'RB', team: 'PHI' }],
  readOnly: true as const,
  provider: 'sleeper' as const,
}
const OFFER_FROM_ME = { ...OFFER_TO_ME, transactionId: 'tx-out', proposedByViewer: true }

/** The exact sentence that used to print unconditionally. */
const RETIRED = 'pending offers are not ingested'

describe('pending offers reach the Trades screen', () => {
  beforeEach(() => {
    vi.resetModules()
    leagueRow = SLEEPER_LEAGUE
    claimedTeam = { platformUserId: SLEEPER_ID, externalId: '4' }
    profileRow = { sleeperUserId: SLEEPER_ID }
    scanResult = { trades: [], scanned: true, reason: null, weeksUnanswered: 0 }
  })

  it('splits offers into received and sent, viewer-relative in both directions', async () => {
    scanResult = { trades: [OFFER_TO_ME, OFFER_FROM_ME], scanned: true, reason: null, weeksUnanswered: 0 }
    const out = await (await load())(LEAGUE_ID, USER_ID)

    expect(out?.inbox.available).toBe(true)
    expect(out?.sent.available).toBe(true)
    if (!out?.inbox.available || !out.sent.available) throw new Error('unreachable')

    expect(out.inbox.data.map((o) => o.id)).toEqual(['tx-in'])
    expect(out.sent.data.map((o) => o.id)).toEqual(['tx-out'])

    /* `give` is what LEAVES the viewer's roster on BOTH sides. Flipping it for
       outgoing offers would render a manager's own proposal backwards, which
       reads as a plausible trade rather than as a bug. */
    expect(out.sent.data[0].give.map((l) => l.label)).toEqual(['My Guy'])
    expect(out.sent.data[0].get.map((l) => l.label)).toEqual(['Their Guy'])
    expect(out.inbox.data[0].give[0].sublabel).toBe('WR · DAL')
  })

  it('🛑 scanned-and-empty is AVAILABLE, so the screen can say "we looked"', async () => {
    // The whole point. `available: false` here would be indistinguishable from
    // never having looked, which is what the old hardcoded reason claimed.
    const out = await (await load())(LEAGUE_ID, USER_ID)
    expect(out?.inbox.available).toBe(true)
    if (!out?.inbox.available) throw new Error('unreachable')
    expect(out.inbox.data).toEqual([])
  })

  it('carries the scan’s OWN reason when the provider was not read', async () => {
    scanResult = {
      trades: [],
      scanned: false,
      reason: 'Sleeper did not answer for this league',
      weeksUnanswered: 18,
    }
    const out = await (await load())(LEAGUE_ID, USER_ID)
    expect(out?.inbox.available).toBe(false)
    if (out?.inbox.available !== false) throw new Error('unreachable')
    expect(out.inbox.reason).toBe('Sleeper did not answer for this league')
  })

  it('tells a manager what THEY can fix when nothing links them to a Sleeper account', async () => {
    // Neither an explicit claim on this league nor a linked account anywhere.
    claimedTeam = null
    profileRow = null
    const out = await (await load())(LEAGUE_ID, USER_ID)
    expect(out?.inbox.available).toBe(false)
    if (out?.inbox.available !== false) throw new Error('unreachable')
    expect(out.inbox.reason).toContain('claim your team')
    // Distinct from "the provider refused" — this one is an action for them.
    expect(out.inbox.reason).not.toContain('could not be reached')
  })

  it('names the platform rather than claiming the product cannot do it', async () => {
    leagueRow = { ...SLEEPER_LEAGUE, platform: 'espn', platformLeagueId: '999' }
    const out = await (await load())(LEAGUE_ID, USER_ID)
    expect(out?.inbox.available).toBe(false)
    if (out?.inbox.available !== false) throw new Error('unreachable')
    expect(out.inbox.reason).toContain('espn')
    expect(out.inbox.reason).toContain('Sleeper')
  })

  it('⚠ the retired sentence is gone on every path', async () => {
    const cases: unknown[] = [
      { trades: [OFFER_TO_ME], scanned: true, reason: null, weeksUnanswered: 0 },
      { trades: [], scanned: true, reason: null, weeksUnanswered: 0 },
      { trades: [], scanned: false, reason: 'Sleeper could not be reached', weeksUnanswered: 0 },
    ]
    for (const c of cases) {
      vi.resetModules()
      scanResult = c
      const out = await (await load())(LEAGUE_ID, USER_ID)
      const text = [
        out?.inbox.available === false ? out.inbox.reason : '',
        out?.sent.available === false ? out.sent.reason : '',
      ].join(' ')
      expect(text).not.toContain(RETIRED)
    }
  })
})
