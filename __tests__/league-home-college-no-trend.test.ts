// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 THE LEAGUE-HOME PLAYERS DATA MUST NOT PRESENT `DevyPlayer.stockTrendDelta` AS A TREND.
 *
 * `lib/data/league-home.ts` built a college "trend" list ordered by `stockTrendDelta desc` and put
 * that column in `trendValue`, which `components/league/tabs/PlayersTab.tsx` draws as "+N.N" with a
 * bar under a tab labelled Trend. The column is a LEVEL — its only writer
 * (`lib/workers/devy-data-worker.ts`) stores `score/100*10 + c2cPoints/10`, non-negative for every
 * scored prospect — so the list showed the whole pool rising. The Devy hub and the per-league Devy
 * tab already say "no trend measured" through `lib/devy/devyTrend.ts`; this is the third surface.
 *
 * The college list is gone rather than relabelled: its fallback ranking (draftProjectionScore) is
 * what the Leaders list already shows, so a relabelled copy would add nothing but a second name.
 */

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({
  devyFindMany: [] as Array<Record<string, any>>,
  pool: [] as Row[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => {
  const defaults = (method: string) => async () =>
    method === 'findMany' || method === 'groupBy' ? [] : method === 'count' ? 0 : null
  const override: Record<string, Record<string, (...a: any[]) => any>> = {
    league: {
      findUnique: async () => ({
        id: 'L1',
        name: 'The League',
        sport: 'NFL',
        season: 2026,
        leagueSize: 2,
        avatarUrl: null,
        leagueVariant: 'devy_dynasty',
        leagueType: 'dynasty',
        settings: {},
        scoring: null,
        isDynasty: true,
        platform: 'sleeper',
        platformLeagueId: 'P1',
        lifecycleState: 'in_season',
        locked: false,
        emergencyPaused: false,
      }),
    },
    roster: {
      findFirst: async () => ({
        id: 'r-me',
        platformUserId: 'u1',
        playerData: { players: [], starters: [] },
        faabRemaining: null,
        waiverPriority: null,
      }),
    },
    devyPlayer: {
      findMany: async (args: Record<string, any>) => {
        state.devyFindMany.push(args)
        return state.pool
      },
    },
  }
  const model = (name: string) =>
    new Proxy({}, { get: (_t, method: string) => override[name]?.[method] ?? defaults(method) })
  return { prisma: new Proxy({}, { get: (_t, name: string) => (name.startsWith('$') ? async () => [] : model(name)) }) }
})
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => ({ isMember: true, isCommissioner: false })) }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: vi.fn(async () => 'member') }))
vi.mock('@/lib/devy/DevyLeagueConfig', () => ({
  getDevyConfig: vi.fn(async () => ({
    collegeSports: ['NCAAF'],
    devySlotCount: 4,
    devyIRSlots: 0,
    taxiSize: 0,
    devyScoringEnabled: false,
  })),
}))
vi.mock('@/lib/merged-devy-c2c/C2CLeagueConfig', () => ({ getC2CConfig: vi.fn(async () => null) }))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({ getRosterTemplateForLeague: vi.fn(async () => null) }))
vi.mock('@/lib/player-media', () => ({ attachPlayerMediaBatch: vi.fn(async () => new Map()) }))
vi.mock('@/server/services/leagueLifecycleService', () => ({
  getAllowedActions: vi.fn(() => ({ state: 'in_season', locked: false, emergencyPaused: false, actions: [] })),
}))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ getLeagueChatMessages: vi.fn(async () => []) }))

import { getLeagueHomeData } from '@/lib/data/league-home'

const prospect = (id: string, stockTrendDelta: number, draftProjectionScore: number): Row => ({
  id,
  name: `Prospect ${id}`,
  position: 'WR',
  school: 'Ohio State',
  conference: 'Big Ten',
  sport: 'NCAAF',
  headshotUrl: null,
  nflTeam: null,
  portalStatus: null,
  draftGrade: 'B',
  draftEligibleYear: 2028,
  classYearLabel: 'SO',
  c2cPointsWeek: null,
  c2cPointsSeason: null,
  devyAdp: 12,
  projectedDraftPick: null,
  projectedDraftRound: 2,
  statsPayload: null,
  graduatedToNFL: false,
  stockTrendDelta,
  draftProjectionScore,
})

beforeEach(() => {
  state.devyFindMany = []
  // Every prospect carries a POSITIVE stockTrendDelta — exactly the writer's output, a level.
  state.pool = [prospect('a', 14.2, 90), prospect('b', 9.5, 70)]
})

async function college() {
  const data = await getLeagueHomeData('L1', 'u1', 'PLAYERS')
  expect(data).not.toBeNull()
  // The harness really reaches the college block: without this a null here would pass the rest.
  expect(data!.players.college).not.toBeNull()
  return data!.players.college!
}

describe('league-home college players — no level presented as a trend', () => {
  it('[control] the college block is built and its other lists carry the prospects', async () => {
    const c = await college()
    expect(c.available.map((p) => p.id)).toEqual(['a', 'b'])
    expect(c.leaders.map((p) => p.id)).toEqual(['a', 'b'])
    expect(state.devyFindMany.length).toBeGreaterThan(0)
  })

  it('🛑 never orders a query by stockTrendDelta', async () => {
    await college()
    const orderKeys = state.devyFindMany.flatMap((args) =>
      ([] as Array<Record<string, unknown>>).concat(args.orderBy ?? []).flatMap((o) => Object.keys(o)),
    )
    expect(orderKeys).not.toContain('stockTrendDelta')
  })

  it('🛑 no college player carries a trendValue, and there is no college trend list', async () => {
    const c = await college()
    expect('trend' in c).toBe(false)
    for (const p of [...c.available, ...c.leaders]) expect(p.trendValue).toBeNull()
  })
})
