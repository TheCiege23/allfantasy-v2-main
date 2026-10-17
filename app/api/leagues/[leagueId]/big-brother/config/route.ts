/**
 * [NEW] GET/PATCH: Big Brother league config. Commissioner or member can read; only commissioner can PATCH.
 * PROMPT 2/6.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { specialtySettingsEditRefusal } from '@/lib/league/specialty-settings-access'
import {
  isBigBrotherLeague,
  getBigBrotherConfig,
  upsertBigBrotherConfig,
} from '@/lib/big-brother/BigBrotherLeagueConfig'

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

  const commissioner = await isCommissioner(leagueId, userId)
  if (!commissioner) return NextResponse.json({ error: 'Commish only' }, { status: 403 })
  const refusal = await specialtySettingsEditRefusal(leagueId, userId)
  if (refusal) return refusal

  const isBB = await isBigBrotherLeague(leagueId)
  if (!isBB) return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const updated = await upsertBigBrotherConfig(leagueId, {
    ...(body.hohChallengeDayOfWeek !== undefined && { hohChallengeDayOfWeek: body.hohChallengeDayOfWeek == null ? null : Number(body.hohChallengeDayOfWeek) }),
    ...(body.hohChallengeTimeUtc !== undefined && { hohChallengeTimeUtc: body.hohChallengeTimeUtc == null ? null : String(body.hohChallengeTimeUtc) }),
    ...(body.nominationDeadlineDayOfWeek !== undefined && { nominationDeadlineDayOfWeek: body.nominationDeadlineDayOfWeek == null ? null : Number(body.nominationDeadlineDayOfWeek) }),
    ...(body.nominationDeadlineTimeUtc !== undefined && { nominationDeadlineTimeUtc: body.nominationDeadlineTimeUtc == null ? null : String(body.nominationDeadlineTimeUtc) }),
    ...(body.vetoDrawDayOfWeek !== undefined && { vetoDrawDayOfWeek: body.vetoDrawDayOfWeek == null ? null : Number(body.vetoDrawDayOfWeek) }),
    ...(body.vetoDrawTimeUtc !== undefined && { vetoDrawTimeUtc: body.vetoDrawTimeUtc == null ? null : String(body.vetoDrawTimeUtc) }),
    ...(body.vetoDecisionDeadlineDayOfWeek !== undefined && { vetoDecisionDeadlineDayOfWeek: body.vetoDecisionDeadlineDayOfWeek == null ? null : Number(body.vetoDecisionDeadlineDayOfWeek) }),
    ...(body.vetoDecisionDeadlineTimeUtc !== undefined && { vetoDecisionDeadlineTimeUtc: body.vetoDecisionDeadlineTimeUtc == null ? null : String(body.vetoDecisionDeadlineTimeUtc) }),
    ...(body.replacementNomineeDeadlineDayOfWeek !== undefined && { replacementNomineeDeadlineDayOfWeek: body.replacementNomineeDeadlineDayOfWeek == null ? null : Number(body.replacementNomineeDeadlineDayOfWeek) }),
    ...(body.replacementNomineeDeadlineTimeUtc !== undefined && { replacementNomineeDeadlineTimeUtc: body.replacementNomineeDeadlineTimeUtc == null ? null : String(body.replacementNomineeDeadlineTimeUtc) }),
    ...(body.evictionVoteOpenDayOfWeek !== undefined && { evictionVoteOpenDayOfWeek: body.evictionVoteOpenDayOfWeek == null ? null : Number(body.evictionVoteOpenDayOfWeek) }),
    ...(body.evictionVoteOpenTimeUtc !== undefined && { evictionVoteOpenTimeUtc: body.evictionVoteOpenTimeUtc == null ? null : String(body.evictionVoteOpenTimeUtc) }),
    ...(body.evictionVoteCloseDayOfWeek !== undefined && { evictionVoteCloseDayOfWeek: body.evictionVoteCloseDayOfWeek == null ? null : Number(body.evictionVoteCloseDayOfWeek) }),
    ...(body.evictionVoteCloseTimeUtc !== undefined && { evictionVoteCloseTimeUtc: body.evictionVoteCloseTimeUtc == null ? null : String(body.evictionVoteCloseTimeUtc) }),
    ...(body.finalNomineeCount !== undefined && { finalNomineeCount: Number(body.finalNomineeCount) }),
    ...(body.vetoCompetitorCount !== undefined && { vetoCompetitorCount: Number(body.vetoCompetitorCount) }),
    ...(body.consecutiveHohAllowed !== undefined && { consecutiveHohAllowed: Boolean(body.consecutiveHohAllowed) }),
    ...(body.hohVotesOnlyInTie !== undefined && { hohVotesOnlyInTie: Boolean(body.hohVotesOnlyInTie) }),
    ...(body.juryStartMode !== undefined && { juryStartMode: String(body.juryStartMode) }),
    ...(body.juryStartAfterEliminations !== undefined && { juryStartAfterEliminations: body.juryStartAfterEliminations == null ? null : Number(body.juryStartAfterEliminations) }),
    ...(body.juryStartWhenRemaining !== undefined && { juryStartWhenRemaining: body.juryStartWhenRemaining == null ? null : Number(body.juryStartWhenRemaining) }),
    ...(body.juryStartWeek !== undefined && { juryStartWeek: body.juryStartWeek == null ? null : Number(body.juryStartWeek) }),
    ...(body.finaleFormat !== undefined && { finaleFormat: String(body.finaleFormat) }),
    ...(body.waiverReleaseTiming !== undefined && { waiverReleaseTiming: String(body.waiverReleaseTiming) }),
    ...(body.publicVoteTotalsVisibility !== undefined && { publicVoteTotalsVisibility: String(body.publicVoteTotalsVisibility) }),
    ...(body.challengeMode !== undefined && { challengeMode: String(body.challengeMode) }),
    ...(body.antiCollusionLogging !== undefined && { antiCollusionLogging: Boolean(body.antiCollusionLogging) }),
    ...(body.inactivePlayerHandling !== undefined && { inactivePlayerHandling: String(body.inactivePlayerHandling) }),
    ...(body.autoNominationFallback !== undefined && { autoNominationFallback: String(body.autoNominationFallback) }),
    ...(body.evictionTieBreakMode !== undefined && { evictionTieBreakMode: String(body.evictionTieBreakMode) }),
    ...(body.weekProgressionPaused !== undefined && { weekProgressionPaused: Boolean(body.weekProgressionPaused) }),
  })
  return NextResponse.json({ ok: true, config: updated })
}
