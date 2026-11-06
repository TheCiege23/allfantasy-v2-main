/**
 * `startTradesRead` hands back the Trade Center's shell while the slow part is still loading.
 *
 * The Sleeper history is 19–30s cold (see `readTradesSections`). The page awaits only the shell and
 * streams the rest, so the shell must resolve while that read is still pending — and `data` must be
 * exactly what `getTradesData` returns, shell fields included.
 *
 * The history read here waits on a gate the test holds closed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

let releaseHistory: () => void = () => {}
let historyGate = new Promise<void>((resolve) => {
  releaseHistory = resolve
})
let gradesFail = false

vi.mock('@/lib/core-app/sleeperTradeHistory', () => ({
  getSleeperTradeHistory: vi.fn(async () => {
    await historyGate
    return { history: [], notice: undefined }
  }),
}))

const COUNTDOWN = { label: 'deadline' }
const PICK_VIEW = { label: 'pick deadline' }
vi.mock('@/lib/trade-deadline/tradeDeadlineWindow', () => ({
  loadTradeDeadlineCountdown: vi.fn(async () => COUNTDOWN),
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
  settings: { trade_deadline: 11, playoff_week_start: 15 },
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
    leagueTradeHistory: {
      findMany: async () => {
        if (gradesFail) throw new Error('grade list read failed')
        return []
      },
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

const tick = (ms: number) => new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), ms))

describe('startTradesRead', () => {
  beforeEach(() => {
    vi.resetModules()
    gradesFail = false
    historyGate = new Promise<void>((resolve) => {
      releaseHistory = resolve
    })
  })

  it('resolves the shell while the Sleeper history is still loading, and the rest arrives unchanged', async () => {
    const { startTradesRead, getTradesData } = await import('@/lib/core-app/trades')
    const read = await Promise.race([startTradesRead('lg-1', 'user-1'), tick(3000).then(() => 'timed out' as const)])
    expect(read, 'the shell waited for the history').not.toBe('timed out')
    if (!read || read === 'timed out') throw new Error('no shell')

    expect(read.shell.league).toMatchObject({ id: 'lg-1', name: 'KBFL', platform: 'sleeper' })
    expect(read.shell.gradingContext).toEqual({ available: true, data: { leagueName: 'KBFL', format: 'redraft', teamCount: 12 } })
    expect(read.shell.deadlineCountdown).toBe(COUNTDOWN)
    expect(read.shell.pickTradeDeadline).toBe(PICK_VIEW)

    // The slow part is genuinely still out.
    expect(await Promise.race([read.data, tick(200)])).toBe('pending')

    releaseHistory()
    const data = await read.data
    // Every shell field is the one the screen's data carries — reused, not re-read.
    for (const key of Object.keys(read.shell) as Array<keyof typeof read.shell>) {
      expect(data[key], key).toEqual(read.shell[key])
    }
    expect(data.canonicalHistory).toBe(true)
    expect(data.history).toEqual({ available: true, data: [] })

    // And the same object `getTradesData` returns, key order included.
    const whole = await getTradesData('lg-1', 'user-1')
    expect(JSON.stringify(whole)).toBe(JSON.stringify(data))
  })

  it('a failure in the slow part rejects `data` only — the shell still lands', async () => {
    gradesFail = true
    releaseHistory()
    const { startTradesRead } = await import('@/lib/core-app/trades')
    const read = await startTradesRead('lg-1', 'user-1')
    expect(read?.shell.league.id).toBe('lg-1')
    await expect(read!.data).rejects.toThrow('grade list read failed')
  })

  it('no league is still null', async () => {
    const { startTradesRead } = await import('@/lib/core-app/trades')
    const ctx = {
      leagueId: 'lg-x',
      userId: 'user-1',
      league: async () => null,
      claimedTeam: async () => null,
      claimedTeams: async () => [],
    }
    await expect(startTradesRead('lg-x', 'user-1', ctx as never)).resolves.toBeNull()
  })
})
