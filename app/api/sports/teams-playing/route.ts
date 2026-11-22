import { withApiUsage } from '@/lib/telemetry/usage'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildWeekKickoffMap, easternDayKey } from '@/lib/redraft/lineupLock'
import { dailySportWeekForInstant } from '@/lib/season-week/dailySportSeasonStarts'
import { proTeamCode } from '@/lib/player-identity/proFantraxIdentityPlan'

export const dynamic = 'force-dynamic'

/** Sports whose roster abbreviations and schedule names reconcile through `proTeamCode`. */
const NG_SPORTS = new Set(['NBA', 'NHL', 'MLB'])

/**
 * Which of the given clubs have a game TODAY (the US Eastern day — the rule `game_date` is written
 * by), for NG ("no game") on the league page's roster rows. Postgres only: the same week schedule the
 * lineup lock reads (`buildWeekKickoffMap`), no provider call.
 *
 * `judged: false` means "do not show NG for anyone": an unsupported sport, a day outside the season,
 * or a day with no games on record — which is indistinguishable from a schedule we failed to load, so
 * it never becomes "nobody plays". A club whose name we cannot reconcile is reported as unknown, not
 * as off.
 */
export const GET = withApiUsage({ endpoint: '/api/sports/teams-playing', tool: 'SportsTeamsPlaying' })(async (request: NextRequest) => {
  const params = request.nextUrl.searchParams
  const sport = String(params.get('sport') || '').toUpperCase()
  const season = Number(params.get('season'))
  const teams = String(params.get('teams') || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 60)
  const none = (day: string | null) => NextResponse.json({ day, judged: false, playing: [], notPlaying: [] })

  if (!NG_SPORTS.has(sport) || !Number.isInteger(season) || teams.length === 0) return none(null)
  const now = new Date()
  const day = easternDayKey(now)
  const week = dailySportWeekForInstant(sport, season, now)
  if (!day || week == null) return none(day)

  const kickoffs = await buildWeekKickoffMap(prisma, { sport, season, week }).catch(() => null)
  const byTeamDay = kickoffs?.byTeamDay
  if (!byTeamDay) return none(day)

  const playingCodes = new Set<string>()
  for (const [team, days] of byTeamDay) {
    if (!days.has(day)) continue
    const code = proTeamCode(sport as 'NBA' | 'NHL' | 'MLB', team)
    if (code) playingCodes.add(code)
  }
  if (playingCodes.size === 0) return none(day)

  const playing: string[] = []
  const notPlaying: string[] = []
  for (const team of teams) {
    const code = proTeamCode(sport as 'NBA' | 'NHL' | 'MLB', team)
    if (!code) continue // cannot reconcile this club's name: say nothing about it
    ;(playingCodes.has(code) ? playing : notPlaying).push(team)
  }
  return NextResponse.json({ day, judged: true, playing, notPlaying }, { headers: { 'Cache-Control': 'private, max-age=300' } })
})
