// @vitest-environment node
/**
 * Daily waiver runs for NBA / NHL / MLB under Sleeper-style free agency (lib/waiver-wire/daily-sport-waiver-runs.ts).
 *
 * The run days come from `getEffectiveLeagueWaiverSettings`, so the existing 5-minute sweep
 * (`/api/cron/waivers`) is what runs a daily-sport league every day. Driven end to end here: the real
 * settings read, the real `nextRunAt` refresh, the real discovery and the real cron route, over one
 * prisma double — only the automation job itself is mocked. Every league id is distinct.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type League = { sport: string; leagueVariant: string | null; settings: Record<string, unknown>; lockAllMoves: boolean }
type WaiverRow = { waiverType: string; processingDays: number[]; processingDayOfWeek: number; processingTimeUtc: string; waiverEngineConfig: Record<string, unknown> }

const h = vi.hoisted(() => ({
  leagues: new Map<string, League>(),
  waivers: new Map<string, WaiverRow>(),
  state: new Map<string, { leagueId: string; nextRunAt: Date | null; processingLocked: boolean; lastRunAt?: Date | null }>(),
  job: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const l = h.leagues.get(where.id)
        return l ? { id: where.id, guillotineMode: false, ...l } : null
      },
    },
    leagueWaiverSettings: { findUnique: async ({ where }: { where: { leagueId: string } }) => h.waivers.get(where.leagueId) ?? null },
    leagueWaiverState: {
      findUnique: async ({ where }: { where: { leagueId: string } }) => h.state.get(where.leagueId) ?? null,
      upsert: async ({ where, create, update }: { where: { leagueId: string }; create: any; update: any }) => {
        const prev = h.state.get(where.leagueId)
        const next = prev ? { ...prev, ...update } : { ...create }
        h.state.set(where.leagueId, next)
        return next
      },
    },
    waiverClaim: {
      groupBy: async () => [...h.leagues.keys()].map((leagueId) => ({ leagueId, _count: { _all: 2 } })),
      count: async () => 2,
    },
    waiverRun: { findFirst: async () => null },
  },
}))
vi.mock('@/lib/automation/audit', () => ({ writeAutomationAuditLog: vi.fn(async () => undefined) }))
vi.mock('@/lib/automation/jobs/waivers/processLeagueWaiversJob', () => ({ processLeagueWaiversJob: h.job }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('@/lib/survivor-guillotine/live', () => ({ runSGAutomaticChopNight: async () => ({ scanned: 0, due: 0, results: [] }) }))
vi.mock('@/lib/survivor-guillotine/operations', () => ({
  runSGDueAuctions: async () => ({ scanned: 0, due: 0, results: [] }),
  runSGSelectionDeadlines: async () => ({ scanned: 0, due: 0, results: [] }),
}))

import { GET } from '@/app/api/cron/waivers/route'
import { dailySportWaiverRunDays } from '@/lib/waiver-wire/daily-sport-waiver-runs'
import { getEffectiveLeagueWaiverSettings } from '@/lib/waiver-wire/settings-service'
import { refreshLeagueWaiverNextRunAt } from '@/lib/waiver-wire/waiver-state-service'

/** Mon / Wed / Fri at 12:00 UTC — the daily sports' default schedule. */
const MWF = (mode: 'after_run' | 'standard', waiverType = 'faab'): WaiverRow => ({
  waiverType,
  processingDays: [1, 3, 5],
  processingDayOfWeek: 1,
  processingTimeUtc: '12:00',
  waiverEngineConfig: { free_agency_mode: mode },
})
const league = (sport: string, over: Partial<League> = {}): League => ({ sport, leagueVariant: null, settings: {}, lockAllMoves: false, ...over })

/** Just after Monday 2026-10-26's 12:00 UTC run: every league's next run is computed from here. */
const AFTER_MONDAY_RUN = new Date('2026-10-26T12:01:00Z')
/** Tuesday 2026-10-27, five minutes after 12:00 UTC — a sweep tick. */
const TUESDAY_TICK = new Date('2026-10-27T12:05:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'cron-secret-daily'
  h.leagues.clear()
  h.waivers.clear()
  h.state.clear()
  h.job.mockResolvedValue({ ok: true, automationJobId: 'job-daily', summary: { message: 'ok' }, message: 'ok' })
})
afterEach(() => vi.useRealTimers())

describe('dailySportWaiverRunDays', () => {
  const base = { leagueVariant: null, freeAgencyMode: 'after_run', waiverType: 'faab', perDayScheduleEnabled: false }
  it('runs NBA, NHL and MLB every day under Sleeper-style free agency', () => {
    for (const sport of ['NBA', 'NHL', 'MLB', 'nba']) expect(dailySportWaiverRunDays({ ...base, sport })).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
  it('leaves weekly sports, the standard mode, FCFS, specialty variants and a per-day schedule alone', () => {
    expect(dailySportWaiverRunDays({ ...base, sport: 'NFL' })).toBeNull()
    expect(dailySportWaiverRunDays({ ...base, sport: 'NCAAF' })).toBeNull()
    expect(dailySportWaiverRunDays({ ...base, sport: 'NBA', freeAgencyMode: 'standard' })).toBeNull()
    expect(dailySportWaiverRunDays({ ...base, sport: 'NBA', waiverType: 'fcfs' })).toBeNull()
    expect(dailySportWaiverRunDays({ ...base, sport: 'NBA', leagueVariant: 'survivor' })).toBeNull()
    expect(dailySportWaiverRunDays({ ...base, sport: 'NBA', perDayScheduleEnabled: true })).toBeNull()
  })
})

describe('effective waiver settings', () => {
  it('an NBA after-run league runs every day at its own time; an NFL one keeps its days', async () => {
    h.leagues.set('lg-nba-after', league('NBA'))
    h.waivers.set('lg-nba-after', MWF('after_run'))
    h.leagues.set('lg-nfl-after', league('NFL'))
    h.waivers.set('lg-nfl-after', { ...MWF('after_run'), processingDays: [3], processingDayOfWeek: 3 })
    const nba = await getEffectiveLeagueWaiverSettings('lg-nba-after')
    const nfl = await getEffectiveLeagueWaiverSettings('lg-nfl-after')
    expect(nba.processingDays).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(nba.processingTimeUtc).toBe('12:00')
    expect(nfl.processingDays).toEqual([3])
  })
})

describe('the daily sweep', () => {
  function arrange() {
    h.leagues.set('lg-nba-daily', league('NBA'))
    h.waivers.set('lg-nba-daily', MWF('after_run'))
    h.leagues.set('lg-mlb-daily', league('MLB'))
    h.waivers.set('lg-mlb-daily', MWF('after_run'))
    h.leagues.set('lg-nhl-locked', league('NHL', { lockAllMoves: true }))
    h.waivers.set('lg-nhl-locked', MWF('after_run', 'reverse_standings'))
    h.leagues.set('lg-nba-standard', league('NBA'))
    h.waivers.set('lg-nba-standard', MWF('standard'))
    h.leagues.set('lg-nfl-weekly', league('NFL'))
    h.waivers.set('lg-nfl-weekly', MWF('after_run'))
  }

  it('Tuesday runs only the daily-sport leagues, and skips the one whose moves are locked', async () => {
    arrange()
    for (const id of h.leagues.keys()) await refreshLeagueWaiverNextRunAt(id, AFTER_MONDAY_RUN)
    expect(h.state.get('lg-nba-daily')?.nextRunAt?.toISOString()).toBe('2026-10-27T12:00:00.000Z')
    expect(h.state.get('lg-nba-standard')?.nextRunAt?.toISOString()).toBe('2026-10-28T12:00:00.000Z')
    expect(h.state.get('lg-nfl-weekly')?.nextRunAt?.toISOString()).toBe('2026-10-28T12:00:00.000Z')

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TUESDAY_TICK)
    const res = await GET(new Request('http://localhost/api/cron/waivers', { headers: { authorization: 'Bearer cron-secret-daily' } }))
    const body = await res.json()

    const ran = h.job.mock.calls.map((c) => c[0].leagueId).sort()
    expect(ran).toEqual(['lg-mlb-daily', 'lg-nba-daily'])
    expect(body).toMatchObject({ discovered: 3, processed: 2, skippedLocked: 1 })
    expect(body.results).toContainEqual(expect.objectContaining({ leagueId: 'lg-nhl-locked', skipped: 'league_moves_locked' }))
    // The run each league takes is Tuesday's own scheduled run.
    for (const c of h.job.mock.calls) expect((c[0].scheduledFor as Date).toISOString()).toBe('2026-10-27T12:00:00.000Z')
  })

  it('[control] before Tuesday 12:00 UTC nothing is due', async () => {
    arrange()
    for (const id of h.leagues.keys()) await refreshLeagueWaiverNextRunAt(id, AFTER_MONDAY_RUN)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-27T11:55:00Z'))
    const body = await (await GET(new Request('http://localhost/api/cron/waivers', { headers: { authorization: 'Bearer cron-secret-daily' } }))).json()
    expect(h.job).not.toHaveBeenCalled()
    expect(body).toMatchObject({ discovered: 0 })
  })

  it('a per-day schedule keeps choosing its own days', async () => {
    h.leagues.set('lg-nba-perday', league('NBA', { settings: { af_daily_waiver_schedule: {
      version: 1, enabled: true, processHour: 2,
      days: { mon: 'waivers', tue: 'free_agents', wed: 'waivers', thu: 'free_agents', fri: 'waivers', sat: 'free_agents', sun: 'locked' },
    } } }))
    h.waivers.set('lg-nba-perday', MWF('after_run'))
    expect((await getEffectiveLeagueWaiverSettings('lg-nba-perday')).processingDays).toEqual([1, 3, 5])
  })
})
