/**
 * `injury_reports` (InjuryReportRecord) recency bound.
 *
 * WHY THIS EXISTS. Measured in production on 2026-09-09: `injury_reports` has no
 * scheduled writer outside the NFL-only Grok pass, so NBA, NHL, MLB and NCAAB were
 * all last written 2026-04-26 — 135 days stale — while `SportsInjury` was current
 * to the minute for the same players. Nothing failed, because an April "Out" is a
 * perfectly well-formed row; it was simply a false statement served with full
 * confidence.
 *
 * The two behaviours pinned here are the two halves of the fix, and each has a
 * control that fails if the other half is doing all the work.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findFirst: {} as Record<string, ReturnType<typeof vi.fn>>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    {
      get: (_t, model: string) => {
        mocks.findFirst[model] ??= vi.fn().mockResolvedValue(null)
        return { findFirst: mocks.findFirst[model] }
      },
    }
  ),
}))

import {
  INJURY_PRIOR_SEASON_AFTER_HOURS,
  currentSeasonReportWhere,
  priorSeasonCutoff,
} from '@/lib/injuries/injuryRecency'
import { getFantasyValueSnapshot } from '@/lib/sports-reporting/FantasyValueSnapshotService'

const NOW = new Date('2026-09-09T06:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

/** The exact production shape: last written 2026-04-26. */
const STALE_REPORT_DAYS = 135
/** A live SportsInjury row, as /api/cron/import-injuries leaves it. */
const FRESH_INJURY_MINUTES = 30

describe('injuryRecency — the shared bound', () => {
  it('cuts off at 120 days, so a 135-day-old report is out and a 1-day-old one is in', () => {
    expect(INJURY_PRIOR_SEASON_AFTER_HOURS).toBe(120 * 24)

    const cutoff = priorSeasonCutoff(NOW)
    // Positive control on BOTH sides — a bound that excluded everything would
    // also pass a test that only checked the stale row.
    expect(daysAgo(STALE_REPORT_DAYS).getTime()).toBeLessThan(cutoff.getTime())
    expect(daysAgo(1).getTime()).toBeGreaterThan(cutoff.getTime())
  })

  it('produces a prisma where-fragment on reportDate, not on season or created_at', () => {
    const where = currentSeasonReportWhere(NOW)
    // The column matters: the ingest stamps the CURRENT season onto whatever it
    // pulls, and SOCCER's rows were WRITTEN 11 days ago while REPORTING on May 1.
    expect(Object.keys(where)).toEqual(['reportDate'])
    expect(where.reportDate.gte.getTime()).toBe(priorSeasonCutoff(NOW).getTime())
  })
})

describe('FantasyValueSnapshot — injury source selection', () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks.findFirst)) fn.mockReset().mockResolvedValue(null)
    // The denormalized row leads, so it must be free of an injury status for the
    // two live tables to be reachable at all. This is the post-fix state for a
    // non-NFL player: sports-data-importer now writes null rather than April.
    mocks.findFirst.sportsPlayerRecord = vi
      .fn()
      .mockResolvedValue({ id: 'p1', name: 'Kevin Huerter', team: 'SAC', position: 'SG' })
  })

  const snapshotFor = (
    report: { status: string; reportDate: Date } | null,
    injury: { status: string; date: Date } | null
  ) => {
    mocks.findFirst.injuryReportRecord = vi.fn().mockResolvedValue(report)
    mocks.findFirst.sportsInjury = vi.fn().mockResolvedValue(injury)
    return getFantasyValueSnapshot({ sport: 'NBA', playerId: 'p1', playerName: 'Kevin Huerter' })
  }

  it('bounds the injury_reports read to the current season', async () => {
    await snapshotFor(null, null)

    const args = mocks.findFirst.injuryReportRecord.mock.calls[0]?.[0]
    const gte = args?.where?.reportDate?.gte as Date | undefined
    expect(gte).toBeInstanceOf(Date)

    // Pin the VALUE, not merely the presence of a filter. A bound of "1 hour" and a
    // bound of "120 days" both satisfy `toBeDefined`, and only one of them is right.
    const days = (Date.now() - (gte as Date).getTime()) / 86_400_000
    expect(days).toBeGreaterThan(119)
    expect(days).toBeLessThan(121)

    /*
     * ⚠ ASSERTED AGAINST LITERALS, NOT AGAINST THE CONSTANT THE QUERY ITSELF USES.
     * Written as `toBeCloseTo(INJURY_PRIOR_SEASON_AFTER_HOURS)` this was
     * self-referential: setting the constant to 1 hour moved BOTH sides and the
     * test stayed green over a bound that admitted nothing. Caught by mutating the
     * constant and watching only the other test go red.
     */
    expect(gte!.getTime()).toBeLessThan(Date.now() - 119 * 86_400_000)
    // And the shared rule is genuinely the one in play, not a re-derived copy.
    expect(gte!.getTime()).toBeCloseTo(priorSeasonCutoff(new Date()).getTime(), -5)
  })

  it('prefers a 30-minute-old SportsInjury row over a 135-day-old injury report', async () => {
    const snapshot = await snapshotFor(
      { status: 'Out', reportDate: daysAgo(STALE_REPORT_DAYS) },
      { status: 'Probable', date: new Date(NOW.getTime() - FRESH_INJURY_MINUTES * 60_000) }
    )

    // "Out" scores high, "Probable" scores low — so injuryRisk names the winner.
    // Before the fix this was `high`: injury_reports won unconditionally.
    expect(snapshot.injuryRisk).toBe('low')
  })

  /*
   * 🛑 THE CONTROL THAT MATTERS. Everything above still passes if the
   * injury_reports leg is deleted outright and SportsInjury always wins — which
   * would be wrong, because for NFL that table is the fresher of the two (Grok
   * writes it four times a day). This is the only assertion that fails on that
   * shortcut, so it is what keeps the ordering honest rather than incidental.
   */
  it('still prefers the injury report when IT is the fresher of the two', async () => {
    const snapshot = await snapshotFor(
      { status: 'Out', reportDate: new Date(NOW.getTime() - 60 * 60_000) },
      { status: 'Probable', date: daysAgo(3) }
    )

    expect(snapshot.injuryRisk).toBe('high')
  })

  it('falls back to whichever row exists when only one does', async () => {
    const onlyReport = await snapshotFor({ status: 'Out', reportDate: daysAgo(1) }, null)
    expect(onlyReport.injuryRisk).toBe('high')

    const onlyInjury = await snapshotFor(null, { status: 'Out', date: daysAgo(1) })
    expect(onlyInjury.injuryRisk).toBe('high')
  })

  it('treats an undated row as losing to a dated one, never as current', async () => {
    // A row with no report date is not evidence of being recent. Ranking it above a
    // dated row would re-open the exact hole this test file exists to close.
    const snapshot = await snapshotFor(
      { status: 'Out', reportDate: undefined as unknown as Date },
      { status: 'Probable', date: daysAgo(2) }
    )

    expect(snapshot.injuryRisk).toBe('low')
  })
})
