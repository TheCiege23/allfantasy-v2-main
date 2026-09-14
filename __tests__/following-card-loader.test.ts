// @vitest-environment node
/**
 * `getFollowingCard` — the home "Following" card's loader (2026-09-14). Null when follows are
 * unavailable; statuses only from a readable injury feed, never "healthy" by absence; next
 * game from the shared fixture fold.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listPlayerFollows = vi.fn()
const resolveInjuryFacts = vi.fn()
const findGames = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsGame: { findMany: (...a: unknown[]) => findGames(...a) } } }))
vi.mock('@/lib/follows/playerFollows', () => ({ listPlayerFollows: (...a: unknown[]) => listPlayerFollows(...a) }))
vi.mock('@/lib/injuries/injuryReadPort', () => ({ resolveInjuryFacts: (...a: unknown[]) => resolveInjuryFacts(...a) }))

import { FOLLOWING_SHOWN, getFollowingCard } from '@/lib/core-app/followingCard'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'

const NOW = new Date('2026-09-16T12:00:00Z') // a Wednesday
const follow = (name: string, team: string | null, sport = 'NFL', key = name) => ({
  sport,
  playerKey: key,
  externalId: null,
  sleeperId: key,
  name,
  position: 'RB',
  team,
  createdAt: NOW,
})

function facts(entries: Array<[string, { status: string | null; stale?: boolean }]>, over: Record<string, unknown> = {}) {
  return {
    byPlayer: new Map(entries.map(([n, f]) => [normalizeMatchName(n), { stale: false, ...f }])),
    ambiguous: [],
    newestFetchedAt: NOW,
    feedStale: false,
    coverage: { sourceAvailable: true, reason: null },
    ...over,
  }
}

beforeEach(() => {
  listPlayerFollows.mockReset()
  resolveInjuryFacts.mockReset()
  findGames.mockReset()
  findGames.mockResolvedValue([])
})

describe('getFollowingCard', () => {
  it('🛑 follows unavailable → null (the card is not rendered)', async () => {
    listPlayerFollows.mockResolvedValue(null)
    expect(await getFollowingCard('u1', NOW)).toBeNull()
  })

  it('no follows → an empty card, not null', async () => {
    listPlayerFollows.mockResolvedValue([])
    expect(await getFollowingCard('u1', NOW)).toEqual({ rows: [], total: 0, statusCoverage: 'ok' })
  })

  it('🛑 a reported designation shows; no report and a stale report show NOTHING', async () => {
    listPlayerFollows.mockResolvedValue([follow('Jahmyr Gibbs', 'DET'), follow('Sam LaPorta', 'DET'), follow('Amon-Ra St. Brown', 'DET')])
    resolveInjuryFacts.mockResolvedValue(
      facts([
        ['Jahmyr Gibbs', { status: 'questionable' }],
        ['Amon-Ra St. Brown', { status: 'OUT', stale: true }],
      ]),
    )
    const out = await getFollowingCard('u1', NOW)
    expect(out?.rows.map((r) => [r.name, r.status])).toEqual([
      ['Jahmyr Gibbs', 'QUESTIONABLE'],
      ['Sam LaPorta', null],
      ['Amon-Ra St. Brown', null],
    ])
    expect(out?.statusCoverage).toBe('ok')
  })

  it('🛑 a stale feed hides every status and says so', async () => {
    listPlayerFollows.mockResolvedValue([follow('Jahmyr Gibbs', 'DET')])
    resolveInjuryFacts.mockResolvedValue(facts([['Jahmyr Gibbs', { status: 'OUT' }]], { feedStale: true }))
    const out = await getFollowingCard('u1', NOW)
    expect(out?.rows[0].status).toBeNull()
    expect(out?.statusCoverage).toBe('unavailable')
  })

  it('names the next fixture in the window, home or away, by Eastern weekday', async () => {
    listPlayerFollows.mockResolvedValue([follow('Jahmyr Gibbs', 'DET'), follow('Josh Allen', 'BUF')])
    resolveInjuryFacts.mockResolvedValue(facts([]))
    findGames.mockResolvedValue([
      // Sunday 1:00 PM ET
      { homeTeam: 'DET', awayTeam: 'KC', startTime: new Date('2026-09-20T17:00:00Z'), seasonType: 'regular', venue: null },
      // Monday 8:15 PM ET = Tuesday 00:15 UTC
      { homeTeam: 'NYJ', awayTeam: 'BUF', startTime: new Date('2026-09-22T00:15:00Z'), seasonType: 'regular', venue: null },
    ])
    const out = await getFollowingCard('u1', NOW)
    expect(out?.rows.map((r) => r.next)).toEqual(['vs KC · Sun', '@ NYJ · Mon'])
    const where = findGames.mock.calls[0][0].where
    expect(where.sport).toBe('NFL')
    expect(where.startTime.gte).toEqual(NOW)
  })

  it(`shows at most ${FOLLOWING_SHOWN} and counts the rest`, async () => {
    listPlayerFollows.mockResolvedValue(Array.from({ length: 9 }, (_, i) => follow(`Player ${i}`, 'DET')))
    resolveInjuryFacts.mockResolvedValue(facts([]))
    const out = await getFollowingCard('u1', NOW)
    expect(out?.rows).toHaveLength(FOLLOWING_SHOWN)
    expect(out?.total).toBe(9)
    expect(resolveInjuryFacts.mock.calls[0][0].players).toHaveLength(FOLLOWING_SHOWN)
  })

  it('another sport gets no status or fixture, and does not mark the feed unavailable', async () => {
    listPlayerFollows.mockResolvedValue([follow('Victor Wembanyama', 'SA', 'NBA')])
    const out = await getFollowingCard('u1', NOW)
    expect(out?.rows[0]).toMatchObject({ status: null, next: null })
    expect(out?.statusCoverage).toBe('ok')
    expect(resolveInjuryFacts).not.toHaveBeenCalled()
    expect(findGames).not.toHaveBeenCalled()
  })
})
