// @vitest-environment node
/**
 * The waiver nudge on the home Following card (2026-09-14): a followed player on NO roster in
 * one of your leagues. "Free agent" is a claim made only when every roster in that league can
 * be read — never on a partial import, never on rosters that do not speak Sleeper ids, and only
 * for leagues you actually have a team in.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  teamFind: vi.fn(),
  rosterFind: vi.fn(),
  playerFind: vi.fn(),
  gameFind: vi.fn(),
  identityFind: vi.fn(),
  listFollows: vi.fn(),
  resolveInjuryFacts: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: h.teamFind },
    roster: { findMany: h.rosterFind },
    sportsPlayer: { findMany: h.playerFind },
    sportsGame: { findMany: h.gameFind },
    playerIdentityMap: { findMany: h.identityFind },
  },
}))
vi.mock('@/lib/follows/playerFollows', () => ({ listPlayerFollows: h.listFollows }))
vi.mock('@/lib/injuries/injuryReadPort', () => ({ resolveInjuryFacts: h.resolveInjuryFacts }))
vi.mock('@/lib/core-app/leagueHome', () => ({ leagueDisplayName: (n: string | null) => n ?? 'League' }))

import { MAX_FREE_AGENT_LEAGUES, freeAgentLeaguesFor, getFollowingCard } from '@/lib/core-app/followingCard'

const NOW = new Date('2026-09-16T12:00:00Z')
const GIBBS = '9221'
const KNOWN = ['100', '101', '102', '103']

const follow = (sleeperId: string, name: string) => ({
  sport: 'NFL', playerKey: sleeperId, externalId: null, sleeperId, name, position: 'RB', team: 'DET', createdAt: NOW,
})

type League = { id: string; name: string; platform: string; sport?: string }
const ICE: League = { id: 'lg-ice', name: 'Ice Kings', platform: 'sleeper', sport: 'NFL' }
const DYN: League = { id: 'lg-dyn', name: 'Dynasty', platform: 'sleeper', sport: 'NFL' }

/** Two full rosters per league (two teams), yours claimed; `extra` adds ids to the first roster. */
function setup(leagues: Array<{ league: League; yours?: boolean; teams?: number; rosters?: number; extra?: string[] }>) {
  const teams: Array<{ leagueId: string; claimedByUserId: string | null }> = []
  const rosters: Array<{ leagueId: string; playerData: unknown }> = []
  for (const { league, yours = true, teams: nTeams = 2, rosters: nRosters = nTeams, extra = [] } of leagues) {
    for (let i = 0; i < nTeams; i++) teams.push({ leagueId: league.id, claimedByUserId: i === 0 && yours ? 'u1' : `other-${i}` })
    for (let i = 0; i < nRosters; i++) {
      rosters.push({ leagueId: league.id, playerData: { players: i === 0 ? [...KNOWN.slice(0, 2), ...extra] : KNOWN.slice(2) } })
    }
  }
  h.teamFind.mockImplementation(async ({ where }: { where: { leagueId: { in: string[] } } }) =>
    teams.filter((t) => where.leagueId.in.includes(t.leagueId)),
  )
  h.rosterFind.mockImplementation(async ({ where }: { where: { leagueId: { in: string[] } } }) =>
    rosters.filter((r) => where.leagueId.in.includes(r.leagueId)),
  )
}

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.playerFind.mockImplementation(async ({ where }: { where: { sleeperId: { in: string[] } } }) =>
    where.sleeperId.in.filter((id) => KNOWN.includes(id) || id === GIBBS).map((sleeperId) => ({ sleeperId })),
  )
  h.gameFind.mockResolvedValue([])
  h.identityFind.mockResolvedValue([])
  h.resolveInjuryFacts.mockResolvedValue({
    byPlayer: new Map(), ambiguous: [], newestFetchedAt: NOW, feedStale: false, coverage: { sourceAvailable: true, reason: null },
  })
})

describe('freeAgentLeaguesFor', () => {
  it('🛑 on no roster in a fully imported league of yours → free agent there, linked to its waivers', async () => {
    setup([{ league: ICE }])
    const out = await freeAgentLeaguesFor('u1', [ICE], [GIBBS])
    expect(out.get(GIBBS)).toEqual([{ leagueId: 'lg-ice', leagueName: 'Ice Kings', href: '/core/waivers?league=lg-ice' }])
  })

  it('on a roster there → not a free agent', async () => {
    setup([{ league: ICE, extra: [GIBBS] }])
    const out = await freeAgentLeaguesFor('u1', [ICE], [GIBBS])
    expect(out.get(GIBBS)).toBeUndefined()
  })

  it('🛑 a PARTIAL import (fewer rosters than teams) never calls him a free agent', async () => {
    setup([{ league: ICE, teams: 3, rosters: 2 }])
    const out = await freeAgentLeaguesFor('u1', [ICE], [GIBBS])
    expect(out.get(GIBBS)).toBeUndefined()
  })

  it('🛑 rosters that do not speak Sleeper ids never call him a free agent', async () => {
    setup([{ league: ICE }])
    h.playerFind.mockResolvedValue([]) // none of the sampled ids are ours
    const out = await freeAgentLeaguesFor('u1', [ICE], [GIBBS])
    expect(out.get(GIBBS)).toBeUndefined()
  })

  it('🛑 only YOUR leagues — a league where you have no claimed team is not checked', async () => {
    setup([{ league: ICE, yours: false }, { league: DYN }])
    const out = await freeAgentLeaguesFor('u1', [ICE, DYN], [GIBBS])
    expect(out.get(GIBBS)?.map((l) => l.leagueId)).toEqual(['lg-dyn'])
    expect(h.rosterFind.mock.calls[0][0].where.leagueId.in).toEqual(['lg-dyn'])
  })

  it('another sport is not checked, and nothing is read', async () => {
    const out = await freeAgentLeaguesFor('u1', [{ ...ICE, sport: 'NBA' }], [GIBBS])
    expect(out.size).toBe(0)
    expect(h.teamFind).not.toHaveBeenCalled()
  })

  it(`reads rosters for at most ${MAX_FREE_AGENT_LEAGUES} of your leagues`, async () => {
    const many = Array.from({ length: MAX_FREE_AGENT_LEAGUES + 3 }, (_, i) => ({ ...ICE, id: `lg-${i}`, name: `L${i}` }))
    setup(many.map((league) => ({ league })))
    await freeAgentLeaguesFor('u1', many, [GIBBS])
    expect(h.rosterFind.mock.calls[0][0].where.leagueId.in).toHaveLength(MAX_FREE_AGENT_LEAGUES)
  })

  it('a failed roster read skips the nudge instead of calling everyone free', async () => {
    setup([{ league: ICE }])
    h.rosterFind.mockRejectedValue(new Error('db down'))
    const out = await freeAgentLeaguesFor('u1', [ICE], [GIBBS])
    expect(out.size).toBe(0)
  })
})

describe('getFollowingCard + nudge', () => {
  it('rows carry freeAgentIn; without leagues nothing is read and every row is []', async () => {
    h.listFollows.mockResolvedValue([follow(GIBBS, 'Jahmyr Gibbs')])
    setup([{ league: ICE }])
    const withLeagues = await getFollowingCard('u1', NOW, [ICE])
    expect(withLeagues?.rows[0].freeAgentIn.map((l) => l.leagueName)).toEqual(['Ice Kings'])

    h.teamFind.mockClear()
    const without = await getFollowingCard('u1', NOW)
    expect(without?.rows[0].freeAgentIn).toEqual([])
    expect(h.teamFind).not.toHaveBeenCalled()
  })
})
