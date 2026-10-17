/**
 * [NEW] GET: Big Brother league home summary (cycle, phase, HOH, nominees, veto, ballot, jury, eliminated, timeline).
 * PROMPT 4.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { isBigBrotherLeague, getBigBrotherConfig } from '@/lib/big-brother/BigBrotherLeagueConfig'
import { getCurrentCycleForLeague } from '@/lib/big-brother/BigBrotherPhaseStateMachine'
import { getEligibility } from '@/lib/big-brother/BigBrotherEligibilityEngine'
import { getFinalNomineeRosterIds } from '@/lib/big-brother/BigBrotherNominationEngine'
import { getJuryMembers } from '@/lib/big-brother/BigBrotherJuryEngine'
import { getRosterDisplayNamesForLeague } from '@/lib/big-brother/ai/getRosterDisplayNames'
import { getBigBrotherSportCalendarContext } from '@/lib/big-brother/BigBrotherSportCalendar'
import { compareMemoryWallEntries, resolveMemoryWallStatus } from '@/lib/big-brother/memoryWallStatus'
import { resolveHaveNotRosterIdsForCycle } from '@/lib/big-brother/BigBrotherChatChannels'
import { getVetoChallengeThemeHints } from '@/lib/big-brother/sport-adapter'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
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

  const [config, current, myRosterId, totalRosterCount, league] = await Promise.all([
    getBigBrotherConfig(leagueId),
    getCurrentCycleForLeague(leagueId),
    getCurrentUserRosterIdForLeague(leagueId, userId),
    prisma.roster.count({ where: { leagueId } }),
    prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } }),
  ])

  if (!config) return NextResponse.json({ error: 'Config not found' }, { status: 500 })

  let cycle: {
    id: string
    week: number
    phase: string
    hohRosterId: string | null
    nominee1RosterId: string | null
    nominee2RosterId: string | null
    vetoWinnerRosterId: string | null
    vetoParticipantRosterIds: string[] | null
    vetoUsed: boolean
    vetoSavedRosterId: string | null
    replacementNomineeRosterId: string | null
    evictedRosterId: string | null
    voteDeadlineAt: string | null
    voteOpenedAt: string | null
    closedAt: string | null
  } | null = null

  let finalNomineeRosterIds: string[] = []
  let eligibility: Awaited<ReturnType<typeof getEligibility>> = null
  let jury: { rosterId: string; evictedWeek: number }[] = []
  let ballot: { canVote: boolean; voteDeadlineAt: string | null; closed: boolean } | null = null
  let haveNotRosterIds: string[] = []
  let vetoChallenge: { competitorRosterIds: string[]; challengeMode: string; themeHints: string[] } | null = null

  if (current) {
    const cycleRow = await prisma.bigBrotherCycle.findUnique({
      where: { id: current.id },
      select: {
        id: true,
        week: true,
        phase: true,
        hohRosterId: true,
        nominee1RosterId: true,
        nominee2RosterId: true,
        vetoWinnerRosterId: true,
        vetoParticipantRosterIds: true,
        vetoUsed: true,
        vetoSavedRosterId: true,
        replacementNomineeRosterId: true,
        evictedRosterId: true,
        voteDeadlineAt: true,
        voteOpenedAt: true,
        closedAt: true,
      },
    })
    if (cycleRow) {
      cycle = {
        ...cycleRow,
        voteDeadlineAt: cycleRow.voteDeadlineAt?.toISOString() ?? null,
        voteOpenedAt: cycleRow.voteOpenedAt?.toISOString() ?? null,
        closedAt: cycleRow.closedAt?.toISOString() ?? null,
        vetoParticipantRosterIds: cycleRow.vetoParticipantRosterIds as string[] | null,
      }
      finalNomineeRosterIds = await getFinalNomineeRosterIds(current.id)
    }
    eligibility = await getEligibility(leagueId, { cycleId: current.id })
    jury = await getJuryMembers(leagueId)

    if (cycle && myRosterId) {
      const canVote = (eligibility?.canVote.includes(myRosterId) ?? false) && cycle.phase === 'VOTING_OPEN' && !cycle.closedAt && (!cycle.voteOpenedAt || new Date(cycle.voteOpenedAt) <= new Date()) && (!cycle.voteDeadlineAt || new Date(cycle.voteDeadlineAt) > new Date())
      ballot = {
        canVote,
        voteDeadlineAt: cycle.voteDeadlineAt,
        closed: !!cycle.closedAt || cycle.phase === 'VOTING_LOCKED' || !!cycle.voteDeadlineAt && new Date(cycle.voteDeadlineAt) <= new Date(),
      }
    }

    // Have-Not roster IDs (check for commissioner override first)
    try {
      const cycleForHaveNots = await prisma.bigBrotherCycle.findUnique({
        where: { id: current.id },
        select: { tieBreakSeasonPoints: true },
      })
      const raw = cycleForHaveNots?.tieBreakSeasonPoints as Record<string, unknown> | null
      if (raw && Array.isArray(raw.haveNotOverride)) {
        haveNotRosterIds = raw.haveNotOverride as string[]
      } else {
        haveNotRosterIds = await resolveHaveNotRosterIdsForCycle(leagueId, current.id)
      }
    } catch {
      // non-fatal
    }

    // Veto challenge context
    if (cycle?.phase === 'VETO_CHALLENGE_OPEN' && config) {
      vetoChallenge = {
        competitorRosterIds: (cycle.vetoParticipantRosterIds ?? []) as string[],
        challengeMode: config.challengeMode ?? 'hybrid',
        themeHints: getVetoChallengeThemeHints(config.sport),
      }
    }
  }

  const eliminatedRosterIds = eligibility?.eliminatedRosterIds ?? []
  const juryRosterIds = eligibility?.juryRosterIds ?? []

  const myStatus = myRosterId
    ? (() => {
        if (eliminatedRosterIds.includes(myRosterId))
          return jury.some((j) => j.rosterId === myRosterId) ? 'JURY' : 'ELIMINATED'
        if (cycle?.hohRosterId === myRosterId) return 'HOH'
        if (finalNomineeRosterIds.includes(myRosterId)) return 'NOMINATED'
        if (cycle?.vetoWinnerRosterId === myRosterId) return 'VETO_WINNER'
        if (cycle?.vetoParticipantRosterIds?.includes(myRosterId)) return 'VETO_PLAYER'
        return 'SAFE'
      })()
    : null

  const eliminatedCount = eliminatedRosterIds.length
  const remainingCount = totalRosterCount - eliminatedCount

  // Build finalists list for JuryCenter when finale is reached
  const finaleSize = config.finaleFormat === 'final_3' ? 3 : 2
  let finalists: Array<{ rosterId: string; stats?: { hohWins?: number; vetoWins?: number; timesNominated?: number } }> = []
  if (remainingCount > 0 && remainingCount <= finaleSize) {
    const activeRosters = await prisma.roster.findMany({
      where: { leagueId, id: { notIn: eliminatedRosterIds } },
      select: { id: true },
    })
    // Compute game stats for each finalist from cycle history
    const allCycles = await prisma.bigBrotherCycle.findMany({
      where: { leagueId },
      select: { hohRosterId: true, vetoWinnerRosterId: true, nominee1RosterId: true, nominee2RosterId: true, replacementNomineeRosterId: true },
    })
    finalists = activeRosters.map((r) => {
      const hohWins = allCycles.filter((c) => c.hohRosterId === r.id).length
      const vetoWins = allCycles.filter((c) => c.vetoWinnerRosterId === r.id).length
      const timesNominated = allCycles.filter((c) =>
        c.nominee1RosterId === r.id || c.nominee2RosterId === r.id || c.replacementNomineeRosterId === r.id
      ).length
      return { rosterId: r.id, stats: { hohWins, vetoWins, timesNominated } }
    })
  }

  const sportCalendar = await getBigBrotherSportCalendarContext(config.sport)

  const allRosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true, platformUserId: true },
  })
  const rosterDisplayNames = await getRosterDisplayNamesForLeague(
    leagueId,
    allRosters.length ? allRosters.map((r) => r.id) : undefined
  )
  const platformIds = [...new Set(allRosters.map((r) => r.platformUserId).filter(Boolean))]
  const usersForAvatar =
    platformIds.length > 0
      ? await prisma.appUser.findMany({
          where: { id: { in: platformIds } },
          select: { id: true, avatarUrl: true },
        })
      : []
  const avatarByUserId = new Map(usersForAvatar.map((u) => [u.id, u.avatarUrl ?? null] as const))

  const memoryWall = allRosters
    .map((r) => {
      const status = resolveMemoryWallStatus({
        rosterId: r.id,
        cycle,
        finalNomineeRosterIds,
        eliminatedRosterIds,
        juryRosterIds,
      })
      return {
        rosterId: r.id,
        displayName: rosterDisplayNames[r.id] ?? `Houseguest ${r.id.slice(0, 8)}`,
        avatarUrl: avatarByUserId.get(r.platformUserId) ?? null,
        status,
      }
    })
    .sort(compareMemoryWallEntries)

  return NextResponse.json({
    totalRosterCount,
    remainingCount,
    config: {
      sport: config.sport,
      finaleFormat: config.finaleFormat,
      juryStartMode: config.juryStartMode,
      challengeMode: config.challengeMode,
    },
    sportCalendar: {
      regularSeasonWeeks: sportCalendar.regularSeasonWeeks,
      evictionEndWeek: sportCalendar.evictionEndWeek,
      scoringWindowDisclaimer: sportCalendar.scoringWindowDisclaimer,
      timelineNote: sportCalendar.timelineNote,
    },
    cycle,
    finalNomineeRosterIds,
    eligibility: eligibility
      ? {
          canCompeteHOH: eligibility.canCompeteHOH,
          canBeNominated: eligibility.canBeNominated,
          canVote: eligibility.canVote,
          juryRosterIds: eligibility.juryRosterIds,
          eliminatedRosterIds: eligibility.eliminatedRosterIds,
        }
      : null,
    jury,
    finalists,
    ballot,
    myRosterId,
    myStatus,
    rosterDisplayNames,
    memoryWall,
    isCommissioner: league?.userId === userId,
    haveNotRosterIds,
    vetoChallenge,
  })
}
