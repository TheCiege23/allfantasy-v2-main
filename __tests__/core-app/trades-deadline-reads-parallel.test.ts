/**
 * The Trade Center's two deadline reads run BESIDE the screen's sections, not after them.
 *
 * They used to be awaited one after another once grades, the Sleeper history, the pending-offer scan
 * and the agent ideas had all finished, so they added their own round trips to every Trades load.
 *
 * The test makes the history read wait until a deadline read has STARTED. Run side by side, the
 * deadline read starts and releases it; run after, nothing ever releases it and the load times out.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

let releaseHistory: () => void = () => {}
let historyGate = new Promise<void>((resolve) => {
  releaseHistory = resolve
})

vi.mock('@/lib/core-app/sleeperTradeHistory', () => ({
  getSleeperTradeHistory: vi.fn(async () => {
    await historyGate
    return null
  }),
}))

const COUNTDOWN = { label: 'deadline' }
const PICK_VIEW = { label: 'pick deadline' }
vi.mock('@/lib/trade-deadline/tradeDeadlineWindow', () => ({
  loadTradeDeadlineCountdown: vi.fn(async () => {
    releaseHistory()
    return COUNTDOWN
  }),
  loadPickTradeDeadlineView: vi.fn(async () => PICK_VIEW),
}))

vi.mock('@/lib/provider-trades/scanPendingSleeperTrades', () => ({
  scanPendingSleeperTrades: vi.fn(async () => ({ trades: [], scanned: true, reason: null, unscannedKind: null, weeksUnanswered: 0 })),
}))

const LEAGUE = {
  id: 'lg-1',
  name: 'KBFL',
  platform: 'sleeper',
  leagueType: 'redraft',
  settings: {},
  platformLeagueId: '1338541390891606016',
  season: 2026,
  sport: 'NFL',
}

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
    league: { findUnique: async () => LEAGUE },
    leagueTeam: {
      findFirst: async () => ({ platformUserId: '591462610482806784', externalId: '4' }),
      findMany: async () => [],
      count: async () => 12,
    },
    userProfile: { findUnique: async () => ({ sleeperUserId: '591462610482806784' }) },
  }
  const prisma = new Proxy(
    {},
    {
      get: (_t, model: string) => {
        const o = overrides[model]
        if (!o) return empty
        return new Proxy(o, {
          get: (t, m: string) => (t as Record<string, unknown>)[m] ?? (empty as Record<string, unknown>)[m],
        })
      },
    },
  )
  return { prisma, default: prisma }
})

describe('getTradesData', () => {
  beforeEach(() => {
    vi.resetModules()
    historyGate = new Promise<void>((resolve) => {
      releaseHistory = resolve
    })
  })

  it('starts the deadline reads while the Sleeper history is still loading', async () => {
    const { getTradesData } = await import('@/lib/core-app/trades')
    const timeout = new Promise<'timed out'>((resolve) => setTimeout(() => resolve('timed out'), 3000))
    const out = await Promise.race([getTradesData('lg-1', 'user-1'), timeout])

    expect(out).not.toBe('timed out')
    if (!out || out === 'timed out') throw new Error('no trades data')
    // Same values as before: only when they are read moved.
    expect(out.deadlineCountdown).toBe(COUNTDOWN)
    expect(out.pickTradeDeadline).toBe(PICK_VIEW)
  })
})
