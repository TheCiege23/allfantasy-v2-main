import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { computeLineupActionsForUser } from '@/lib/lineup-actions/computeLineupActionsForUser'
import { attachChimmyAdviceToLineupSummary } from '@/lib/lineup-actions/chimmyLineupAdvice'
import { resolveNormalizedLeagueContext } from '@/lib/league-context-engine'
import { buildAiTimeContextPayload } from '@/lib/time-engine/userContext'
import { estimateNextWaiversProcessUTC } from '@/lib/time-engine/estimateWaiverRun'
import type { FantasyTimeEngineExtras } from '@/lib/time-engine/fantasyTimePayload'
import { getServerNowUTC } from '@/lib/time-engine/serverClock'
import { prisma } from '@/lib/prisma'
import { isSportsDataEnabled } from '@/lib/fantasy-os/sports-runtime/gates'
import { CertifiedLineupIntegrationService, extractPlayerRefs } from '@/lib/fantasy-os/sports-runtime/lineupIntegration'
import { weekFromLeagueSettingsForLineup } from '@/lib/roster/buildPersistedRosterDataFromRosterState'

export const dynamic = 'force-dynamic'

/**
 * Gated, informational-only certified schedule urgency for this league's starters. Exposes kickoff countdown,
 * lock urgency, delayed/unavailable schedule state. It NEVER mutates a lineup and NEVER changes the action list —
 * the existing computeLineupActionsForUser output is the authority. Wrapped so it can never fail the route.
 */
async function buildSportsScheduleUrgency(leagueId: string, userId: string, now: Date) {
  const league = await prisma.league.findFirst({ where: { id: leagueId }, select: { sport: true, season: true, settings: true } })
  if (!league || String(league.sport ?? 'NFL').toUpperCase() !== 'NFL') return undefined
  const roster = await prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { playerData: true } })
  const refs = extractPlayerRefs(roster?.playerData)
  const week = weekFromLeagueSettingsForLineup(league.settings)
  const season = league.season ?? now.getFullYear()
  const desc = await new CertifiedLineupIntegrationService().describeScheduleForPlayers({ season: String(season), week: String(week), players: refs, now })
  const kickoffs = desc.players.map((p) => p.kickoff).filter((k): k is string => !!k).map((k) => new Date(k).getTime()).filter((t) => Number.isFinite(t))
  const nextKickoff = kickoffs.length > 0 ? Math.min(...kickoffs) : null
  return {
    featureGateEnabled: true,
    scheduleAvailable: desc.available,
    scheduleDelayed: desc.freshnessStatus !== 'current',
    freshnessStatus: desc.freshnessStatus,
    identityStatus: desc.identityStatus,
    snapshotVersion: desc.snapshotVersion,
    nextKickoffAt: nextKickoff ? new Date(nextKickoff).toISOString() : null,
    minutesToNextKickoff: nextKickoff ? Math.max(0, Math.round((nextKickoff - now.getTime()) / 60000)) : null,
    lockedStarters: desc.players.filter((p) => p.locked).length,
    lockUrgency: desc.available && desc.players.some((p) => p.locked) ? 'locked' : 'none',
    unsupported: desc.unsupported,
    informationalOnly: true as const,
  }
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leagueId } = await ctx.params
  if (!leagueId) {
    return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  }

  const summary = await computeLineupActionsForUser(userId)
  const actions = summary.actions.filter((a) => a.leagueId === leagueId)
  const leagues = summary.leagues.filter((l) => l.leagueId === leagueId)
  const countable = actions.filter((a) => a.reasonType !== 'fetch_error' && a.severity !== 'info')
  const filtered = {
    ...summary,
    actions,
    leagues,
    totalIssues: countable.length,
    totalUnresolvedSlotActions: countable.length,
    leaguesNeedingAttention: leagues.length > 0 && countable.length > 0 ? 1 : 0,
    lineupsNeedingAttention: leagues.length > 0 && countable.length > 0 ? 1 : 0,
    urgentLineupActions: actions.filter((a) => a.urgency === 'urgent').length,
    scanWarningLeagues: leagues.some((l) => l.scanIncomplete) ? 1 : 0,
  }
  const withChimmy = await attachChimmyAdviceToLineupSummary(filtered, userId)

  let timeExtras: FantasyTimeEngineExtras | undefined
  const resolved = await resolveNormalizedLeagueContext({ userId, leagueId })
  if (resolved.ok) {
    const n = resolved.context
    const nextWaiver = estimateNextWaiversProcessUTC({
      leagueTimezone: n.timezone,
      waiverProcessTime: n.waiver.waiverProcessTime,
      serverNow: getServerNowUTC(),
    })
    timeExtras = { sportHint: n.sport, waiversProcessAt: nextWaiver?.toISOString() ?? null }
  }

  const intelligence = {
    schemaVersion: 1 as const,
    time: await buildAiTimeContextPayload(userId, timeExtras),
  }

  let sportsSchedule: Awaited<ReturnType<typeof buildSportsScheduleUrgency>>
  if (isSportsDataEnabled('lineup')) {
    try {
      sportsSchedule = await buildSportsScheduleUrgency(leagueId, userId, new Date())
    } catch {
      sportsSchedule = undefined
    }
  }

  return NextResponse.json({ ...withChimmy, intelligence, ...(sportsSchedule ? { sportsSchedule } : {}) })
}
