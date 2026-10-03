import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))

const db = vi.hoisted(() => ({ answers: {} as Record<string, (args: any) => unknown>, calls: [] as Array<[string, unknown]> }))
/** Permissive double: every model and method answers; unlisted reads get an empty-but-valid value. */
vi.mock('@/lib/prisma', () => {
  const model = (name: string) =>
    new Proxy({}, {
      get: (_t, method: string) => async (args: unknown) => {
        db.calls.push([`${name}.${method}`, args])
        const a = db.answers[`${name}.${method}`]
        return a ? a(args) : method === 'findMany' ? [] : null
      },
    })
  const prisma = new Proxy({}, { get: (_t, key: string) => (key === 'then' ? undefined : model(key)) })
  return { prisma, default: prisma }
})

import { getTeamActivity, sideOf } from '@/lib/core-app/teamActivity'
import { MyTeam } from '@/components/core-app/screens/MyTeam'
import type { MyTeamData } from '@/lib/core-app/myTeam'

const ME = 'af-user-me'
const LEAGUE = { id: 'kbfl', platform: 'sleeper', platformLeagueId: '1338541390891606016', sport: 'NFL' }
const TEAMS = [
  { externalId: '4', teamName: 'BroVengers', ownerName: 'me', avatarUrl: null, platformUserId: 'slp-me', claimedByUserId: ME },
  { externalId: '9', teamName: 'Wichita Windigos', ownerName: 'them', avatarUrl: null, platformUserId: 'slp-them', claimedByUserId: null },
]
const NAMES: Record<string, string> = { p1: 'Received Guy', p2: 'Sent Guy', p3: 'Claimed Guy', p4: 'Cut Guy', p5: 'Other Team Claim' }

/*
 * Shapes measured on KBFL (2026-10-02): your rows carry your AllFantasy user id in managerKeys,
 * everyone else's carry `sleeper:<id>`; a trade is written once PER ROSTER with both managers'
 * keys, and `adds`/`drops` map player → receiving roster.
 */
const ROWS = [
  { id: 'r-trade-me', activityType: 'trade', occurredAt: new Date('2026-09-08T16:00:00Z'), rosterId: null,
    payload: { adds: { p1: '4', p2: '9' }, drops: { p2: '4', p1: '9' } }, normalized: { managerKeys: [ME, 'sleeper:slp-them'] } },
  { id: 'r-trade-them', activityType: 'trade', occurredAt: new Date('2026-09-08T16:00:00Z'), rosterId: null,
    payload: { adds: { p1: '4', p2: '9' }, drops: { p2: '4', p1: '9' } }, normalized: { managerKeys: ['sleeper:slp-them', ME] } },
  { id: 'r-other', activityType: 'waiver', occurredAt: new Date('2026-09-01T08:00:00Z'), rosterId: null,
    payload: { adds: { p5: '9' }, settings: { waiver_bid: 3 } }, normalized: { managerKeys: ['sleeper:slp-them'] } },
  { id: 'r-claim', activityType: 'waiver', occurredAt: new Date('2026-08-24T08:00:00Z'), rosterId: null,
    payload: { adds: { p3: '4' }, drops: { p4: '4' }, settings: { waiver_bid: 0 } }, normalized: { managerKeys: [ME] } },
]

beforeEach(() => {
  db.calls = []
  db.answers = {
    'decisionOsImportedActivity.findMany': () => ROWS,
    'leagueTeam.findMany': () => TEAMS,
    'sportsPlayer.findMany': (args: any) =>
      (args?.where?.sleeperId?.in ?? []).filter((id: string) => NAMES[id]).map((id: string) => ({ sleeperId: id, name: NAMES[id], position: 'WR', team: 'KC', imageUrl: null })),
  }
})

describe('getTeamActivity', () => {
  it('keeps only your moves, one item per event, scoped to what YOUR roster received and sent', async () => {
    const out = await getTeamActivity({ league: LEAGUE, team: { externalId: '4', platformUserId: 'slp-me', claimedByUserId: ME } })
    expect(out?.items.map((i) => `${i.kind}:${i.adds.map((p) => p.id).join(',')}/${i.drops.map((p) => p.id).join(',')}`)).toEqual([
      'trade:p1/p2', // both per-roster rows collapse to one, and only your side of it
      'waiver:p3/p4',
    ])
    expect(out?.items[1].bid).toBe(0) // a $0 claim is a real bid, not "unknown"
    expect(out?.feedNewest?.toISOString()).toBe('2026-09-08T16:00:00.000Z')
  })

  it('matches the league on both id spaces, the shared rule', async () => {
    await getTeamActivity({ league: LEAGUE, team: { externalId: '4', platformUserId: 'slp-me', claimedByUserId: ME } })
    const where = db.calls.find(([k]) => k === 'decisionOsImportedActivity.findMany')?.[1] as { where: { OR: unknown[] } }
    expect(where.where.OR).toEqual([{ afLeagueId: 'kbfl' }, { provider: 'sleeper', providerLeagueId: '1338541390891606016' }])
  })

  it('returns null, not "no moves", when the feed could not be read', async () => {
    db.answers['decisionOsImportedActivity.findMany'] = () => Promise.reject(new Error('db down'))
    expect(await getTeamActivity({ league: LEAGUE, team: { externalId: '4', platformUserId: 'slp-me', claimedByUserId: ME } })).toBeNull()
  })
})

describe('sideOf', () => {
  it('reads a player→roster map, and declines anything else', () => {
    expect([...(sideOf({ a: '4', b: 9, c: '4' }, '4') ?? [])]).toEqual(['a', 'c'])
    expect(sideOf(['a', 'b'], '4')).toBeNull()
    expect(sideOf(null, '4')).toBeNull()
  })
})

function data(teamActivity: MyTeamData['teamActivity']): MyTeamData {
  return {
    league: { id: 'kbfl', name: 'KBFL', platform: 'sleeper', format: 'dynasty', sourceLink: null },
    team: { available: true, data: { teamName: 'BroVengers', ownerName: 'me', managerAvatarUrl: null, record: '0-3', recordKnown: true, rank: 29, pointsFor: 0, pointsAgainst: 0, teamCount: 32 } },
    starters: { available: false, reason: 'n/a' },
    bench: { available: false, reason: 'n/a' },
    ir: { available: false, reason: 'n/a' },
    taxi: { available: false, reason: 'n/a' },
    lock: { available: false, reason: 'n/a' },
    projections: { available: false, reason: 'n/a' },
    projectionBasis: { notes: [], scoringKnown: false },
    nextMatchup: { available: false, reason: 'n/a' },
    upcomingByes: [],
    rosterGrade: { available: false, reason: 'n/a' },
    liveScore: { available: false, reason: 'n/a' },
    teamActivity,
  } as unknown as MyTeamData
}

describe('the Your recent moves card', () => {
  it('shows each move with its date, partner, bid and players', async () => {
    const activity = await getTeamActivity({ league: LEAGUE, team: { externalId: '4', platformUserId: 'slp-me', claimedByUserId: ME } })
    const { container } = render(<MyTeam data={data(activity)} />)
    const rows = [...container.querySelectorAll('.af-mt-moves-list li')]
    expect(rows[0].textContent).toContain('TRADE')
    expect(rows[0].textContent).toContain('Sep 8')
    expect(rows[0].textContent).toContain('with Wichita Windigos')
    expect(rows[0].textContent).toContain('+ Received Guy')
    expect(rows[0].textContent).toContain('− Sent Guy')
    expect(rows[1].textContent).toContain('CLAIM')
    expect(rows[1].textContent).toContain('$0')
  })

  it('says how current the league feed is when you have no moves', () => {
    const { container } = render(<MyTeam data={data({ items: [], feedNewest: new Date('2026-09-25T02:30:48Z') })} />)
    expect(container.querySelector('.af-mt-moves')?.textContent).toContain('League activity on file through Sep 24')
  })
})
