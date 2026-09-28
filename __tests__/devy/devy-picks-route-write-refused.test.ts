/**
 * 🛑 `PATCH /api/devy/picks` MOVED ANY TRADEABLE DEVY PICK BETWEEN ANY TWO ROSTERS (found 2026-09-25).
 *
 * The handler checked only that the caller was a MEMBER of the league, then called
 * `processPickTrade(leagueId, fromRosterId, toRosterId, pickId)` with both roster ids taken from the
 * request body. `processPickTrade` checks only that `fromRosterId` is the pick's current owner — which
 * any member can read back from `GET /api/devy/picks?type=all`. So a member who owned neither roster
 * could take another team's pick, and even the owner could hand one to a team that never agreed:
 * a transfer, not a trade.
 *
 * Nothing in the app sends a PATCH here (every caller of `/api/devy/picks` is a GET), so the write
 * path is removed rather than patched: a pick changes hands through the trade engine, where both
 * sides consent. These pin that it stays removed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  userId: 'member-with-no-stake' as string | null,
  processPickTrade: vi.fn(async () => ({ id: 'pick-1', currentOwnerId: 'roster-b' })),
  assertLeagueMember: vi.fn(async () => ({ ok: true as const })),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => (h.userId ? { user: { id: h.userId } } : null)) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { devyLeague: { findUnique: vi.fn(async () => ({ season: 2026 })) }, devyDraftPick: { findMany: vi.fn(async () => []) } } }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: h.assertLeagueMember }))
vi.mock('@/lib/devy/pickInventoryEngine', () => ({
  generatePickInventory: vi.fn(async () => ({ years: [] })),
  processPickTrade: h.processPickTrade,
}))

import { NextRequest } from 'next/server'
import * as route from '@/app/api/devy/picks/route'

const patch = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost/api/devy/picks', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

// Roster A owns the pick; the caller owns neither roster A nor roster B.
const TAKE_ANOTHER_TEAMS_PICK = {
  leagueId: 'lg-1',
  pickId: 'pick-1',
  action: 'trade',
  fromRosterId: 'roster-a',
  toRosterId: 'roster-b',
}

describe('PATCH /api/devy/picks is not a way to move a pick', () => {
  beforeEach(() => {
    h.userId = 'member-with-no-stake'
    h.processPickTrade.mockClear()
    h.assertLeagueMember.mockClear()
  })

  it('🛑 a member who owns neither roster cannot move another team’s pick', async () => {
    const res = await route.PATCH(patch(TAKE_ANOTHER_TEAMS_PICK))
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET')
    // The pick never moved — the write never ran.
    expect(h.processPickTrade).not.toHaveBeenCalled()
  })

  it('and neither can anyone else, the pick’s owner and the commissioner included', async () => {
    h.userId = 'owner-of-roster-a'
    const res = await route.PATCH(patch(TAKE_ANOTHER_TEAMS_PICK))
    expect(res.status).toBe(405)
    expect(h.processPickTrade).not.toHaveBeenCalled()
  })

  it('reading picks still works for a member', async () => {
    const res = await route.GET(new NextRequest('http://localhost/api/devy/picks?leagueId=lg-1&type=all'))
    expect(res.status).toBe(200)
  })
})
