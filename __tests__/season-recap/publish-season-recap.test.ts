// @vitest-environment node
/**
 * Publishing a recap stores it with the season's history (one LeagueStoryline row per season, updated in
 * place on a re-finalize) and announces it through the injected notifier — no real email or push here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  existing: null as null | { id: string },
  stored: null as unknown,
  create: vi.fn(),
  update: vi.fn(),
  ingest: vi.fn(async () => ({ dispatched: true, sourceKey: 'k' })),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueStoryline: {
      findFirst: vi.fn(async ({ select }: { select: Record<string, boolean> }) =>
        select.metadata ? (h.stored ? { metadata: h.stored } : null) : h.existing),
      create: h.create,
      update: h.update,
    },
  },
}))
vi.mock('@/lib/notification-engine', () => ({ ingest: h.ingest }))
vi.mock('@/lib/season-recap/loadSeasonRecapInput', () => ({
  loadSeasonRecapInput: vi.fn(async (leagueId: string, season: number) =>
    season === 1999
      ? null
      : {
          leagueId, season, sport: 'NFL', playoffStartWeek: 15,
          teams: [
            { rosterId: 'a', name: 'Aces', ownerId: 'ua', wins: 10, losses: 4, ties: 0, pointsFor: 1500, pointsAgainst: 1300, playoffSeed: 1 },
            { rosterId: 'b', name: 'Bears', ownerId: 'ub', wins: 8, losses: 6, ties: 0, pointsFor: 1400, pointsAgainst: 1350, playoffSeed: 2 },
          ],
          regularGames: [{ week: 1, homeRosterId: 'a', awayRosterId: 'b', homeScore: 110, awayScore: 100 }],
          championRosterId: 'a', runnerUpRosterId: 'b', lowerBracketFinal: null,
          trades: [], pickups: [], priorSeasonByOwnerId: null, computedAt: '2027-01-01T00:00:00.000Z',
        }),
}))

import { getSeasonRecap, notifySeasonRecapReady, publishSeasonRecap, seasonRecapHref } from '@/lib/season-recap/seasonRecapService'

beforeEach(() => {
  vi.clearAllMocks()
  h.existing = null
  h.stored = null
})

describe('publishSeasonRecap', () => {
  it('stores the recap as the season\'s `season_recap` storyline and notifies once', async () => {
    const notify = vi.fn(async () => true)
    const out = await publishSeasonRecap('L', 2026, { deps: { notify } })
    expect(out).toMatchObject({ ok: true, created: true, notified: true })
    expect(h.create).toHaveBeenCalledTimes(1)
    const data = h.create.mock.calls[0][0].data
    expect(data).toMatchObject({ leagueId: 'L', season: 2026, storyType: 'season_recap', title: '2026 season recap', summary: 'Aces won the 2026 title' })
    expect(data.metadata).toMatchObject({ leagueId: 'L', season: 2026, champion: { rosterId: 'a' } })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ season: 2026 }), ['ua', 'ub'])
  })

  it('a re-finalize updates the same row, and `notify: false` sends nothing', async () => {
    h.existing = { id: 'story-1' }
    const notify = vi.fn(async () => true)
    const out = await publishSeasonRecap('L', 2026, { notify: false, deps: { notify } })
    expect(out).toMatchObject({ ok: true, created: false, notified: false })
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'story-1' } }))
    expect(h.create).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('a season that does not exist stores nothing', async () => {
    const out = await publishSeasonRecap('L', 1999, { deps: { notify: vi.fn() } })
    expect(out).toEqual({ ok: false, reason: 'season_not_found' })
    expect(h.create).not.toHaveBeenCalled()
  })
})

describe('the members\' notice', () => {
  it('goes through the notification engine as a league announcement, idempotent per season, linking to the recap', async () => {
    const out = await publishSeasonRecap('L', 2026, { deps: { notify: async () => false } })
    if (!out.ok) throw new Error('expected a recap')
    await notifySeasonRecapReady(out.recap, ['ua', 'ub'])
    expect(h.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'storyline_generated',
        userIds: ['ua', 'ub'],
        leagueId: 'L',
        actionHref: seasonRecapHref('L', 2026),
        meta: expect.objectContaining({ idempotencyKey: 'season-recap:L:2026:v1' }),
      }),
    )
    expect(seasonRecapHref('L', 2026)).toBe('/league/L?view=history&recap=2026')
  })
})

describe('getSeasonRecap', () => {
  it('prefers the stored recap, else computes one without writing', async () => {
    const live = await getSeasonRecap('L', 2026)
    expect(live).toMatchObject({ stored: false, recap: { champion: { rosterId: 'a' } } })
    expect(h.create).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()

    h.stored = { ...live!.recap, champion: { rosterId: 'b', name: 'Bears' } }
    expect(await getSeasonRecap('L', 2026)).toMatchObject({ stored: true, recap: { champion: { rosterId: 'b' } } })
  })
})
