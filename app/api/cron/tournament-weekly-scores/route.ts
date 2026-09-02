import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import type { SweepResult } from '@/lib/tournament/sweepTournamentWeeklyScores'
import { sweepTournamentWeeklyScores } from '@/lib/tournament/sweepTournamentWeeklyScores'
import { resolveCurrentNflWeek, weeksToSweep } from '@/lib/tournament/resolveNflWeek'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'

/**
 * Collect each tournament league's per-player scores for a week.
 *
 * ⚠ THE SCHEDULE IS NOT REGISTERED BY THIS FILE, and the note that used to sit
 * here was wrong in a way worth correcting. It said the schedules "live in the
 * Vercel dashboard"; they do not, and Vercel executes none of them. The registry
 * is `cron-schedule.json` and GitHub Actions fires it — this job runs from
 * `cron-slow-tier.yml` at `0 10 * * *` as `?auto=1`.
 *
 * ⚠ `CRON_SECRET` NAMED EXPLICITLY: a bare `requireCronAuth(req)` checks
 * `LEAGUE_CRON_SECRET` first and 401s whenever that holds something else.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Heartbeat identity in `sync_job_runs`. Must stay in step with PROBES in
 * scripts/cron-freshness-check.mjs — renaming it here without renaming it there makes the
 * freshness monitor report CONFIG ("no rows for job_name") forever.
 *
 * Only the `?auto=1` path records it. An explicit season/week call is a human backfilling, and
 * letting that refresh the heartbeat would mask a scheduler that had stopped.
 */
const JOB = 'cron-tournament-weekly-scores'

async function handle(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const dryRun = url.searchParams.get('dryRun') === 'true'
  const tournamentId = url.searchParams.get('tournamentId')?.trim() || undefined

  /*
   * ⚠ `auto=1` IS FOR THE SCHEDULER, EXPLICIT PARAMS ARE FOR A HUMAN.
   * `cron-schedule.json` holds a literal path, so a scheduled entry cannot carry
   * a week that moves. Auto asks Sleeper what week it is — the same definition
   * `matchups/{week}` is keyed on — and does NOTHING if it cannot find out,
   * rather than ingesting a real week's scores under a guessed number.
   */
  if (url.searchParams.get('auto') === '1') {
    /*
     * ⚠ THE WEEK RESOLVE IS INSIDE THE INSTRUMENTED BLOCK, NOT BEFORE IT.
     * A heartbeat answers "did this job RUN", so a fire that cannot establish the week must
     * still record one — otherwise the single most likely failure here (Sleeper unreachable at
     * 10:00) looks identical to a dead scheduler, and the freshness monitor would blame the
     * wrong thing. The run is recorded and marked `failed`; the caller still gets its 503.
     */
    const run = async () => {
      const current = await resolveCurrentNflWeek()
      if (!current) return { resolved: null, results: [] as SweepResult[] }
      const results: SweepResult[] = []
      for (const target of weeksToSweep(current)) {
        results.push(await sweepTournamentWeeklyScores({ ...target, dryRun, tournamentId }))
      }
      return { resolved: current, results }
    }

    /* A dry run records nothing — see the note on JOB above. */
    const out = dryRun
      ? await run()
      : await withSyncJobRun({ jobName: JOB, sport: 'NFL', trigger: 'cron' }, run, (r) => ({
          rowsRead: r.results.reduce((n, s) => n + s.leaguesTried, 0),
          rowsWritten: r.results.reduce((n, s) => n + s.rowsWritten, 0),
          rowsSkipped: r.results.reduce((n, s) => n + s.skipped.length, 0),
          status: !r.resolved
            ? ('failed' as const)
            : r.results.some((s) => s.failed.length > 0)
              ? ('partial' as const)
              : ('success' as const),
        }))

    if (!out.resolved) {
      return NextResponse.json(
        { error: 'Could not establish the current NFL week; nothing was ingested.' },
        { status: 503 },
      )
    }
    return NextResponse.json({ auto: true, resolved: out.resolved, results: out.results })
  }

  const season = Number(url.searchParams.get('season'))
  const week = Number(url.searchParams.get('week'))
  /*
   * ⚠ BOTH REQUIRED WHEN CALLED BY HAND, NO DEFAULTING TO "NOW". Guessing the
   * week and guessing it wrong writes a real week's scores under the wrong
   * number, and nothing downstream could tell.
   */
  if (!Number.isFinite(season) || !Number.isFinite(week)) {
    return NextResponse.json(
      { error: 'season and week are both required, as numbers — or pass auto=1.' },
      { status: 400 },
    )
  }

  const result = await sweepTournamentWeeklyScores({
    season: Math.trunc(season),
    week: Math.trunc(week),
    dryRun,
    tournamentId,
  })
  return NextResponse.json(result)
}

export const GET = handle
export const POST = handle
