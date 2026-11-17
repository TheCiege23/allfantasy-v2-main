/**
 * When the rebuild plan applies (lib/trade-intel/rebuildPlanLoader.ts), and the once-a-season notice
 * that points a manager at it (lib/trade-intel/rebuildPlanNotice.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
// 4 teams, 2 make it, 14-week season, week 12: 'out' (3 wins) is mathematically gone, 'bubble' is not.
vi.mock('@/lib/core-app/seasonTimeline', () => ({
  playoffSpots: () => 2,
  regularSeasonWeeks: () => 14,
  leagueWeekFromSettings: () => 12,
}))

import { loadRebuildPlan } from '@/lib/trade-intel/rebuildPlanLoader'
import { notifyRebuildPlans, rebuildsMakeSense } from '@/lib/trade-intel/rebuildPlanNotice'

const teams = [
  { id: 'a', ownerId: 'ua', wins: 10, losses: 1, ties: 0 },
  { id: 'b', ownerId: 'ub', wins: 8, losses: 3, ties: 0 },
  { id: 'bubble', ownerId: 'ubub', wins: 7, losses: 4, ties: 0 },
  { id: 'out', ownerId: 'uout', wins: 3, losses: 8, ties: 0 },
]

describe('when the plan applies', () => {
  const rosters = teams.map((t) => ({ rosterId: t.id, ownerName: t.id, wins: t.wins, losses: t.losses, ties: t.ties, players: [], picks: [] }))
  const ctx = (over: Record<string, unknown> = {}) => ({
    viewerRosterId: 'out',
    rosters,
    leagueMode: 'dynasty',
    settings: {},
    starterSlots: ['QB'],
    savedStrategy: null,
    qbFormat: 'ONE_QB' as const,
    ...over,
  })
  const leans = async () => new Map()

  it('a team mathematically out of the race gets it, and is told why in its own terms', async () => {
    const plan = await loadRebuildPlan(ctx(), { leans })
    expect(plan?.trigger).toBe('eliminated')
    expect(plan?.basis).toMatch(/^You are .* back of the last playoff spot with 3 weeks to play, so you cannot get there\./)
  })

  it('a bubble team is never told to rebuild uninvited', async () => {
    expect(await loadRebuildPlan(ctx({ viewerRosterId: 'bubble' }), { leans })).toBeNull()
  })

  it('a manager who chose to rebuild gets it whatever the standings', async () => {
    const plan = await loadRebuildPlan(ctx({ viewerRosterId: 'a', savedStrategy: 'rebuild' }), { leans })
    expect(plan?.trigger).toBe('strategy')
  })

  it('a redraft league never gets it: there is no next year to build for', async () => {
    expect(await loadRebuildPlan(ctx({ leagueMode: 'redraft' }), { leans })).toBeNull()
  })
})

describe('the once-a-season notice', () => {
  const sent: string[] = []
  const prisma = (over: { leagueType?: string; already?: string[] } = {}) =>
    ({
      redraftSeason: {
        findUnique: vi.fn(async () => ({
          leagueId: 'L',
          season: 2026,
          league: { name: 'Dynasty Bros', settings: {}, leagueType: over.leagueType ?? 'dynasty', leagueVariant: null, isDynasty: over.leagueType == null },
        })),
      },
      redraftRoster: { findMany: vi.fn(async () => teams) },
      platformNotification: {
        findFirst: vi.fn(async ({ where }: { where: { sourceKey: string } }) => ((over.already ?? []).includes(where.sourceKey) ? { id: 'n' } : null)),
      },
    }) as never
  const dispatch = vi.fn(async (input: Record<string, unknown>) => void sent.push(String((input.userIds as string[])[0])))

  beforeEach(() => {
    sent.length = 0
    dispatch.mockClear()
  })

  it('tells only the team that is out, with a link to its plan', async () => {
    const r = await notifyRebuildPlans({ prisma: prisma(), seasonId: 'S' }, { hasAfPro: async () => true, dispatch })
    expect(r.notified).toBe(1)
    expect(sent).toEqual(['uout'])
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ actionHref: '/core/trades?league=L', dedupePrefix: 'rebuild-plan-ready:L:2026' }))
  })

  it('sends nothing to a manager without AF Pro — the plan would be locked', async () => {
    expect((await notifyRebuildPlans({ prisma: prisma(), seasonId: 'S' }, { hasAfPro: async () => false, dispatch })).notified).toBe(0)
  })

  it('sends it once a season, not every week after', async () => {
    const r = await notifyRebuildPlans({ prisma: prisma({ already: ['rebuild-plan-ready:L:2026:uout'] }), seasonId: 'S' }, { hasAfPro: async () => true, dispatch })
    expect(r.notified).toBe(0)
  })

  it('nothing in a redraft league', async () => {
    expect((await notifyRebuildPlans({ prisma: prisma({ leagueType: 'redraft' }), seasonId: 'S' }, { hasAfPro: async () => true, dispatch })).notified).toBe(0)
    expect(rebuildsMakeSense({ leagueType: 'keeper' })).toBe(true)
  })
})
