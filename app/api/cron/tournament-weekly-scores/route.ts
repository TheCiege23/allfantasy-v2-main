import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { sweepTournamentWeeklyScores } from '@/lib/tournament/sweepTournamentWeeklyScores'
import { resolveCurrentNflWeek, weeksToSweep } from '@/lib/tournament/resolveNflWeek'

/**
 * Collect each tournament league's per-player scores for a week.
 *
 * ⚠ THE SCHEDULE IS NOT REGISTERED BY THIS FILE. `vercel.json` in this repo has
 * no `crons` array — the schedules live in the Vercel dashboard — so adding this
 * route makes it callable, not scheduled.
 *
 * ⚠ `CRON_SECRET` NAMED EXPLICITLY: a bare `requireCronAuth(req)` checks
 * `LEAGUE_CRON_SECRET` first and 401s whenever that holds something else.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

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
    const current = await resolveCurrentNflWeek()
    if (!current) {
      return NextResponse.json(
        { error: 'Could not establish the current NFL week; nothing was ingested.' },
        { status: 503 },
      )
    }
    const results = []
    for (const target of weeksToSweep(current)) {
      results.push(
        await sweepTournamentWeeklyScores({ ...target, dryRun, tournamentId }),
      )
    }
    return NextResponse.json({ auto: true, resolved: current, results })
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
