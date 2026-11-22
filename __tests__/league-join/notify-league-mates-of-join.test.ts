/**
 * The managers already in a league hear when a league mate arrives, by invite link or by importing the
 * same league (lib/league-join/notifyCommissionerOfJoin.ts `notifyLeagueMatesOfJoin`).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  leagueTeam: { findMany: vi.fn(), count: vi.fn() },
  userProfile: { findFirst: vi.fn() },
  referral: { findUnique: vi.fn() },
  dispatch: vi.fn(async (_p: unknown) => undefined),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: m.league, leagueTeam: m.leagueTeam, userProfile: m.userProfile, referral: m.referral } }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.dispatch }))
vi.mock('@/lib/guillotine/lateStartSeats', () => ({ resolveGuillotineEffectiveSeats: vi.fn(async () => null) }))

const { notifyLeagueMatesOfJoin } = await import('@/lib/league-join/notifyCommissionerOfJoin')

const teams = (...claimed: Array<string | null>) => claimed.map((claimedByUserId) => ({ claimedByUserId }))

beforeEach(() => {
  vi.clearAllMocks()
  m.league.findUnique.mockResolvedValue({ name: 'Dynasty Bros', userId: 'owner' })
  m.userProfile.findFirst.mockResolvedValue({ displayName: 'Sam', sleeperUsername: null })
  m.referral.findUnique.mockResolvedValue(null)
  m.leagueTeam.findMany.mockResolvedValue(teams('owner', 'ana', 'ben', 'sam', null, null))
})

describe('notifyLeagueMatesOfJoin', () => {
  it('tells the managers already here, with how many are here and how many to invite', async () => {
    await notifyLeagueMatesOfJoin({ leagueId: 'L1', joinerUserId: 'sam' })
    expect(m.dispatch).toHaveBeenCalledTimes(1)
    expect(m.dispatch.mock.calls[0][0]).toMatchObject({
      userIds: ['ana', 'ben'],
      category: 'league_announcements',
      type: 'league_mate_joined',
      title: 'Sam joined Dynasty Bros',
      body: '4 of 6 managers are here now. Invite the other 2 from the league page.',
      actionHref: '/league/L1',
      dedupePrefix: 'league_mate_joined:L1:sam',
      skipChannels: { email: true, sms: true },
    })
  })

  it('does not tell the joiner, the owner or the inviter: each has their own line or needs none', async () => {
    m.referral.findUnique.mockResolvedValue({ referrerId: 'ana' })
    await notifyLeagueMatesOfJoin({ leagueId: 'L1', joinerUserId: 'sam' })
    expect((m.dispatch.mock.calls[0][0] as { userIds: string[] }).userIds).toEqual(['ben'])
  })

  it('says so when the league is complete', async () => {
    m.leagueTeam.findMany.mockResolvedValue(teams('owner', 'ana', 'sam'))
    await notifyLeagueMatesOfJoin({ leagueId: 'L1', joinerUserId: 'sam' })
    expect((m.dispatch.mock.calls[0][0] as { body: string }).body).toBe('All 3 managers are here now.')
  })

  it('sends nothing when nobody else is here yet', async () => {
    m.leagueTeam.findMany.mockResolvedValue(teams('owner', 'sam', null))
    await notifyLeagueMatesOfJoin({ leagueId: 'L1', joinerUserId: 'sam' })
    expect(m.dispatch).not.toHaveBeenCalled()
  })
})

describe('both doors into a league send it', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  it('the invite-link join', () => {
    expect(read('app/api/leagues/join/route.ts')).toMatch(/^\s*void notifyLeagueMatesOfJoin\(\{ leagueId: joinResult\.leagueId, joinerUserId: userId \}\)/m)
  })
  it('an import that joins a league already here, once (not on a repeat click)', () => {
    const src = read('lib/league-import/ImportedLeagueCommitService.ts')
    const guard = src.indexOf('if (!joined.existed) {')
    expect(guard).toBeGreaterThan(0)
    expect(src.indexOf('void notifyCommissionerOfJoin({ leagueId: joinedLeagueId, joinerUserId: userId })')).toBeGreaterThan(guard)
    expect(src.indexOf('void notifyLeagueMatesOfJoin({ leagueId: joinedLeagueId, joinerUserId: userId })')).toBeGreaterThan(guard)
  })
})
