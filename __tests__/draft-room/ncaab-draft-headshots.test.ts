import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * College basketball draft photos: ESPN's, tied to the player by id, or none. The pool's general
 * ladder matches on name and position across every team, which with three positions and 22,000
 * player rows puts strangers' faces on players (production, 2026-11-25).
 */

const db = vi.hoisted(() => ({
  playerIdentityMap: { findMany: vi.fn() },
  sportsDataCache: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { loadNcaabEspnHeadshotsByRiId, resolveNcaabDraftHeadshot } from '@/lib/draft-room/ncaabDraftHeadshots'

const espn = (id: string) => `https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/${id}.png`
const TSDB = 'https://r2.thesportsdb.com/images/media/player/cutout/xg23dn1575307996.png'
const now = new Date('2026-11-25T16:00:00Z')

describe('resolveNcaabDraftHeadshot', () => {
  it('prefers the photo for the linked ESPN athlete, then the row’s own, then the same-school row’s', () => {
    expect(resolveNcaabDraftHeadshot({ byEspnId: espn('1'), own: [espn('2')], sameSchool: espn('3') })).toBe(espn('1'))
    expect(resolveNcaabDraftHeadshot({ own: [null, espn('2')], sameSchool: espn('3') })).toBe(espn('2'))
    expect(resolveNcaabDraftHeadshot({ own: [null, undefined], sameSchool: espn('3') })).toBe(espn('3'))
  })

  it('shows no photo rather than one matched by name', () => {
    expect(resolveNcaabDraftHeadshot({ byEspnId: null, own: [TSDB, 'data:image/svg+xml;utf8,x'], sameSchool: TSDB })).toBeNull()
    expect(resolveNcaabDraftHeadshot({})).toBeNull()
  })
})

describe('loadNcaabEspnHeadshotsByRiId', () => {
  const snapshot = (teamId: string, athletes: unknown[]) => ({ data: { seasonYear: 2027, teamId, school: `School ${teamId}`, observedAt: now.toISOString(), athletes } })

  beforeEach(() => {
    db.playerIdentityMap.findMany.mockReset()
    db.sportsDataCache.findMany.mockReset()
  })

  it('joins Rolling Insights id → ESPN id → that athlete’s headshot', async () => {
    db.playerIdentityMap.findMany.mockResolvedValue([
      { rollingInsightsId: '100', espnId: '5241333' },
      { rollingInsightsId: '200', espnId: '5241444' },
    ])
    db.sportsDataCache.findMany.mockResolvedValue([
      snapshot('2057', [
        { id: '5241333', fullName: 'Eoin Dillon', jersey: '5', position: 'F', headshotUrl: espn('5241333') },
        // ESPN has no photo for this athlete: the field is absent, and he gets none.
        { id: '5241444', fullName: 'No Photo', jersey: '9', position: 'G', headshotUrl: null },
      ]),
    ])

    const photos = await loadNcaabEspnHeadshotsByRiId(['100', '200', '300', ' 100 '], now)

    expect([...photos]).toEqual([['100', espn('5241333')]])
    // Season 2026–27 is ESPN's 2027, read from fresh snapshots only.
    expect(db.sportsDataCache.findMany.mock.calls[0]![0].where).toMatchObject({
      cacheKey: { startsWith: 'espn:ncaab:roster:2027:' },
      expiresAt: { gt: now },
    })
    expect(db.playerIdentityMap.findMany.mock.calls[0]![0].where).toMatchObject({
      sport: 'NCAAB', rollingInsightsId: { in: ['100', '200', '300'] }, espnId: { not: null },
    })
  })

  it('drops an athlete listed on two schools, and an id two identities claim differently', async () => {
    db.playerIdentityMap.findMany.mockResolvedValue([
      { rollingInsightsId: '100', espnId: '1' }, // on two rosters below
      { rollingInsightsId: '200', espnId: '2' },
      { rollingInsightsId: '200', espnId: '3' }, // two identities, two different athletes
      { rollingInsightsId: '300', espnId: '4' }, // control: clean, and it does resolve
    ])
    db.sportsDataCache.findMany.mockResolvedValue([
      snapshot('10', [{ id: '1', fullName: 'A', headshotUrl: espn('1') }, { id: '2', fullName: 'B', headshotUrl: espn('2') }]),
      snapshot('20', [{ id: '1', fullName: 'A', headshotUrl: espn('1') }, { id: '3', fullName: 'C', headshotUrl: espn('3') }, { id: '4', fullName: 'D', headshotUrl: espn('4') }]),
    ])

    const photos = await loadNcaabEspnHeadshotsByRiId(['100', '200', '300'], now)

    expect([...photos]).toEqual([['300', espn('4')]])
  })

  it('ignores a snapshot from another season and a non-ESPN picture', async () => {
    db.playerIdentityMap.findMany.mockResolvedValue([{ rollingInsightsId: '100', espnId: '1' }, { rollingInsightsId: '200', espnId: '2' }])
    db.sportsDataCache.findMany.mockResolvedValue([
      { data: { seasonYear: 2026, teamId: '10', athletes: [{ id: '1', fullName: 'A', headshotUrl: espn('1') }] } },
      snapshot('20', [{ id: '2', fullName: 'B', headshotUrl: TSDB }]),
    ])

    expect((await loadNcaabEspnHeadshotsByRiId(['100', '200'], now)).size).toBe(0)
  })

  it('asks nothing for an empty id list', async () => {
    expect((await loadNcaabEspnHeadshotsByRiId([], now)).size).toBe(0)
    expect(db.playerIdentityMap.findMany).not.toHaveBeenCalled()
  })
})
