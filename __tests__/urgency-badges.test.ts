/**
 * Urgency counts on the Core tabs.
 *
 * ⚠ THE RULES THAT MATTER ARE ABOUT WHAT IS NOT SHOWN. A stale "1 offer" for an
 * offer already answered, a lineup badge from a read that failed, or a zero drawn
 * as a badge would each train people to ignore the tab bar.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ cacheFind: vi.fn(), cacheUpsert: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: { sportsDataCache: { findUnique: h.cacheFind, upsert: h.cacheUpsert } },
}))

import {
  URGENCY_TTL_MS,
  draftLeagueIds,
  getUrgencyBadges,
  lineupLeagueIds,
  recordPendingOffers,
  type UrgencyCache,
} from '@/lib/core-app/urgencyBadges'

const NOW = new Date('2026-09-14T15:00:00Z')
const MIN = 60_000
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

const LEAGUES = [
  { id: 'L1', platform: 'sleeper', lastSyncedAt: ago(5 * MIN), draftDate: null },
  { id: 'L2', platform: 'sleeper', lastSyncedAt: ago(5 * MIN), draftDate: null },
  { id: 'L3', platform: 'espn', lastSyncedAt: null, draftDate: null },
]

const cached = (c: Partial<UrgencyCache>) => h.cacheFind.mockResolvedValue({ data: { version: 1, lineup: null, offers: {}, ...c } })

beforeEach(() => {
  h.cacheFind.mockReset()
  h.cacheUpsert.mockReset()
  h.cacheFind.mockResolvedValue(null)
  h.cacheUpsert.mockResolvedValue({})
})

describe('lineupLeagueIds / draftLeagueIds', () => {
  it('a league with an empty slot or a ruled-out starter needs you', () => {
    expect(
      lineupLeagueIds([
        { id: 'a', emptyStarters: 1, hurtStarters: 0 },
        { id: 'b', emptyStarters: 0, hurtStarters: 2 },
        { id: 'c', emptyStarters: 0, hurtStarters: 0 },
      ]),
    ).toEqual(['a', 'b'])
  })

  it('counts a draft live now, or starting within a day — once per league', () => {
    const ids = draftLeagueIds(
      [
        { id: 'soon', draftDate: new Date(NOW.getTime() + 3 * 3_600_000) },
        { id: 'later', draftDate: new Date(NOW.getTime() + 3 * 24 * 3_600_000) },
        { id: 'past', draftDate: new Date(NOW.getTime() - 3_600_000) },
        { id: 'live', draftDate: new Date(NOW.getTime() + 3_600_000) },
      ],
      ['live'],
      NOW,
    )
    expect(ids.sort()).toEqual(['live', 'soon'])
  })
})

describe('getUrgencyBadges', () => {
  const run = (over: Partial<Parameters<typeof getUrgencyBadges>[0]> = {}) =>
    getUrgencyBadges({
      userId: 'u1',
      leagues: LEAGUES,
      liveDraftLeagueIds: [],
      now: NOW,
      loadLineupLeagues: vi.fn(async () => null),
      ...over,
    })

  it('on the home, uses the lineup facts already loaded and refreshes the cache', async () => {
    const load = vi.fn(async () => null)
    const badges = await run({
      lineupLeagues: [{ id: 'L1', emptyStarters: 1 }, { id: 'L2', hurtStarters: 1 }],
      loadLineupLeagues: load,
    })
    expect(badges.myTeam).toBe(2)
    expect(load).not.toHaveBeenCalled()
    const written = h.cacheUpsert.mock.calls[0]![0].update.data as UrgencyCache
    expect(written.lineup).toEqual({ at: NOW.toISOString(), leagueIds: ['L1', 'L2'] })
  })

  it('on another tab, reuses a fresh cache without recomputing', async () => {
    cached({ lineup: { at: ago(4 * MIN), leagueIds: ['L2'] } })
    const load = vi.fn(async () => null)
    expect((await run({ loadLineupLeagues: load })).myTeam).toBe(1)
    expect(load).not.toHaveBeenCalled()
  })

  it('recomputes once the cache is older than 10 minutes', async () => {
    cached({ lineup: { at: ago(URGENCY_TTL_MS + MIN), leagueIds: ['L2'] } })
    const load = vi.fn(async () => [{ id: 'L1', emptyStarters: 2 }, { id: 'L3', hurtStarters: 1 }])
    expect((await run({ loadLineupLeagues: load })).myTeam).toBe(2)
    expect(load).toHaveBeenCalledTimes(1)
  })

  /* A failed read is "we do not know" — never a zero, never a stale number. */
  it('shows no lineup badge when the cache is stale and the reload fails', async () => {
    cached({ lineup: { at: ago(URGENCY_TTL_MS + MIN), leagueIds: ['L1', 'L2'] } })
    expect((await run()).myTeam).toBeNull()
  })

  it('counts offers waiting only from scans within the last 10 minutes, and only in your leagues', async () => {
    cached({
      offers: {
        L1: { at: ago(2 * MIN), waiting: 2 },
        L2: { at: ago(URGENCY_TTL_MS + MIN), waiting: 1 },
        gone: { at: ago(MIN), waiting: 1 },
        L3: { at: ago(MIN), waiting: 0 },
      },
    })
    expect((await run()).trades).toBe(1)
  })

  it('counts stale leagues by the issues queue\'s own rule', async () => {
    expect((await run()).sync).toBe(1)
  })

  it('draws nothing at all for a zero', async () => {
    const badges = await run({
      leagues: LEAGUES.slice(0, 2),
      lineupLeagues: [{ id: 'L1', emptyStarters: 0 }],
    })
    expect(badges).toEqual({ myTeam: null, trades: null, draftHq: null, sync: null })
  })
})

describe('recordPendingOffers', () => {
  it('replaces the scanned leagues and keeps every other fresh league as it was', async () => {
    cached({ offers: { L1: { at: ago(3 * MIN), waiting: 1 }, L2: { at: ago(URGENCY_TTL_MS + MIN), waiting: 4 } } })
    await recordPendingOffers('u1', [{ leagueId: 'L3', waiting: 2 }], NOW)
    const written = h.cacheUpsert.mock.calls[0]![0].update.data as UrgencyCache
    expect(written.offers).toEqual({
      L1: { at: ago(3 * MIN), waiting: 1 },
      L3: { at: NOW.toISOString(), waiting: 2 },
    })
  })

  it('writes nothing when no scan answered', async () => {
    await recordPendingOffers('u1', [], NOW)
    expect(h.cacheUpsert).not.toHaveBeenCalled()
  })
})
