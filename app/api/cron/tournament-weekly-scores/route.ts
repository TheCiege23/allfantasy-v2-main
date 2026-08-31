import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { sweepTournamentWeeklyScores } from '@/lib/tournament/sweepTournamentWeeklyScores'

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
  const season = Number(url.searchParams.get('season'))
  const week = Number(url.searchParams.get('week'))
  /*
   * ⚠ BOTH REQUIRED, NO DEFAULTING TO "NOW". Guessing the current week here and
   * guessing it wrong writes a real week's scores under the wrong number, and
   * nothing downstream could tell. The caller states which week it means.
   */
  if (!Number.isFinite(season) || !Number.isFinite(week)) {
    return NextResponse.json(
      { error: 'season and week are both required, as numbers.' },
      { status: 400 },
    )
  }

  const result = await sweepTournamentWeeklyScores({
    season: Math.trunc(season),
    week: Math.trunc(week),
    dryRun: url.searchParams.get('dryRun') === 'true',
    tournamentId: url.searchParams.get('tournamentId')?.trim() || undefined,
  })
  return NextResponse.json(result)
}

export const GET = handle
export const POST = handle
