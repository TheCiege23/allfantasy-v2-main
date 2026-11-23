// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  claims: new Set<string>(),
  sent: [] as Array<{ userIds: string[]; category: string; title: string; body?: string }>,
  report: null as unknown,
  owners: [] as Array<{ role: 'pro' | 'college'; key: string; userId: string }>,
  pairQuery: null as unknown,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findMany: vi.fn(async (q: unknown) => {
        h.pairQuery = q
        return [{ id: 'peach', userId: 'commish', name: 'Peach Bowl (C2C)', sport: 'NFL', settings: { collegeProPair: { role: 'pro', otherLeagueId: 'cream', linkedByUserId: 'commish', linkedAt: '' } } }]
      }),
      findUnique: vi.fn(async () => ({ name: 'Cream Bowl', sport: 'NCAAF' })),
    },
    sportsDataCache: {
      create: vi.fn(async (q: { data: { cacheKey: string } }) => {
        if (h.claims.has(q.data.cacheKey)) throw Object.assign(new Error('dup'), { code: 'P2002' })
        h.claims.add(q.data.cacheKey)
        return {}
      }),
    },
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({
  dispatchNotification: vi.fn(async (p: { userIds: string[]; category: string; title: string; body?: string }) => {
    h.sent.push(p)
    return { requested: p.userIds.length, suppressed: 0, delivered: p.userIds.length, failed: 0 }
  }),
}))
vi.mock('@/lib/league/collegePro/leaguePair', async () => {
  const record = await vi.importActual<typeof import('@/lib/league/collegePro/pairRecord')>('@/lib/league/collegePro/pairRecord')
  return { ...record, loadPairContext: vi.fn(async () => ({ owners: h.owners })) }
})
vi.mock('@/lib/league/collegePro/loadCollegeProDraft', () => ({ draftReportForPair: vi.fn(async () => h.report) }))

import { notifyNewDraftPicks } from '@/lib/league/collegePro/draftNotices'

const player = (athleteId: string, name: string, overall: number) => ({ fantraxId: `f-${athleteId}`, athleteId, name, position: 'WR', proTeam: 'NYJ', round: 1, pick: overall, overall })
const NOW = new Date('2027-04-24T03:00:00Z')

beforeEach(() => {
  h.claims = new Set()
  h.sent = []
  h.owners = [
    { role: 'college', key: 'ciege', userId: 'commish' },
    { role: 'pro', key: '11', userId: 'grinder' },
  ]
  h.report = {
    year: 2027,
    movingUp: [
      { collegeKey: 'ciege', collegeName: 'Ciege82', proKey: '8', proName: '(F) SF TEP', players: [player('a1', 'First Rounder', 5)] },
      { collegeKey: 'grind', collegeName: 'Grindingffb', proKey: '11', proName: 'GrindingFFB', players: [player('a2', 'Old News', 9), player('a3', 'Fresh Pick', 20)] },
    ],
    rookiePool: [],
    unlinked: 0,
  }
})

describe('draft notices for paired college + pro leagues', () => {
  it('tells each manager about their NEW drafted players, and the commissioner once', async () => {
    const r = await notifyNewDraftPicks({ sport: 'NCAAF', year: 2027, previousIds: new Set(['a2']), currentIds: ['a1', 'a2', 'a3'], now: NOW })
    expect(r).toEqual({ leagues: 1, managers: 2, commissioners: 1 })
    expect(h.pairQuery).toMatchObject({ where: { settings: { path: ['collegeProPair', 'role'], equals: 'pro' } } })
    const managers = h.sent.filter((s) => s.category === 'imported_draft')
    expect(managers.map((s) => [s.userIds, s.title])).toEqual([
      [['commish'], 'First Rounder was drafted'],
      [['grinder'], 'Fresh Pick was drafted'], // reached through the PRO team's claim; Old News was already on file
    ])
    expect(managers[0]!.body).toBe('NYJ took him in round 1, pick 5. He moves from Cream Bowl to your NFL roster in Peach Bowl (C2C).')
    expect(h.sent.filter((s) => s.category === 'commissioner_alerts').map((s) => s.userIds)).toEqual([['commish']])
  })

  it('a second run with the same picks sends nothing', async () => {
    const args = { sport: 'NCAAF' as const, year: 2027, previousIds: new Set<string>(), currentIds: ['a1', 'a2', 'a3'], now: NOW }
    await notifyNewDraftPicks(args)
    const first = h.sent.length
    await notifyNewDraftPicks(args) // e.g. a retry before the store's previous ids caught up
    expect(h.sent.length).toBe(first)
  })

  it('nothing new, an older draft year, or the other sport sends nothing', async () => {
    expect(await notifyNewDraftPicks({ sport: 'NCAAF', year: 2027, previousIds: new Set(['a1', 'a2', 'a3']), currentIds: ['a1', 'a2', 'a3'], now: NOW })).toMatchObject({ leagues: 0 })
    expect(await notifyNewDraftPicks({ sport: 'NCAAF', year: 2026, previousIds: new Set(), currentIds: ['a1'], now: NOW })).toMatchObject({ leagues: 0 })
    expect(await notifyNewDraftPicks({ sport: 'NCAAB', year: 2027, previousIds: new Set(), currentIds: ['a1'], now: NOW })).toMatchObject({ leagues: 0 })
    expect(h.sent).toEqual([])
  })
})
