// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { deriveObservedWaiverSchedule, loadObservedWaiverSchedules, MIN_RUNS } from '@/lib/waivers/observedWaiverSchedule'
import { nextWaiverRunMs, scheduleLabel } from '@/lib/core-app/waiverRunClock'
import { SleeperLeagueMapper } from '@/lib/league-import/adapters/sleeper/SleeperLeagueMapper'
import { buildTransactionFacts } from '@/lib/league-import/sleeper/SleeperHistoricalTransactionSyncService'
import type { SleeperImportPayload } from '@/lib/league-import/adapters/sleeper/types'
import { rowWaiverSchedule } from '@/lib/core-app/waiverRowMeta'

/**
 * Importing the Sleeper waiver schedule (2026-10-02). Sleeper's settings fields are stored raw and
 * NOT interpreted (contracts/sleeper/GAPS.md S-05/S-06); the schedule screens show is OBSERVED from
 * when a league's claims actually resolved (`status_updated`), kept in Pacific wall-clock time.
 */

/** One run: five claims resolved over ~40 seconds starting at `iso`. */
const run = (iso: string) => Array.from({ length: 5 }, (_, i) => new Date(Date.parse(iso) + i * 9_000).toISOString())

/*
 * Wednesdays 03:00 Pacific, either side of the 2026-11-01 daylight-saving change:
 * 10:00 UTC while PDT, 11:00 UTC once PST.
 */
const WEEKLY_ACROSS_DST = [
  '2026-10-07T10:00:05Z', '2026-10-14T10:00:03Z', '2026-10-21T10:00:07Z', '2026-10-28T10:00:02Z',
  '2026-11-04T11:00:04Z', '2026-11-11T11:00:06Z', '2026-11-18T11:00:01Z',
].flatMap(run)

describe('deriveObservedWaiverSchedule', () => {
  it('reads a weekly Wednesday 03:00 Pacific run across a daylight-saving change', () => {
    const s = deriveObservedWaiverSchedule(WEEKLY_ACROSS_DST)
    expect(s?.schedule).toEqual({ dayOfWeek: 3, time: '03:00', timeZone: 'America/Los_Angeles' })
    expect(s).toMatchObject({ agreeingRuns: 7, consideredRuns: 7, lastRunAt: '2026-11-18T11:00:01.000Z' })
    expect(scheduleLabel(s!.schedule)).toBe('Wednesday 03:00 Pacific')
  })

  it('CONTROL: in UTC those same runs are an hour apart — why the schedule is kept in Pacific', () => {
    const utcHours = new Set(WEEKLY_ACROSS_DST.map((t) => new Date(t).getUTCHours()))
    expect([...utcHours].sort()).toEqual([10, 11])
  })

  it('stays weekly on the main day when waivers also clear on other days', () => {
    const clears = ['2026-10-16T10:00:00Z', '2026-10-30T10:00:00Z'].flatMap(run) // two Friday clears
    expect(deriveObservedWaiverSchedule([...WEEKLY_ACROSS_DST, ...clears])?.schedule.dayOfWeek).toBe(3)
  })

  it('reads a daily league as daily', () => {
    const days = Array.from({ length: 9 }, (_, i) => new Date(Date.UTC(2026, 9, 5 + i, 8, 0)).toISOString()) // 01:00 PDT
    const s = deriveObservedWaiverSchedule(days.flatMap(run))
    expect(s?.schedule).toEqual({ dayOfWeek: null, time: '01:00', timeZone: 'America/Los_Angeles' })
    expect(scheduleLabel(s!.schedule)).toBe('Daily 01:00 Pacific')
  })

  it(`says nothing on fewer than ${MIN_RUNS} runs — two runs are a guess`, () => {
    expect(deriveObservedWaiverSchedule(['2026-10-07T10:00:00Z', '2026-10-14T10:00:00Z'].flatMap(run))).toBeNull()
  })

  it('says nothing when the runs agree on no time', () => {
    const scattered = ['2026-10-07T10:00:00Z', '2026-10-14T16:30:00Z', '2026-10-21T02:10:00Z', '2026-10-28T20:45:00Z']
    expect(deriveObservedWaiverSchedule(scattered.flatMap(run))).toBeNull()
  })

  it('treats one burst of claims as ONE run, not five', () => {
    const s = deriveObservedWaiverSchedule(['2026-10-07T10:00:00Z', '2026-10-14T10:00:00Z', '2026-10-21T10:00:00Z'].flatMap(run))
    expect(s?.consideredRuns).toBe(3)
  })
})

describe('nextWaiverRunMs on a Pacific schedule', () => {
  const wed3 = { dayOfWeek: 3, time: '03:00', timeZone: 'America/Los_Angeles' }
  it('counts down to 10:00 UTC while Pacific is on daylight time', () => {
    expect(nextWaiverRunMs(wed3, Date.UTC(2026, 9, 27, 12))).toBe(Date.UTC(2026, 9, 28, 10))
  })
  it('and to 11:00 UTC once it is not — the hour a UTC schedule would get wrong', () => {
    expect(nextWaiverRunMs(wed3, Date.UTC(2026, 10, 3, 12))).toBe(Date.UTC(2026, 10, 4, 11))
  })
  it('a daily schedule runs tomorrow when today’s run has passed', () => {
    expect(nextWaiverRunMs({ dayOfWeek: null, time: '01:00', timeZone: 'America/Los_Angeles' }, Date.UTC(2026, 10, 3, 12))).toBe(
      Date.UTC(2026, 10, 4, 9),
    )
  })
})

describe('loadObservedWaiverSchedules', () => {
  it('reads every AF row of one Sleeper league — the history may sit on the twin', async () => {
    const queried: unknown[] = []
    const prisma = {
      league: {
        findMany: vi.fn(async (args: { where: { id?: unknown } }) =>
          args.where.id
            ? [{ id: 'A', platformLeagueId: 'S1' }]
            : [
                { id: 'A', platformLeagueId: 'S1' },
                { id: 'A2', platformLeagueId: 'S1' },
              ],
        ),
      },
      $queryRaw: vi.fn(async (sql: { values: unknown[] }) => {
        queried.push(...sql.values)
        return WEEKLY_ACROSS_DST.map((resolvedAt) => ({ leagueId: 'A2', resolvedAt }))
      }),
    }
    const out = await loadObservedWaiverSchedules(prisma as never, ['A'])
    expect(out.get('A')?.schedule.dayOfWeek).toBe(3)
    expect(queried).toContainEqual(['A', 'A2'])
  })

  it('asks for nothing when no requested league is a Sleeper league', async () => {
    const prisma = { league: { findMany: vi.fn(async () => []) }, $queryRaw: vi.fn() }
    expect((await loadObservedWaiverSchedules(prisma as never, ['X'])).size).toBe(0)
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })
})

describe('import: what reaches the database', () => {
  const league = (settings: Record<string, unknown>): SleeperImportPayload =>
    ({ league: { league_id: 'L', name: 'L', sport: 'nfl', season: '2026', total_rosters: 12, roster_positions: ['QB'], scoring_settings: {}, settings } }) as never

  it('the mapper keeps Sleeper’s schedule fields raw, uninterpreted', () => {
    const out = SleeperLeagueMapper.map(league({ waiver_type: 2, waiver_day_of_week: 2, daily_waivers: 0, daily_waivers_hour: 0, waiver_clear_days: 2 }))
    expect(out?.sleeper_waiver_schedule).toEqual({ waiver_day_of_week: 2, daily_waivers: 0, daily_waivers_hour: 0, waiver_clear_days: 2 })
  })

  it('and adds no key at all when Sleeper sent none', () => {
    expect(SleeperLeagueMapper.map(league({ waiver_type: 2 }))).not.toHaveProperty('sleeper_waiver_schedule')
  })

  it('the transaction sync stores when Sleeper RESOLVED a claim, beside when it was made', () => {
    const tx = {
      transaction_id: 't1', type: 'waiver', status: 'complete', leg: 5,
      created: Date.parse('2026-10-05T18:00:00Z'), status_updated: Date.parse('2026-10-07T10:00:04Z'),
      roster_ids: [3], adds: { p1: 3 }, drops: null, settings: { waiver_bid: 7 }, draft_picks: [], waiver_budget: [],
    }
    const [fact] = buildTransactionFacts({ tx: tx as never, internalLeagueId: 'A', sport: 'NFL', season: 2026 })
    expect(fact.payload).toMatchObject({ createdAt: '2026-10-05T18:00:00.000Z', statusUpdatedAt: '2026-10-07T10:00:04.000Z' })
    const [noStamp] = buildTransactionFacts({ tx: { ...tx, status_updated: 0 } as never, internalLeagueId: 'A', sport: 'NFL', season: 2026 })
    expect(noStamp.payload.statusUpdatedAt).toBeNull()
  })
})

describe('rowWaiverSchedule — what a board row shows', () => {
  const bootstrapDefault = { processingDayOfWeek: 1, processingTimeUtc: '12:00' }
  const seen = { schedule: { dayOfWeek: 3, time: '03:00', timeZone: 'America/Los_Angeles' }, agreeingRuns: 5 }

  it('a Sleeper row shows the observed schedule, never the stored bootstrap default', () => {
    expect(rowWaiverSchedule(bootstrapDefault, 'sleeper', seen)).toEqual({
      label: 'Wednesday 03:00 Pacific (seen over 5 runs)',
      schedule: seen.schedule,
    })
    expect(rowWaiverSchedule(bootstrapDefault, 'sleeper', null)).toBeNull()
  })

  it('a league whose schedule really was imported keeps it — an observation never overrides it', () => {
    expect(rowWaiverSchedule(bootstrapDefault, 'espn', seen)?.schedule).toEqual({ dayOfWeek: 1, time: '12:00', timeZone: 'UTC' })
  })
})
