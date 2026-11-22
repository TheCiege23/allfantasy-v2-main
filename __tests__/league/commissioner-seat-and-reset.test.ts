// @vitest-environment node
/**
 * Head-only actions stay head-only under the shared rule (lib/league/commissionerAccess.ts, 2026-11-16):
 *   - releasing or reassigning a commissioner's seat (the owner's team, or a commissioner / co-commissioner team);
 *     any other seat is league setup. Both handlers let ANY co-commissioner through before.
 *   - wiping the draft from the draft room, which was open to every co-commissioner while the settings screen's reset
 *     was already head-only.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const h = vi.hoisted(() => ({
  asked: [] as string[],
  allowed: new Set<string>(),
  roster: { platformUserId: 'someone' } as { platformUserId: string } | null,
  team: null as { isCommissioner: boolean; isCoCommissioner: boolean } | null,
  release: vi.fn(async () => ({ ok: true })),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'co-user' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/commissionerAccess', () => ({
  commissionerAccessResponse: vi.fn(async (_l: string, _u: string, need: string) => {
    h.asked.push(need)
    return h.allowed.has(need) ? null : NextResponse.json({ error: 'refused' }, { status: 403 })
  }),
}))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: vi.fn() }))
vi.mock('@/lib/orphan-ai-manager/orphanRosterResolver', () => ({ isOrphanPlatformUserId: () => false }))
vi.mock('@/lib/discovery-analytics/server', () => ({ trackDiscoveryOrphanAdoption: vi.fn() }))
vi.mock('@/lib/league/leagueSeats', () => ({ releaseLeagueSeat: h.release, assignLeagueSeat: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/inactive-manager/inactiveManagerService', () => ({ endManagedForNewOwners: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})),
    league: { findFirst: vi.fn(async () => ({ userId: 'owner' })) },
    roster: { findFirst: vi.fn(async () => h.roster) },
    leagueTeam: { findFirst: vi.fn(async () => h.team) },
  },
}))

import { DELETE as releaseSeat } from '@/app/api/commissioner/leagues/[leagueId]/managers/route'

const del = () =>
  releaseSeat(
    Object.assign(new Request('https://x?rosterId=r1', { method: 'DELETE' }), { nextUrl: new URL('https://x?rosterId=r1') }) as never,
    { params: Promise.resolve({ leagueId: 'L' }) },
  )

beforeEach(() => {
  h.asked = []
  h.allowed = new Set(['league'])
  h.roster = { platformUserId: 'someone' }
  h.team = { isCommissioner: false, isCoCommissioner: false }
  h.release.mockClear()
})

describe('releasing a seat', () => {
  it('an ordinary manager\'s seat is league setup', async () => {
    expect((await del()).status).toBe(200)
    expect(h.asked).toEqual(['league'])
    expect(h.release).toHaveBeenCalledTimes(1)
  })

  it('the owner\'s seat, a commissioner seat and a co-commissioner seat are the head commissioner\'s alone', async () => {
    for (const setup of [
      () => { h.roster = { platformUserId: 'owner' } },
      () => { h.team = { isCommissioner: true, isCoCommissioner: false } },
      () => { h.team = { isCommissioner: false, isCoCommissioner: true } },
    ]) {
      h.asked = []
      h.roster = { platformUserId: 'someone' }
      h.team = { isCommissioner: false, isCoCommissioner: false }
      setup()
      expect((await del()).status).toBe(403)
      expect(h.asked).toEqual(['head'])
    }
    expect(h.release).not.toHaveBeenCalled()
  })
})

describe('the draft room reset', () => {
  it('is head-only; every other draft-room control is league setup', () => {
    const src = readFileSync(path.resolve(__dirname, '../../app/api/leagues/[leagueId]/draft/controls/route.ts'), 'utf8')
    expect(src).toMatch(/^\s*const refused = await commissionerAccessResponse\(leagueId, userId, action === 'reset_draft' \? 'head' : 'league'\)$/m)
  })
})
