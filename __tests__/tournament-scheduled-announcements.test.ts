// @vitest-environment node
/**
 * Guards the sweep that turns a scheduled announcement into a delivery.
 *
 * 🛑 WITHOUT IT, "SCHEDULE" MEANS "SAVE AND FORGET". A scheduled broadcast is a
 * row with a time on it, not a timer — so a commissioner who schedules Tuesday's
 * redraft notice gets nothing sent on Tuesday.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const announcementFindMany = vi.fn()
const announcementUpdate = vi.fn()
const auditCreate = vi.fn()
const dispatch = vi.fn()
const getBoard = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tournamentAnnouncement: {
      findMany: (...a: unknown[]) => announcementFindMany(...a),
      update: (...a: unknown[]) => announcementUpdate(...a),
    },
    tournamentAuditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({
  dispatchNotification: (...a: unknown[]) => dispatch(...a),
}))
vi.mock('@/lib/tournament/standingsBoard', () => ({
  getTournamentStandingsBoard: (...a: unknown[]) => getBoard(...a),
}))

import { postDueTournamentAnnouncements } from '@/lib/tournament/postDueAnnouncements'

function boardWith(rows: Array<{ name: string; appUserId: string | null; standing: 'in' | 'out' }>) {
  return {
    tournamentId: 't1',
    name: 'KBI',
    roundNumber: 1,
    advancersPerLeague: 0,
    wildcardCount: 1,
    bubbleEnabled: false,
    bubbleSize: 0,
    tiebreakerMode: 'points_for',
    unmatchedTotal: 0,
    oldestUpdatedAt: null,
    conferences: [
      {
        id: 'c1',
        name: 'BLACK',
        colorHex: null,
        qualifyingCount: 1,
        conferencePoints: 0,
        leagues: [
          {
            tournamentLeagueId: 'tl1',
            leagueId: 'lg1',
            name: 'BEAST',
            unmatchedCount: 0,
            unclaimedTeams: [],
            oldestUpdatedAt: null,
            rows: rows.map((r) => ({
              leagueParticipantId: `lp-${r.name}`,
              participantId: `p-${r.name}`,
              userId: `u-${r.name}`,
              displayName: r.name,
              wins: 1,
              losses: 1,
              ties: 0,
              pointsFor: 100,
              pointsAgainst: 90,
              appUserId: r.appUserId,
              leagueRank: 1,
              conferenceRank: 1,
              unmatched: false,
              matchedBy: 'platformUserId' as const,
              standing: r.standing,
            })),
          },
        ],
      },
    ],
  }
}

const DUE = {
  id: 'a1',
  tournamentId: 't1',
  title: 'Redraft is open',
  content: 'You advanced.',
  targetAudience: 'standing:in',
  tournament: { commissionerId: 'commish' },
}

beforeEach(() => {
  vi.clearAllMocks()
  announcementFindMany.mockResolvedValue([DUE])
  announcementUpdate.mockResolvedValue({})
  auditCreate.mockResolvedValue({})
  dispatch.mockResolvedValue(undefined)
  getBoard.mockResolvedValue(
    boardWith([
      { name: 'TyT1', appUserId: 'af-1', standing: 'in' },
      { name: 'emmae', appUserId: null, standing: 'in' },
      { name: 'RICO3', appUserId: 'af-2', standing: 'out' },
    ]),
  )
})

it('only looks at unposted announcements whose time has passed', async () => {
  const now = new Date('2025-11-04T18:00:00Z')
  await postDueTournamentAnnouncements({ now })
  expect(announcementFindMany.mock.calls[0][0].where).toMatchObject({
    isPosted: false,
    scheduledFor: { not: null, lte: now },
  })
})

/**
 * 🛑 THE AUDIENCE IS RE-RESOLVED AT SEND TIME, NOT REPLAYED. A message scheduled
 * on Sunday for Tuesday is aimed at a GROUP, and that group changes when Monday
 * night's games finish. Freezing the list at compose time sends "you advanced"
 * to people who no longer have.
 */
it('resolves the audience against the board as it is now', async () => {
  const out = await postDueTournamentAnnouncements({})
  expect(getBoard).toHaveBeenCalledWith('t1', 'commish')
  expect(dispatch.mock.calls[0][0].userIds).toEqual(['af-1'])
  expect(out.posted).toBe(1)
  expect(out.delivered).toBe(1)
})

/**
 * ⚠ MARKED POSTED BEFORE DISPATCH. If the fan-out throws after reaching half the
 * list, a still-unposted row is picked up by the next sweep and those people are
 * messaged twice. A missed notification is recoverable; a duplicate "your season
 * is over" is not.
 */
it('marks the row posted before dispatching', async () => {
  const order: string[] = []
  announcementUpdate.mockImplementation(async () => {
    order.push('update')
    return {}
  })
  dispatch.mockImplementation(async () => {
    order.push('dispatch')
  })
  await postDueTournamentAnnouncements({})
  expect(order).toEqual(['update', 'dispatch'])
})

/**
 * 🛑 AN UNREADABLE AUDIENCE IS SKIPPED, NOT BROADENED. Falling back to everyone
 * would send a message written for eight eliminated managers to the whole field
 * — and a scheduled send has nobody watching when it fires.
 */
it('skips an announcement whose audience it cannot parse, leaving it unposted', async () => {
  announcementFindMany.mockResolvedValue([{ ...DUE, targetAudience: 'winners' }])
  const out = await postDueTournamentAnnouncements({})
  expect(out.posted).toBe(0)
  expect(out.skipped[0]).toMatchObject({ reason: 'unrecognised audience' })
  expect(announcementUpdate).not.toHaveBeenCalled()
  expect(dispatch).not.toHaveBeenCalled()
})

/** ⚠ An empty audience usually means the standings moved — leave it visible. */
it('leaves an announcement unposted when nobody matches any more', async () => {
  getBoard.mockResolvedValue(boardWith([{ name: 'RICO3', appUserId: 'af-2', standing: 'out' }]))
  const out = await postDueTournamentAnnouncements({})
  expect(out.posted).toBe(0)
  expect(out.skipped[0]).toMatchObject({ reason: 'audience is empty now' })
  expect(announcementUpdate).not.toHaveBeenCalled()
})

it('skips a tournament it cannot read rather than throwing the whole sweep', async () => {
  getBoard.mockResolvedValue(null)
  const out = await postDueTournamentAnnouncements({})
  expect(out.due).toBe(1)
  expect(out.posted).toBe(0)
  expect(out.skipped[0]).toMatchObject({ reason: 'tournament not readable' })
})

/** A dry run reports what would go out and writes nothing — the first-run check. */
it('writes nothing on a dry run', async () => {
  const out = await postDueTournamentAnnouncements({ dryRun: true })
  expect(out).toMatchObject({ dryRun: true, posted: 1, delivered: 1 })
  expect(announcementUpdate).not.toHaveBeenCalled()
  expect(dispatch).not.toHaveBeenCalled()
})
