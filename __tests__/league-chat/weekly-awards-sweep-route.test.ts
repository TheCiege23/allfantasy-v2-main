// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The Tuesday sweep's wiring: every Sleeper league (no fixed hundred), a league already recapped this
 * week costs nothing, what was posted feeds the "share it" push, and whoever that push reached gets the
 * weekly story in-app only.
 */

const m = vi.hoisted(() => ({
  leagues: [] as Array<{ id: string; name: string; platformLeagueId: string; userId: string; settings: unknown }>,
  recapped: [] as string[],
  findManyArgs: [] as unknown[],
  posted: [] as string[],
  notifyRecaps: vi.fn(async (_posted: unknown[]) => ({ notified: new Set(['owner-a']), sent: 1, skipped: 0 })),
  notifyStories: vi.fn(async (_now?: Date, _pushed?: ReadonlySet<string>) => ({ targeted: 0, sent: 0, skipped: 0 })),
}))

vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findMany: vi.fn(async (args: { where?: { platform?: unknown } }) => {
        m.findManyArgs.push(args)
        return args.where?.platform === 'sleeper' ? m.leagues : []
      }),
    },
    leagueChatMessage: { findMany: vi.fn(async () => m.recapped.map((leagueId) => ({ leagueId }))) },
    sportsDataCache: {
      findMany: vi.fn(async () => m.leagues.map((l) => ({ cacheKey: `h2h:v2:${l.platformLeagueId}` }))),
    },
    leagueTeam: { groupBy: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/league-history/sleeperH2HService', () => ({
  AGG_PREFIX: 'h2h:v2:',
  getLeagueH2H: vi.fn(async () => ({
    managers: [],
    records: {},
    latestWeekAwards: { season: '2026', week: 5 },
  })),
}))
vi.mock('@/lib/league-chat/weeklyRecapMoment', () => ({
  buildWeeklyRecap: vi.fn(() => 'recap'),
  weeklyRecapAlreadyPosted: vi.fn(async () => false),
  postWeeklyRecapAsChimmy: vi.fn(async (input: { afLeagueId: string }) => {
    m.posted.push(input.afLeagueId)
    return { posted: true, messageId: `msg-${input.afLeagueId}` }
  }),
}))
vi.mock('@/lib/resend-client', () => ({ sendTemplatedEmail: vi.fn() }))
vi.mock('@/lib/notifications/designedEmail', () => ({ renderDigestEmail: vi.fn() }))
vi.mock('@/lib/trade-intel/tradeGradeEmail', () => ({ escapeHtml: (s: string) => s }))
vi.mock('@/lib/get-base-url', () => ({ getBaseUrl: () => 'https://allfantasy.ai' }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('@/lib/core-app/commissioner/recipes', () => ({ weeklyRecapAllowed: () => true }))
vi.mock('@/lib/core-app/weeklyStoryNotify', () => ({ notifyWeeklyStories: m.notifyStories }))
vi.mock('@/lib/league-chat/nativeWeeklyRecap', () => ({ postNativeWeeklyRecap: vi.fn() }))
vi.mock('@/lib/league-chat/weeklyRecapNotify', () => ({ notifyWeeklyRecaps: m.notifyRecaps }))

import { GET } from '@/app/api/cron/weekly-awards/route'

function cronRequest() {
  return {
    headers: new Headers({ authorization: 'Bearer test-secret' }),
    nextUrl: new URL('https://allfantasy.ai/api/cron/weekly-awards'),
  } as never
}

beforeEach(() => {
  process.env.CRON_SECRET = 'test-secret'
  m.leagues = [
    { id: 'a', name: 'A League', platformLeagueId: 'sa', userId: 'owner-a', settings: null },
    { id: 'b', name: 'B League', platformLeagueId: 'sb', userId: 'owner-b', settings: null },
    { id: 'c', name: 'C League', platformLeagueId: 'sc', userId: 'owner-c', settings: null },
  ]
  m.recapped = []
  m.findManyArgs = []
  m.posted = []
  m.notifyRecaps.mockClear()
  m.notifyStories.mockClear()
  // The Sleeper week feed: state, then rosters/users/matchups per league.
  globalThis.fetch = vi.fn(async (url: string) =>
    new Response(JSON.stringify(String(url).endsWith('/state/nfl') ? { season: '2026' } : []), { status: 200 }),
  ) as never
})

describe('the weekly recap sweep', () => {
  it('reads every Sleeper league, with no fixed cap', async () => {
    await GET(cronRequest())
    const sleeperRead = m.findManyArgs.find((a) => (a as { where?: { platform?: unknown } }).where?.platform === 'sleeper') as { take?: number }
    expect(sleeperRead.take).toBeUndefined()
  })

  it('skips a league already recapped this week, and posts the rest', async () => {
    m.recapped = ['b']
    await GET(cronRequest())
    expect(m.posted.sort()).toEqual(['a', 'c'])
  })

  it('hands what it posted to the "share it" push, then tells the story push who already got one', async () => {
    await GET(cronRequest())
    const posted = (m.notifyRecaps.mock.calls[0] as unknown as [Array<{ leagueId: string; season: string; week: number; ownerUserId: string }>])[0]
    expect(posted.map((p) => p.leagueId).sort()).toEqual(['a', 'b', 'c'])
    expect(posted[0]).toMatchObject({ season: '2026', week: 5 })
    const pushed = (m.notifyStories.mock.calls[0] as unknown as [Date, ReadonlySet<string>])[1]
    expect([...pushed]).toEqual(['owner-a'])
  })
})
