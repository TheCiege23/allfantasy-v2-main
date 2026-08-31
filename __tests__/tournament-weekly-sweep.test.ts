// @vitest-environment node
/**
 * Guards the scheduled writer behind the players-of-the-week read.
 *
 * 🛑 A READ POINTED AT A TABLE NOTHING REFRESHES FAILS SILENTLY AND LOOKS
 * CORRECT — which is the state `WeeklyScore` was already in for imported
 * leagues. The reader and this sweep land together or not at all, so the sweep's
 * failure behaviour is part of the feature rather than an afterthought.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const tlFindMany = vi.fn()
const ingest = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: { tournamentLeague: { findMany: (...a: unknown[]) => tlFindMany(...a) } },
}))
vi.mock('@/lib/tournament/ingestWeeklyPlayerScores', () => ({
  ingestLeagueWeeklyPlayerScores: (...a: unknown[]) => ingest(...a),
}))

import { sweepTournamentWeeklyScores } from '@/lib/tournament/sweepTournamentWeeklyScores'

beforeEach(() => {
  vi.clearAllMocks()
  tlFindMany.mockResolvedValue([{ leagueId: 'lg1' }, { leagueId: 'lg2' }])
  ingest.mockResolvedValue({ written: 240, unmappedRosterIds: [] })
})

it('ingests every league in the tournament and totals the rows', async () => {
  const out = await sweepTournamentWeeklyScores({ season: 2025, week: 3 })
  expect(out).toMatchObject({ leaguesTried: 2, leaguesWritten: 2, rowsWritten: 480 })
})

/**
 * 🛑 ONE LEAGUE'S FAILURE MUST NOT STOP THE SWEEP. Twenty leagues is twenty
 * chances of a provider hiccup, and a throw on the third would leave seventeen
 * uncollected with nothing recorded about why.
 */
it('keeps going when a league throws, and records which one', async () => {
  ingest
    .mockRejectedValueOnce(new Error('Sleeper matchups 502'))
    .mockResolvedValueOnce({ written: 100, unmappedRosterIds: [] })
  const out = await sweepTournamentWeeklyScores({ season: 2025, week: 3 })
  expect(out.failed).toEqual([{ leagueId: 'lg1', error: 'Sleeper matchups 502' }])
  expect(out.leaguesWritten).toBe(1)
  expect(out.rowsWritten).toBe(100)
})

/** ⚠ A skip is a reason, not a silent nothing — an early-season week is normal. */
it('records why a league was skipped rather than counting it as written', async () => {
  ingest.mockResolvedValue({
    written: 0,
    unmappedRosterIds: [],
    skippedReason: 'no matchups published for that week yet',
  })
  const out = await sweepTournamentWeeklyScores({ season: 2025, week: 18 })
  expect(out.leaguesWritten).toBe(0)
  expect(out.skipped).toHaveLength(2)
  expect(out.skipped[0].reason).toMatch(/not published|no matchups/i)
})

/**
 * ⚠ AN UNMAPPED ROSTER IS SURFACED EVEN ON A SUCCESSFUL WRITE. That manager's
 * week is missing, and it must be visible now rather than inferred later from a
 * leaderboard that quietly omits them.
 */
it('surfaces unmapped rosters alongside a successful ingest', async () => {
  ingest.mockResolvedValue({ written: 200, unmappedRosterIds: ['7'] })
  const out = await sweepTournamentWeeklyScores({ season: 2025, week: 3 })
  expect(out.leaguesWritten).toBe(2)
  expect(out.skipped.some((s) => s.reason.includes('unmapped rosters: 7'))).toBe(true)
})

describe('what it sweeps', () => {
  /** A finished tournament's weeks do not change; re-reading them is pure spend. */
  it('skips complete and archived tournaments by default', async () => {
    await sweepTournamentWeeklyScores({ season: 2025, week: 3 })
    expect(tlFindMany.mock.calls[0][0].where.tournament).toEqual({
      status: { notIn: ['complete', 'archived'] },
    })
  })

  it('scopes to one tournament when asked, without the status filter', async () => {
    await sweepTournamentWeeklyScores({ season: 2025, week: 3, tournamentId: 't1' })
    const where = tlFindMany.mock.calls[0][0].where
    expect(where.tournamentId).toBe('t1')
    expect(where.tournament).toBeUndefined()
  })

  it('deduplicates a league that appears twice', async () => {
    tlFindMany.mockResolvedValue([{ leagueId: 'lg1' }, { leagueId: 'lg1' }])
    const out = await sweepTournamentWeeklyScores({ season: 2025, week: 3 })
    expect(out.leaguesTried).toBe(1)
    expect(ingest).toHaveBeenCalledTimes(1)
  })

  it('writes nothing on a dry run', async () => {
    const out = await sweepTournamentWeeklyScores({ season: 2025, week: 3, dryRun: true })
    expect(out).toMatchObject({ dryRun: true, leaguesTried: 2, rowsWritten: 0 })
    expect(ingest).not.toHaveBeenCalled()
  })
})
