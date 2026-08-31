import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { postDueTournamentAnnouncements } from '@/lib/tournament/postDueAnnouncements'

/**
 * Post tournament announcements whose scheduled time has arrived.
 *
 * 🛑 WITHOUT THIS, "SCHEDULE" MEANS "SAVE AND FORGET". `sendTournamentBroadcast`
 * writes a scheduled message as an unposted `TournamentAnnouncement` with its
 * time — a row, not a timer. Until something sweeps those rows, a commissioner
 * who schedules the redraft notice for Tuesday gets nothing sent on Tuesday.
 *
 * ⚠ THE SCHEDULE IS NOT REGISTERED BY THIS FILE. `vercel.json` in this repo has
 * no `crons` array — the schedules live in the Vercel dashboard — so adding this
 * route makes it *callable*, not *scheduled*. Someone has to add the cron entry
 * there, and until they do this endpoint only runs when called by hand.
 *
 * ⚠ `CRON_SECRET` IS NAMED EXPLICITLY. A bare `requireCronAuth(req)` checks
 * `LEAGUE_CRON_SECRET` first and 401s whenever that variable holds something
 * else, which is what took several crons down in production — see the note in
 * `/api/cron/import-players`.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function handle(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  /* A dry run reports what WOULD post. Useful the first time this is wired up,
     when the cost of being wrong is a message to a few hundred people. */
  const dryRun = url.searchParams.get('dryRun') === 'true'
  const limit = Number(url.searchParams.get('limit'))

  const result = await postDueTournamentAnnouncements({
    dryRun,
    limit: Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : undefined,
  })

  return NextResponse.json(result)
}

export const GET = handle
export const POST = handle
