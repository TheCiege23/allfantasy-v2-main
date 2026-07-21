import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { runStartSitAiEngine } from '@/lib/ai-matchup-engine/runStartSitAiEngine'
import type { MatchupPlayerSlot } from '@/lib/matchup-center/types'
import { sanitizeStarterRow } from '@/lib/matchup-center/validateMatchupPayload'
import { AI_USAGE } from '@/lib/analytics/eventNames'
import { recordProductEvent } from '@/lib/analytics/recordAnalyticsEvent'
import { evaluateLegalityForPersistedRoster } from '@/lib/roster-legality/loadLegalityEvaluationContext'
import { buildLeagueScoringContextForAi } from '@/lib/scoring-defaults/LeagueScoringConfigResolver'
import { isSportsDataEnabled } from '@/lib/fantasy-os/sports-runtime/gates'
import { CertifiedLineupIntegrationService, extractPlayerRefs, type CertifiedScheduleDescription } from '@/lib/fantasy-os/sports-runtime/lineupIntegration'
import { weekFromLeagueSettingsForLineup } from '@/lib/roster/buildPersistedRosterDataFromRosterState'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function leagueScoringHint(leagueId: string): Promise<string | null> {
  const detailed = await buildLeagueScoringContextForAi(leagueId)
  if (detailed) return detailed
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { scoring: true, sport: true },
  })
  if (!league) return null
  const parts: string[] = []
  if (league.scoring) parts.push(`Scoring profile: ${league.scoring}`)
  parts.push(`Sport: ${String(league.sport)}`)
  return parts.join(' · ')
}

// Membership is decided by the canonical predicate (lib/league-access.ts). This previously
// matched `teams.some({ platformUserId })` — a nullable column populated only by the native
// open-slot claim path — with no roster/redraft/claim fallback, so every Roster-backed member
// of an imported league was 403'd out of their own start/sit advice.

export async function POST(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leagueId } = await params
  const access = await resolveLeagueAccess(leagueId, session.user.id)
  if (!access?.isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: {
    sport?: string
    playerA?: MatchupPlayerSlot
    playerB?: MatchupPlayerSlot
    /** When true, include roster legality blockers (IR / taxi / overflow) for premium UX. */
    includeRosterLegality?: boolean
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.playerA || !body.playerB) {
    return NextResponse.json({ error: 'playerA and playerB required' }, { status: 400 })
  }

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { sport: true, season: true, settings: true },
  })
  const sport = String(body.sport ?? league?.sport ?? 'NFL').trim()

  const playerA = sanitizeStarterRow(body.playerA)
  const playerB = sanitizeStarterRow(body.playerB)

  const hint = await leagueScoringHint(leagueId)
  const result = await runStartSitAiEngine({
    sport,
    playerA,
    playerB,
    leagueScoringHint: hint,
  })

  let rosterLegalitySummary: {
    isLegal: boolean
    blockingMessages: string[]
    highlightedPlayerIds: string[]
  } | null = null
  if (body.includeRosterLegality) {
    const roster = await prisma.roster.findFirst({
      where: { leagueId, platformUserId: session.user.id },
      select: { id: true, leagueId: true, playerData: true },
    })
    if (roster) {
      const ev = await evaluateLegalityForPersistedRoster(roster)
      if (ev) {
        rosterLegalitySummary = {
          isLegal: ev.result.isLegal,
          blockingMessages: ev.result.blockingReasons.map((b) => b.message).slice(0, 8),
          highlightedPlayerIds: ev.result.highlightedPlayerIds,
        }
      }
    }
  }

  // Gated, informational certified SCHEDULE evidence only (kickoff/status/lock/freshness/identity). Never blocks
  // the advice and never mutates. Injuries/projections/availability are NOT provided by the certified schedule
  // plane and are surfaced as explicitly `unavailable` rather than fabricated. Wrapped so it can never fail the route.
  let sportsSchedule: CertifiedScheduleDescription | undefined
  if (isSportsDataEnabled('lineup') && sport.toUpperCase() === 'NFL') {
    try {
      const week = weekFromLeagueSettingsForLineup(league?.settings)
      const season = league?.season ?? new Date().getFullYear()
      const refs = extractPlayerRefs([playerA?.playerId, playerB?.playerId].filter(Boolean))
      sportsSchedule = await new CertifiedLineupIntegrationService().describeScheduleForPlayers({ season: String(season), week: String(week), players: refs })
    } catch {
      sportsSchedule = undefined
    }
  }

  recordProductEvent(AI_USAGE.START_SIT, {
    userId: session.user.id,
    meta: { leagueId, sport },
  })

  return NextResponse.json({ result, leagueId, rosterLegality: rosterLegalitySummary, ...(sportsSchedule ? { sportsSchedule } : {}) })
}
