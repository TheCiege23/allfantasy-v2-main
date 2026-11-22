// @vitest-environment node
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  userProfile: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { careerJoinRefusal, evaluateCareerJoinGate } from '@/lib/league-join/careerJoinGate'

beforeEach(() => {
  db.league.findUnique.mockReset()
  db.userProfile.findMany.mockResolvedValue([
    { userId: 'u', xpTotal: 5500n },
    { userId: 'other', xpTotal: 5500n },
    { userId: 'owner', xpTotal: 32000n },
  ])
})

describe('Career Level joins', () => {
  it.each(['public', 'private'])('allows a three-level gap and refuses four in a %s league', async (visibility) => {
    db.league.findUnique.mockResolvedValueOnce({ userId: 'owner', settings: { creatorRankLevel: 11, league_privacy_visibility: visibility } })
    expect(await evaluateCareerJoinGate('u', 'L')).toMatchObject({ userLevel: 8, leagueLevel: 11, canJoin: true })
    db.league.findUnique.mockResolvedValueOnce({ userId: 'owner', settings: { creatorRankLevel: 12, league_privacy_visibility: visibility } })
    const refused = await evaluateCareerJoinGate('u', 'L')
    expect(refused).toMatchObject({ userLevel: 8, leagueLevel: 12, band: [9, 15], canJoin: false })
    expect(careerJoinRefusal(refused!, 'L')).toMatchObject({ code: 'CAREER_LEVEL_GATE_BLOCKED', canRequest: true, leagueId: 'L' })
  })

  it('uses the older league’s owner level and grants an exception to one manager', async () => {
    db.league.findUnique.mockResolvedValue({
      userId: 'owner',
      settings: { classExceptions: [{ userId: 'u', grantedBy: 'owner', via: 'request' }] },
    })
    expect(await evaluateCareerJoinGate('u', 'L')).toMatchObject({ leagueLevel: 13, canJoin: true })
    expect(await evaluateCareerJoinGate('other', 'L')).toMatchObject({ leagueLevel: 13, canJoin: false })
  })

  it('cannot authorize an unverifiable join when the rank query fails', async () => {
    db.league.findUnique.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(evaluateCareerJoinGate('u', 'L')).rejects.toThrow('database unavailable')
  })

  it('checks codes, tracked invite tokens, and open team claims before seating a manager', () => {
    const code = readFileSync('app/api/leagues/join/route.ts', 'utf8')
    const tracked = readFileSync('lib/invite-engine/InviteEngine.ts', 'utf8')
    const claim = readFileSync('app/api/league/invite/claim/route.ts', 'utf8')
    expect(code).toContain('evaluateCareerJoinGate(userId, result.leagueId, undefined, tx)')
    expect(tracked).toContain('evaluateCareerJoinGate(userId, leagueId, undefined, tx)')
    expect(tracked).toContain('createFantasyLeagueRoster(link.targetId, userId, { inviteLinkId: link.id })')
    expect(claim).toMatch(/if \(eligibility === 'open'\) \{\s*const careerGate = await evaluateCareerJoinGate/)
  })
})
