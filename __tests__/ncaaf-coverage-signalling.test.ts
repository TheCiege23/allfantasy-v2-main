/**
 * NCAAF coverage signalling — injuries and projections.
 *
 * WHY THIS FILE EXISTS
 * College football has no injury report to import and no weekly projection feed to buy. That is
 * a permanent fact about the sport, not a bug to fix, and every few weeks someone re-investigates
 * it from scratch. These tests pin what was measured so the next person reads instead of digs:
 *
 *   INJURIES  Rolling Insights' committed contract sets `injuries: { NCAAFB: false }` and states
 *             "NCAAFB and NCAABB have NO injuries endpoint. College injury data must come from
 *             another source or be omitted with an explicit 'not available' flag."
 *             ESPN's college-football injuries feed, measured 2026-08-30, returned 3 rows across
 *             3 teams against 800 across 32 for the NFL — and the three it does return are dated
 *             2020-11-21, 2022-11-03 and 2022-11-26. CollegeFootballData 404s on /player/injuries
 *             (measured 2026-08-13, recorded in app/api/cron/import-projections/route.ts).
 *             The NCAA mandates no injury disclosure, so this is the sport, not the vendors.
 *
 *   PROJECTIONS  No vendor sells weekly college projections; CFBD 404s /projections/player.
 *             But `AFProjectionSnapshot` held 10,188 COMPUTED NCAAF rows on 2026-08-30 — more
 *             than the NFL's 1,576 — derived from 13,433 NCAAF `fantasy_stat_lines`. So
 *             "no projections exist" is false and must not be said.
 *
 * THE BUG THESE GUARD AGAINST is not the absence. It is rendering the absence as an answer:
 * an empty injury list reads as "your starters are fine", and a blank projection reads as "we
 * have no opinion". Both are claims, and both are wrong.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { projectionCoverageFor } from '@/lib/projections/projectionCoverage'

const findMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: { sportsInjury: { findMany: (...a: unknown[]) => findMany(...a) } },
}))

vi.mock('@/lib/player-match/verifiedNameMatch', () => ({
  buildNameIndex: () => new Map(),
  normalizeMatchName: (s: string) => String(s).toLowerCase(),
  resolveVerifiedMatch: () => ({ match: null, ambiguous: false }),
}))

import { injuryCoverageFor, listInjuryFacts, resolveInjuryFacts } from '@/lib/injuries/injuryReadPort'

beforeEach(() => {
  vi.clearAllMocks()
  findMany.mockResolvedValue([])
})

describe('injury coverage reaches the caller, not just the helper', () => {
  it('reports NCAAF as unsourceable with a reason that says "cannot know", not "nobody hurt"', () => {
    const cov = injuryCoverageFor('NCAAF')
    expect(cov.covered).toBe(false)
    expect(cov.reason).toBeTruthy()
    // The distinction is the entire point of the message.
    expect(cov.reason!.toLowerCase()).toContain('cannot know')
  })

  it('carries coverage on the LIST payload so a caller cannot render a bare empty list', async () => {
    const list = await listInjuryFacts({ sport: 'NCAAF' })

    expect(list.facts).toEqual([])
    expect(list.coverage.sourceAvailable).toBe(false)
    expect(list.coverage.reason).toBeTruthy()
  })

  it('carries coverage on the RESOLVE payload too', async () => {
    const res = await resolveInjuryFacts({
      sport: 'NCAAF',
      players: [{ name: 'Some College Player' }],
    })

    expect(res.byPlayer.size).toBe(0)
    expect(res.coverage.sourceAvailable).toBe(false)
    expect(res.coverage.reason).toBeTruthy()
  })

  it('does not query at all for an unsourceable sport', async () => {
    await listInjuryFacts({ sport: 'NCAAF' })
    await resolveInjuryFacts({ sport: 'NCAAF', players: [{ name: 'X' }] })
    // The three archival 2020/2022 rows are still in the table; short-circuiting means we never
    // read them, so no future change to the age cutoff can accidentally serve them as current.
    expect(findMany).not.toHaveBeenCalled()
  })

  it('does NOT report an unsourceable sport as a stale feed', async () => {
    // `feedStale` means "ingestion stopped" — an operator signal. NCAAF ingestion has not
    // stopped; there is nothing to ingest. Conflating them sends someone to fix a healthy cron.
    const list = await listInjuryFacts({ sport: 'NCAAF' })
    expect(list.feedStale).toBe(false)
  })

  it('leaves NFL fully covered and still queries for it', async () => {
    const list = await listInjuryFacts({ sport: 'NFL' })
    expect(list.coverage.sourceAvailable).toBe(true)
    expect(list.coverage.reason).toBeNull()
    expect(findMany).toHaveBeenCalled()
  })
})

describe('projection coverage', () => {
  it('says NCAAF has no WEEKLY feed but does have season-long projections', () => {
    const cov = projectionCoverageFor('NCAAF')
    expect(cov.weeklyFeedAvailable).toBe(false)
    expect(cov.seasonLongAvailable).toBe(true)
    expect(cov.reason).toBeTruthy()
  })

  it('never claims college projections do not exist', () => {
    // 10,188 computed NCAAF rows existed when this was written. Copy that denies them is false.
    const reason = projectionCoverageFor('NCAAF').reason!.toLowerCase()
    expect(reason).toContain('season-long')
    expect(reason).not.toMatch(/no projections (exist|are available)/)
  })

  it('reports NFL as having a weekly feed with nothing to explain', () => {
    const cov = projectionCoverageFor('NFL')
    expect(cov.weeklyFeedAvailable).toBe(true)
    expect(cov.reason).toBeNull()
  })

  it('gives an unknown sport a generic reason rather than throwing or claiming coverage', () => {
    const cov = projectionCoverageFor('QUIDDITCH')
    expect(cov.weeklyFeedAvailable).toBe(false)
    expect(cov.seasonLongAvailable).toBe(false)
    expect(cov.reason).toBeTruthy()
  })

  it('is case- and whitespace-insensitive, since callers pass league sport verbatim', () => {
    expect(projectionCoverageFor('  ncaaf ').weeklyFeedAvailable).toBe(false)
    expect(projectionCoverageFor('nfl').weeklyFeedAvailable).toBe(true)
  })
})
