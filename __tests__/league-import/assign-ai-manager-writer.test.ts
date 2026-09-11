/**
 * Assigning an AI manager to a vacant seat — the last of the six `LeagueTeam` writers Phase 3
 * changed, and the only one that had no test at all.
 *
 * 🛑 AN AI-MANAGED SEAT IS NOT AN EMPTY ONE, AND `isOrphan: false` WAS THE ONLY WAY THIS WRITER
 * COULD SAY SO. Clearing that flag made an AI seat indistinguishable from a human-claimed one:
 * `claimedByUserId` stays null here, so every recipient set built on the claim already excluded it,
 * but nothing could tell "run by a bot" from "run by a person who has not linked an account".
 * `managerKind: 'AI'` is that distinction, and it is what makes the eventual
 * "is an AI seat a valid trade partner / notification recipient" question answerable at all.
 *
 * ⚠ THIS WRITER HAS NEVER FIRED IN PRODUCTION. A read-only audit on 2026-09-10 found ZERO rows
 * carrying an AI signature — no `ai-manager-` platformUserId, no `'AI Manager'` ownerName — across
 * all 3,419 `league_teams`. That is precisely why it needs a test: there is no production evidence
 * to notice a regression in, so the suite is the only thing watching it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  assertCommissioner: vi.fn(),
  getOrphanRosterIds: vi.fn(),
  rosterFindFirst: vi.fn(),
  rosterUpdate: vi.fn(),
  leagueTeamUpdateMany: vi.fn(),
  findLeagueListingUpdateMany: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: h.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: h.assertCommissioner }))
vi.mock('@/lib/orphan-ai-manager/orphanRosterResolver', () => ({
  getOrphanRosterIdsForLeague: h.getOrphanRosterIds,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findFirst: h.rosterFindFirst, update: h.rosterUpdate },
    leagueTeam: { updateMany: h.leagueTeamUpdateMany },
    findLeagueListing: { updateMany: h.findLeagueListingUpdateMany },
  },
}))

function post(body: unknown) {
  return new Request('http://localhost/api/leagues/league-1/orphaned-teams/assign-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('assign-ai writes the AI manager state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.getServerSession.mockResolvedValue({ user: { id: 'commissioner-1' } })
    h.assertCommissioner.mockResolvedValue(undefined)
    h.getOrphanRosterIds.mockResolvedValue(['roster-9'])
    h.rosterFindFirst.mockResolvedValue({ settings: {}, platformUserId: 'open-slot-league-1-3' })
    h.rosterUpdate.mockResolvedValue({ id: 'roster-9' })
    h.leagueTeamUpdateMany.mockResolvedValue({ count: 1 })
    h.findLeagueListingUpdateMany.mockResolvedValue({ count: 1 })
  })

  it('marks the seat CURRENT/AI and clears the legacy flag', async () => {
    const { POST } = await import('@/app/api/leagues/[leagueId]/orphaned-teams/assign-ai/route')
    const res = await POST(post({ rosterId: 'roster-9' }) as never, {
      params: Promise.resolve({ leagueId: 'league-1' }),
    })
    expect(res.status).toBe(200)

    expect(h.leagueTeamUpdateMany).toHaveBeenCalledTimes(1)
    const arg = h.leagueTeamUpdateMany.mock.calls[0]![0] as {
      data: Record<string, unknown>
    }

    expect(arg.data.lifecycleState, 'an AI seat is a CURRENT franchise').toBe('CURRENT')
    expect(arg.data.managerKind, 'this is the only writer that can say AI').toBe('AI')
    /* Retained so no unmigrated reader changes meaning under this commit. */
    expect(arg.data.isOrphan).toBe(false)
  })

  it('🛑 assigning an AI manager is not an archival or an elimination', async () => {
    /*
     * The negative half. Handing a seat to a bot is the OPPOSITE of the franchise leaving, and a
     * writer that stamped either of these would remove a live team from its own league's counts
     * while the positive assertions above still passed.
     */
    const { POST } = await import('@/app/api/leagues/[leagueId]/orphaned-teams/assign-ai/route')
    await POST(post({ rosterId: 'roster-9' }) as never, {
      params: Promise.resolve({ leagueId: 'league-1' }),
    })

    const arg = h.leagueTeamUpdateMany.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(arg.data.lifecycleState).not.toBe('ARCHIVED')
    expect(arg.data.archivedAt ?? null).toBeNull()
    expect(arg.data.archiveReason ?? null).toBeNull()
    expect(arg.data.eliminatedAt ?? null).toBeNull()
    /* And it must not silently leave the seat unclassified, which is what UNKNOWN would mean. */
    expect(arg.data.managerKind).not.toBe('UNKNOWN')
  })

  it('refuses a roster that is not an orphan, so no state is written at all', async () => {
    /*
     * The guard that keeps this writer from touching a live human's seat. Without it, `managerKind`
     * would be settable to AI on any roster id a commissioner could name.
     */
    h.getOrphanRosterIds.mockResolvedValue(['some-other-roster'])

    const { POST } = await import('@/app/api/leagues/[leagueId]/orphaned-teams/assign-ai/route')
    const res = await POST(post({ rosterId: 'roster-9' }) as never, {
      params: Promise.resolve({ leagueId: 'league-1' }),
    })

    expect(res.status).toBe(400)
    expect(h.leagueTeamUpdateMany).not.toHaveBeenCalled()
    expect(h.rosterUpdate).not.toHaveBeenCalled()
  })
})
