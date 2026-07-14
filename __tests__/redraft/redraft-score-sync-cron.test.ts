/**
 * Redraft scoring-cron fix.
 *
 * The static season-flow audit found `/api/redraft/score-sync` was effectively
 * dead for normal redraft leagues (POST-only route, Vercel crons GET; no-body
 * path only ran survivor/zombie/c2c). These tests lock the fix:
 *   - the pure orchestrator processes active NFL seasons through the pipeline,
 *     isolates per-season failures, skips NCAAF safely, and is idempotent;
 *   - the route now exports GET, gates it with cron/admin auth, enumerates
 *     active seasons, runs the scoring pipeline + telemetry, and preserves POST.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import {
  runRedraftSeasonScoring,
  SCORING_SUPPORTED_SPORTS,
  type ScoringSeason,
} from '@/lib/redraft/redraftSeasonScoringRunner'
import { requireCronAuth } from '@/app/api/cron/_auth'

function reqWith(headers: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return { headers: { get: (k: string) => lower[k.toLowerCase()] ?? null } } as unknown as Parameters<typeof requireCronAuth>[0]
}

describe('score-sync cron auth — accepts the Vercel cron Bearer secret', () => {
  const prev = process.env.CRON_SECRET
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret-123'
  })
  afterEach(() => {
    if (prev === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = prev
  })

  it('accepts Authorization: Bearer <CRON_SECRET> (what Vercel cron sends)', () => {
    expect(requireCronAuth(reqWith({ authorization: 'Bearer test-cron-secret-123' }))).toBe(true)
  })
  it('rejects an unauthenticated request', () => {
    expect(requireCronAuth(reqWith({}))).toBe(false)
  })
  it('rejects a wrong bearer token', () => {
    expect(requireCronAuth(reqWith({ authorization: 'Bearer nope' }))).toBe(false)
  })
})

function nflSeason(id: string, over: Partial<ScoringSeason> = {}): ScoringSeason {
  return { id, leagueId: `lg-${id}`, sport: 'NFL', currentWeek: 5, ...over }
}

function deps(over: Partial<Parameters<typeof runRedraftSeasonScoring>[1]> = {}) {
  return {
    syncSeason: vi.fn(async (s: ScoringSeason) => ({ seasonId: s.id, week: 5, scoresUpserted: 10, warnings: [] as string[] })),
    recalcMatchups: vi.fn(async () => ({})),
    updateStandings: vi.fn(async () => ({})),
    ...over,
  }
}

describe('runRedraftSeasonScoring — pipeline + isolation', () => {
  it('runs sync → recalc → standings for each active NFL season', async () => {
    const d = deps()
    const report = await runRedraftSeasonScoring([nflSeason('a'), nflSeason('b')], d)
    expect(report.processedCount).toBe(2)
    expect(report.ok).toBe(true)
    expect(d.syncSeason).toHaveBeenCalledTimes(2)
    expect(d.recalcMatchups).toHaveBeenCalledTimes(2)
    expect(d.updateStandings).toHaveBeenCalledTimes(2)
    expect(report.totalScoresUpserted).toBe(20)
  })

  it('passes the synced week through to recalc + standings', async () => {
    const d = deps({ syncSeason: vi.fn(async (s: ScoringSeason) => ({ seasonId: s.id, week: 9, scoresUpserted: 3, warnings: [] })) })
    await runRedraftSeasonScoring([nflSeason('a')], d)
    expect(d.recalcMatchups).toHaveBeenCalledWith('a', 9)
    expect(d.updateStandings).toHaveBeenCalledWith('a', 9)
  })

  it('isolates per-season failures — one bad season does not stop the others', async () => {
    const d = deps({
      syncSeason: vi.fn(async (s: ScoringSeason) => {
        if (s.id === 'bad') throw new Error('provider 503')
        return { seasonId: s.id, week: 5, scoresUpserted: 7, warnings: [] }
      }),
    })
    const report = await runRedraftSeasonScoring([nflSeason('a'), nflSeason('bad'), nflSeason('c')], d)
    expect(report.processedCount).toBe(2)
    expect(report.failedCount).toBe(1)
    expect(report.failed[0]).toMatchObject({ seasonId: 'bad', error: expect.stringMatching(/provider 503/) })
    expect(report.ok).toBe(false)
    // standings still ran for the two healthy seasons
    expect(d.updateStandings).toHaveBeenCalledTimes(2)
  })

  it('skips NCAAF (non-NFL) with a dataWarning and never marks it successful', async () => {
    const d = deps()
    const report = await runRedraftSeasonScoring(
      [nflSeason('nfl1'), { id: 'cf1', leagueId: 'lg-cf1', sport: 'NCAAF', currentWeek: 3 }],
      d,
    )
    expect(report.processedCount).toBe(1)
    expect(report.skippedCount).toBe(1)
    expect(d.syncSeason).toHaveBeenCalledTimes(1) // NCAAF never enters the pipeline
    const ncaaf = report.dataWarnings.find((w) => w.sport === 'NCAAF')
    expect(ncaaf?.warning).toMatch(/NFL only/i)
    expect(report.processed.some((p) => p.sport === 'NCAAF')).toBe(false)
  })

  it('marks a season with zero cached stats as no_data (not a false synced)', async () => {
    const d = deps({ syncSeason: vi.fn(async (s: ScoringSeason) => ({ seasonId: s.id, week: 5, scoresUpserted: 0, warnings: [] })) })
    const report = await runRedraftSeasonScoring([nflSeason('a')], d)
    expect(report.processed[0].status).toBe('no_data')
    expect(report.dataWarnings.some((w) => /no cached weekly stats/i.test(w.warning))).toBe(true)
  })

  it('surfaces the sync service warnings as dataWarnings', async () => {
    const d = deps({ syncSeason: vi.fn(async (s: ScoringSeason) => ({ seasonId: s.id, week: 5, scoresUpserted: 4, warnings: ['2 players missing stats'] })) })
    const report = await runRedraftSeasonScoring([nflSeason('a')], d)
    expect(report.dataWarnings.some((w) => w.warning === '2 players missing stats')).toBe(true)
  })

  it('is idempotent/pure — same input yields the same report, no state carried', async () => {
    const seasons = [nflSeason('a'), nflSeason('b')]
    const r1 = await runRedraftSeasonScoring(seasons, deps())
    const r2 = await runRedraftSeasonScoring(seasons, deps())
    expect(r1).toEqual(r2)
  })

  it('weekly scoring is wired for NFL only', () => {
    expect([...SCORING_SUPPORTED_SPORTS]).toEqual(['NFL'])
  })
})

// ── Route source invariants (the route is server-only/DB-bound) ──────────────

const routeSrc = readFileSync(resolve(__dirname, '..', '..', 'app/api/redraft/score-sync/route.ts'), 'utf8')

describe('score-sync route — GET cron wiring + POST preserved', () => {
  it('now exports a GET handler (Vercel crons issue GET)', () => {
    expect(routeSrc).toMatch(/export async function GET\(/)
  })

  it('GET accepts the Vercel cron secret (requireCronAuth) AND admin/bearer fallback', () => {
    const getBlock = routeSrc.slice(routeSrc.indexOf('export async function GET'))
    // Must accept the cron secret first — Vercel cron sends Bearer CRON_SECRET,
    // and CRON_SECRET !== ADMIN_PASSWORD, so requireAdminOrBearer alone fails.
    expect(getBlock).toMatch(/requireCronAuth\(request/)
    expect(getBlock).toMatch(/requireAdminOrBearer\(request\)/)
    expect(getBlock).toMatch(/if \(!gate\.ok\) return gate\.res/)
  })

  it('GET enumerates ACTIVE redraft seasons and runs the orchestrator', () => {
    const getBlock = routeSrc.slice(routeSrc.indexOf('export async function GET'))
    expect(getBlock).toMatch(/redraftSeason\.findMany/)
    expect(getBlock).toMatch(/status: 'active'/)
    expect(getBlock).toMatch(/runRedraftSeasonScoring\(/)
  })

  it('GET wires the real scoring pipeline (sync → recalc → standings)', () => {
    const getBlock = routeSrc.slice(routeSrc.indexOf('export async function GET'))
    expect(getBlock).toMatch(/syncPlayerWeeklyScoresForRedraftSeason\(/)
    expect(getBlock).toMatch(/recalculateMatchupsForSeasonWeek\(/)
    expect(getBlock).toMatch(/updateStandings\(/)
  })

  it('GET is instrumented with production-health telemetry', () => {
    const getBlock = routeSrc.slice(routeSrc.indexOf('export async function GET'))
    expect(getBlock).toMatch(/withSyncJobRun\(/)
    expect(getBlock).toMatch(/cron-redraft-score-sync|REDRAFT_SCORE_SYNC_JOB/)
  })

  it('GET still runs the survivor/zombie/c2c automation bridge', () => {
    const getBlock = routeSrc.slice(routeSrc.indexOf('export async function GET'))
    expect(getBlock).toMatch(/runLegacyAutomationBridge\(\)/)
  })

  it('preserves the existing POST handler', () => {
    expect(routeSrc).toMatch(/export async function POST\(/)
    expect(routeSrc).toMatch(/runLegacyAutomationBridge/)
  })
})
