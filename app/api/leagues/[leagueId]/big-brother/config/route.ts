/**
 * GET/PATCH: Big Brother league config. Commissioner or member can read; only commissioner can PATCH.
 * PATCH takes only the settings the game reads, each validated (lib/big-brother/configPatch.ts), behind the
 * league's "Format rules" lock, and every change is written to the league log.
 */

import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import {
  isBigBrotherLeague,
  getBigBrotherConfig,
  upsertBigBrotherConfig,
} from '@/lib/big-brother/BigBrotherLeagueConfig'
import { formatRulesLockedResponse, logFormatRulesChange } from '@/lib/league/formatRulesGuard'
import { parseBigBrotherConfigPatch } from '@/lib/big-brother/configPatch'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isBB = await isBigBrotherLeague(leagueId)
  if (!isBB) return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 404 })

  const config = await getBigBrotherConfig(leagueId)
  if (!config) return NextResponse.json({ config: null })
  // Jury and finale are fixed once anyone is evicted (lib/big-brother/configPatch.ts); the editor says so up front.
  const evictionsSoFar = await prisma.bigBrotherCycle.count({ where: { leagueId, evictedRosterId: { not: null } } })

  return NextResponse.json({
    config: {
      sport: config.sport,
      hohChallengeDayOfWeek: config.hohChallengeDayOfWeek,
      hohChallengeTimeUtc: config.hohChallengeTimeUtc,
      nominationDeadlineDayOfWeek: config.nominationDeadlineDayOfWeek,
      nominationDeadlineTimeUtc: config.nominationDeadlineTimeUtc,
      vetoDrawDayOfWeek: config.vetoDrawDayOfWeek,
      vetoDrawTimeUtc: config.vetoDrawTimeUtc,
      vetoDecisionDeadlineDayOfWeek: config.vetoDecisionDeadlineDayOfWeek,
      vetoDecisionDeadlineTimeUtc: config.vetoDecisionDeadlineTimeUtc,
      replacementNomineeDeadlineDayOfWeek: config.replacementNomineeDeadlineDayOfWeek,
      replacementNomineeDeadlineTimeUtc: config.replacementNomineeDeadlineTimeUtc,
      evictionVoteOpenDayOfWeek: config.evictionVoteOpenDayOfWeek,
      evictionVoteOpenTimeUtc: config.evictionVoteOpenTimeUtc,
      evictionVoteCloseDayOfWeek: config.evictionVoteCloseDayOfWeek,
      evictionVoteCloseTimeUtc: config.evictionVoteCloseTimeUtc,
      finalNomineeCount: config.finalNomineeCount,
      vetoCompetitorCount: config.vetoCompetitorCount,
      consecutiveHohAllowed: config.consecutiveHohAllowed,
      hohVotesOnlyInTie: config.hohVotesOnlyInTie,
      juryStartMode: config.juryStartMode,
      juryStartAfterEliminations: config.juryStartAfterEliminations,
      juryStartWhenRemaining: config.juryStartWhenRemaining,
      juryStartWeek: config.juryStartWeek,
      finaleFormat: config.finaleFormat,
      waiverReleaseTiming: config.waiverReleaseTiming,
      publicVoteTotalsVisibility: config.publicVoteTotalsVisibility,
      challengeMode: config.challengeMode,
      antiCollusionLogging: config.antiCollusionLogging,
      inactivePlayerHandling: config.inactivePlayerHandling,
      autoNominationFallback: config.autoNominationFallback,
      evictionTieBreakMode: config.evictionTieBreakMode,
      weekProgressionPaused: config.weekProgressionPaused,
      premiumEngineSpec: config.premiumEngineSpec ?? null,
    },
    juryAndFinaleOpen: evictionsSoFar === 0,
  })
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const commissioner = await canCommissionerAct(leagueId, userId, 'league')
  if (!commissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const isBB = await isBigBrotherLeague(leagueId)
  if (!isBB) return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 404 })
  const formatLocked = await formatRulesLockedResponse(leagueId)
  if (formatLocked) return formatLocked

  const body = await req.json().catch(() => null)
  // One rule for every write path (lib/big-brother/configPatch.ts): live settings only, each value checked, and jury
  // and finale fixed once anyone has been evicted.
  const [current, evictionsSoFar] = await Promise.all([
    getBigBrotherConfig(leagueId),
    prisma.bigBrotherCycle.count({ where: { leagueId, evictedRosterId: { not: null } } }),
  ])
  const parsed = parseBigBrotherConfigPatch(body, { evictionsSoFar, current: current ?? {} })
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: parsed.status })

  const updated = await upsertBigBrotherConfig(leagueId, parsed.input)
  await logFormatRulesChange({ leagueId, userId, format: 'big_brother', fields: parsed.fields })
  return NextResponse.json({ ok: true, config: updated })
}
