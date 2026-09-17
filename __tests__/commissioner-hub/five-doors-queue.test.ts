import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Five-doors restyle (2026-09-17): the all-leagues and one-league Commissioner Hub
 * views build their queue with ONE function, and the old 11a hub's detectors are
 * merged into it rather than dropped. Two of those detectors counted the wrong thing;
 * the read that replaces them is pinned here by its WHERE clause, because a count
 * that is merely "some number" passes every render test.
 */

const m = vi.hoisted(() => ({
  aiCommissionerAlert: { groupBy: vi.fn() },
  redraftTradeProposal: { groupBy: vi.fn() },
  redraftWaiverClaim: { groupBy: vi.fn() },
  leagueSettings: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: m }))

import { buildTaskCards } from '@/lib/core-app/commissioner/tasks'
import { NO_REVIEW_SIGNALS, OVERDUE_CLAIM_DAYS, reviewSignalCards } from '@/lib/core-app/commissioner/signals'
import { readReviewSignals } from '@/lib/core-app/commissioner/signalReads'
import { leagueHubArt, ROBOT_KING_ART } from '@/lib/core-app/commissioner/leagueArt'
import { quietManagerNames } from '@/lib/core-app/commissioner/activity'

const NOW = new Date('2026-10-12T15:00:00Z')

describe('review signal cards', () => {
  it('draws nothing when no signal is on', () => {
    expect(reviewSignalCards('L1', NO_REVIEW_SIGNALS)).toEqual([])
  })

  it('draws one card per signal, each with a real destination', () => {
    const cards = reviewSignalCards('L1', {
      integrityAlerts: 2,
      tradesAwaitingReview: 1,
      overdueWaiverClaims: 3,
      draftDateMissing: true,
    })
    expect(cards.map((c) => [c.id, c.title, c.action?.href])).toEqual([
      ['review:integrity', '2 open integrity alerts', '/league/L1/commissioner/integrity'],
      ['review:trades', '1 trade awaiting your review', '/league/L1?view=trades'],
      ['review:waivers', '3 waiver claims waiting over a week', '/core/commissioner?league=L1#ch-waivers'],
      ['review:draft-date', 'No draft date set', '/league/L1/settings'],
    ])
    expect(cards.every((c) => c.source === 'review')).toBe(true)
  })

  it('joins the same queue the one-league screen ranks, worst first', () => {
    const { cards } = buildTaskCards({
      issues: [],
      flags: [],
      calendar: [],
      workspace: [],
      signals: { leagueId: 'L1', values: { ...NO_REVIEW_SIGNALS, draftDateMissing: true, tradesAwaitingReview: 2 } },
      staleSync: { days: 9, href: '/core/sync?league=L1', platformLabel: 'Sleeper' },
    })
    // stale sync (bad, 9 days) → trades (warn) → draft date (info)
    expect(cards.map((c) => c.id)).toEqual(['stale-sync', 'review:trades', 'review:draft-date'])
  })
})

describe('readReviewSignals', () => {
  beforeEach(() => {
    for (const model of Object.values(m)) for (const fn of Object.values(model)) (fn as ReturnType<typeof vi.fn>).mockReset()
    m.aiCommissionerAlert.groupBy.mockResolvedValue([{ leagueId: 'IMP', _count: { _all: 1 } }])
    m.redraftTradeProposal.groupBy.mockResolvedValue([{ leagueId: 'NAT', _count: { _all: 2 } }])
    m.redraftWaiverClaim.groupBy.mockResolvedValue([{ leagueId: 'NAT', _count: { _all: 4 } }])
    m.leagueSettings.findMany.mockResolvedValue([{ leagueId: 'DATED', draftDateUtc: new Date() }])
  })

  const leagues = [
    { id: 'NAT', native: true, status: 'in_season' },
    { id: 'IMP', native: false, status: 'pre_draft' },
    { id: 'NODATE', native: true, status: 'pre_draft' },
    { id: 'DATED', native: true, status: null, lifecycleState: 'pre_draft' },
    { id: 'DRAFTING', native: true, status: 'drafting' },
  ]

  it('counts a trade as awaiting review only once the receiver accepted it, in a commissioner-veto league', async () => {
    await readReviewSignals(leagues, NOW)
    const where = m.redraftTradeProposal.groupBy.mock.calls[0][0].where
    expect(where).toEqual({
      leagueId: { in: ['NAT', 'NODATE', 'DATED', 'DRAFTING'] },
      status: 'pending',
      acceptedAt: { not: null },
      vetoMode: 'commissioner',
    })
  })

  it('counts only waiver claims a run should already have decided', async () => {
    await readReviewSignals(leagues, NOW)
    const where = m.redraftWaiverClaim.groupBy.mock.calls[0][0].where
    expect(where.status).toBe('pending')
    expect(where.submittedAt.lt.toISOString()).toBe(
      new Date(NOW.getTime() - OVERDUE_CLAIM_DAYS * 86_400_000).toISOString(),
    )
  })

  it('flags a missing draft date only on an AllFantasy league that has not drafted', async () => {
    const { byLeague, partial } = await readReviewSignals(leagues, NOW)
    expect(partial).toBe(false)
    expect(m.leagueSettings.findMany.mock.calls[0][0].where).toEqual({ leagueId: { in: ['NODATE', 'DATED'] } })
    expect(byLeague.get('NODATE')?.draftDateMissing).toBe(true)
    expect(byLeague.get('DATED')?.draftDateMissing).toBe(false)
    expect(byLeague.get('IMP')?.draftDateMissing).toBe(false) // imports carry no draft date to check
    expect(byLeague.get('DRAFTING')?.draftDateMissing).toBe(false)
    expect(byLeague.get('NAT')).toMatchObject({ tradesAwaitingReview: 2, overdueWaiverClaims: 4, integrityAlerts: 0 })
    expect(byLeague.get('IMP')).toMatchObject({ integrityAlerts: 1, tradesAwaitingReview: 0 })
  })

  it('says partial, and flags no draft date, when the settings read fails', async () => {
    m.leagueSettings.findMany.mockRejectedValue(new Error('P2021'))
    const { byLeague, partial } = await readReviewSignals(leagues, NOW)
    expect(partial).toBe(true)
    expect(byLeague.get('NODATE')?.draftDateMissing).toBe(false)
  })

  it('does not query native-only tables for an account with only imported leagues', async () => {
    await readReviewSignals([{ id: 'IMP', native: false, status: 'in_season' }], NOW)
    expect(m.redraftTradeProposal.groupBy).not.toHaveBeenCalled()
    expect(m.redraftWaiverClaim.groupBy).not.toHaveBeenCalled()
  })
})

describe('quietManagerNames', () => {
  const rows = [
    { name: 'Open Team 10', status: 'inactive' as const },
    { name: 'Owls FC', status: 'inactive' as const },
    { name: 'Mike', status: 'active' as const },
    { name: 'Ghost Town', status: 'inactive' as const },
  ]
  const teams = [
    { teamName: 'Open Team 10', ownerName: null, claimedByUserId: null, platformUserId: null, isOrphan: false },
    { teamName: 'Owls FC', ownerName: 'owl', claimedByUserId: 'u2', platformUserId: 'p2', isOrphan: false },
    { teamName: 'Mike', ownerName: 'mike', claimedByUserId: 'u3', platformUserId: 'p3', isOrphan: false },
    { teamName: 'Ghost Town', ownerName: null, claimedByUserId: null, platformUserId: null, isOrphan: true },
  ]

  it('names people, never the empty seats of a league AllFantasy runs', () => {
    expect(quietManagerNames(rows, teams, true)).toEqual(['Owls FC'])
  })

  it('on an import, drops only teams with no owner at all', () => {
    // "Open Team 10" is unclaimed here but not an orphan, so a platform manager holds it.
    expect(quietManagerNames(rows, teams, false)).toEqual(['Open Team 10', 'Owls FC'])
  })

  it('leaves out the viewer’s own team', () => {
    expect(quietManagerNames(rows, teams, true, 'u2')).toEqual([])
    expect(quietManagerNames(rows, teams, false, 'u2')).toEqual(['Open Team 10'])
  })
})

describe('hub key art', () => {
  it('gives a format league its own loop', () => {
    expect(leagueHubArt({ leagueType: 'dynasty' })).toEqual({
      label: 'Dynasty',
      video: '/league-type-dynasty.mp4',
      poster: '/league-type-dynasty.png',
    })
    expect(leagueHubArt({ leagueType: 'redraft', guillotineMode: true }).video).toBe(null) // type column wins
    expect(leagueHubArt({ leagueType: null, guillotineMode: true }).video).toBe('/league-type-guillotine.mp4')
  })

  it('gives redraft the robot king, because redraft has no loop', () => {
    expect(leagueHubArt({ leagueType: 'redraft' })).toEqual({ ...ROBOT_KING_ART, label: 'Redraft' })
    expect(leagueHubArt({})).toEqual({ ...ROBOT_KING_ART, label: 'Redraft' })
  })

  it('does not call an unknown format "Redraft"', () => {
    expect(leagueHubArt({ leagueType: 'king_of_the_hill' })).toEqual(ROBOT_KING_ART)
  })
})
