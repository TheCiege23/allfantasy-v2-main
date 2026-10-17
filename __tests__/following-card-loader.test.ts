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
const findPlayers = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsGame: { findMany: (...a: unknown[]) => findGames(...a) },
    sportsPlayer: { findMany: (...a: unknown[]) => findPlayers(...a) },
  },
}))
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
  findPlayers.mockReset()
  findPlayers.mockResolvedValue([])
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

/*
 * 🛑 `player_follows.team` is the club at FOLLOW time and only a re-follow refreshes it. It drove the
 * team shown, the next game and the injury match, so a player traded or cut after you starred him
 * kept his old club on all three. The Sleeper row is the authority for a Sleeper id.
 */
describe('getFollowingCard — the current club, not the follow-time snapshot', () => {
  const row = (sleeperId: string, source: string, team: string | null, name = 'Jahmyr Gibbs') => ({
    sleeperId, source, team, name, position: 'RB', fetchedAt: NOW,
  })
  const KC_GAME = { homeTeam: 'KC', awayTeam: 'LV', startTime: new Date('2026-09-20T17:00:00Z'), seasonType: 'regular', venue: null }
  const DET_GAME = { homeTeam: 'DET', awayTeam: 'GB', startTime: new Date('2026-09-20T17:00:00Z'), seasonType: 'regular', venue: null }

  it('🛑 a traded player shows his NEW club, its next game, and is injury-matched on it', async () => {
    listPlayerFollows.mockResolvedValue([follow('Jahmyr Gibbs', 'DET')])
    findPlayers.mockResolvedValue([row('Jahmyr Gibbs', 'sleeper', 'Kansas City Chiefs')])
    resolveInjuryFacts.mockResolvedValue(facts([]))
    findGames.mockResolvedValue([KC_GAME, DET_GAME])
    const out = await getFollowingCard('u1', NOW)
    expect(out?.rows[0]).toMatchObject({ team: 'Kansas City Chiefs', next: 'vs LV · Sun' })
    expect(resolveInjuryFacts.mock.calls[0][0].players[0].team).toBe('Kansas City Chiefs')
    expect(findPlayers.mock.calls[0][0].where).toEqual({ sport: 'NFL', sleeperId: { in: ['Jahmyr Gibbs'] } })
  })

  it('🛑 a Sleeper row with team null is a FREE AGENT — no team, no next game, never the stale club', async () => {
    listPlayerFollows.mockResolvedValue([follow('Jahmyr Gibbs', 'DET')])
    findPlayers.mockResolvedValue([row('Jahmyr Gibbs', 'sleeper', null), row('Jahmyr Gibbs', 'thesportsdb', 'Detroit Lions')])
    resolveInjuryFacts.mockResolvedValue(facts([]))
    findGames.mockResolvedValue([DET_GAME])
    const out = await getFollowingCard('u1', NOW)
    expect(out?.rows[0]).toMatchObject({ team: null, next: null })
    expect(resolveInjuryFacts.mock.calls[0][0].players[0].team).toBeNull()
  })

  it('without a Sleeper row there is no authority, so the snapshot stands (a vendor row got its id by name)', async () => {
    listPlayerFollows.mockResolvedValue([follow('Jahmyr Gibbs', 'DET')])
    findPlayers.mockResolvedValue([row('Jahmyr Gibbs', 'thesportsdb', 'Seattle Seahawks')])
    resolveInjuryFacts.mockResolvedValue(facts([]))
    const out = await getFollowingCard('u1', NOW)
    expect(out?.rows[0].team).toBe('DET')
  })

  it('no row, or a failed read, keeps the snapshot', async () => {
    listPlayerFollows.mockResolvedValue([follow('Jahmyr Gibbs', 'DET')])
    resolveInjuryFacts.mockResolvedValue(facts([]))
    expect((await getFollowingCard('u1', NOW))?.rows[0].team).toBe('DET')
    findPlayers.mockRejectedValue(new Error('db down'))
    expect((await getFollowingCard('u1', NOW))?.rows[0].team).toBe('DET')
  })
})
