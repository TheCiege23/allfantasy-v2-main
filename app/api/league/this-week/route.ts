import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveWaiverRules } from '@/lib/core-app/waivers'
import { getMyTeamPulse } from '@/lib/core-app/myTeamPulse'
import { leagueCalendar } from '@/lib/core-app/leagueCalendar'
import { lineupFrom, type ThisWeekPayload, type ThisWeekTradeDeadline, type ThisWeekWaivers } from '@/lib/core-app/leagueThisWeek'

export const dynamic = 'force-dynamic'

/**
 * The league page's "This week" strip: the three dated things in a fantasy week that are not the
 * matchup itself — when your lineup locks, when waivers next run, and the trade deadline.
 *
 * Every field is a reading the /core screens already make, never a new rule:
 *   lineup        getMyTeamPulse, focused on this league (the My Team board's own lock and triage)
 *   waivers       resolveWaiverRules (the Waivers screen's schedule: observed, Sleeper's setting,
 *                 or the imported one — and nothing when none of those can be read)
 *   tradeDeadline leagueCalendar (provider dates only; a week number is never turned into a date)
 *
 * Each read is independent: one failing leaves its field null, and the strip drops that tile
 * rather than the whole strip. Access mirrors /api/league/matchup-center.
 */

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const league = await prisma.league.findFirst({
    where: {
      id: leagueId,
      OR: [{ userId: userId }, { teams: { some: { claimedByUserId: userId } } }],
    },
    select: { platform: true, settings: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const [pulse, rules] = await Promise.allSettled([
    getMyTeamPulse(userId, new Date(), undefined, null, leagueId),
    resolveWaiverRules(leagueId, String(league.platform ?? '')),
  ])

  let lineup: ThisWeekPayload['lineup'] = null
  if (pulse.status === 'fulfilled') {
    const p = pulse.value
    lineup = lineupFrom([...p.needs, ...p.set].find((r) => r.leagueId === leagueId))
  }

  let waivers: ThisWeekWaivers | null = null
  if (rules.status === 'fulfilled' && rules.value.processTime.available) {
    const run = rules.value.processTime.data
    waivers = { schedule: run.schedule, observed: run.observedRuns != null }
  }

  let tradeDeadline: ThisWeekTradeDeadline | null = null
  const deadline = leagueCalendar(league.settings).find((e) => e.key === 'trade' || e.key === 'trade-week')
  if (deadline) {
    const week = deadline.key === 'trade-week' ? Number(/\d+/.exec(deadline.when)?.[0]) : NaN
    tradeDeadline = { at: deadline.at, week: Number.isInteger(week) ? week : null }
  }

  const payload: ThisWeekPayload = { lineup, waivers, tradeDeadline }
  return NextResponse.json(payload)
}
