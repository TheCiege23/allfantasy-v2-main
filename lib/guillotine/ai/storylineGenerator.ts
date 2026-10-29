import { prisma } from '@/lib/prisma'

export type DynastyStoryline = { headline: string; body: string; tags?: string[] }

export async function generateWeeklyGuillotineRecap(seasonId: string, scoringPeriod: number): Promise<DynastyStoryline> {
  const [season, eliminations, dangerLogs] = await Promise.all([
    prisma.guillotineSeason.findFirst({
      where: { id: seasonId },
      select: { league: { select: { name: true } } },
    }),
    prisma.guillotineElimination.findMany({
      where: { seasonId, scoringPeriod },
      orderBy: { eliminatedAt: 'desc' },
      take: 3,
      select: { eliminatedTeamName: true },
    }),
    prisma.guillotineSurvivalLog.findMany({
      where: { seasonId, scoringPeriod, wasInDangerZone: true },
      orderBy: { marginAboveChopLine: 'asc' },
      take: 3,
      select: { rosterId: true },
    }),
  ])

  const choppedNames = eliminations.map((e) => e.eliminatedTeamName).filter(Boolean)
  const dangerRosterIds = dangerLogs.map((l) => l.rosterId)
  const leagueName = season?.league?.name ?? 'Guilly League'

  return {
    headline: `The Blade Falls — Week ${scoringPeriod}`,
    body: [
      `${leagueName} recap:`,
      choppedNames.length > 0
        ? `${choppedNames.join(', ')} got chopped this period.`
        : 'No teams were chopped this period.',
      dangerRosterIds.length > 0
        ? `Danger zone: ${dangerRosterIds.join(', ')} are living on the edge.`
        : 'No teams are currently flagged in the danger zone.',
    ].join(' '),
    tags: ['guillotine', 'recap'],
  }
}

export async function generateEliminationPage(eliminationId: string): Promise<DynastyStoryline> {
  const elimination = await prisma.guillotineElimination.findFirst({
    where: { id: eliminationId },
    select: {
      eliminatedTeamName: true,
      scoringPeriod: true,
      finalScore: true,
      marginBelowSafe: true,
      aiCollapseReason: true,
    },
  })

  if (!elimination) {
    return {
      headline: 'Elimination post',
      body: 'Elimination record not found.',
      tags: ['guillotine', 'elimination'],
    }
  }

  return {
    headline: `${elimination.eliminatedTeamName} chopped in Week ${elimination.scoringPeriod}`,
    body: [
      `${elimination.eliminatedTeamName} was eliminated with ${elimination.finalScore.toFixed(2)} points.`,
      `${Math.abs(elimination.marginBelowSafe).toFixed(2)} points separated them from safety.`,
      elimination.aiCollapseReason
        ? `Collapse reason: ${elimination.aiCollapseReason}`
        : 'No AI collapse reason was recorded.',
    ].join(' '),
    tags: ['guillotine', 'elimination'],
  }
}

export async function generateChopWeekWaiverRecap(seasonId: string, scoringPeriod: number): Promise<DynastyStoryline> {
  const releases = await prisma.guillotineWaiverRelease.findMany({
    where: { seasonId, scoringPeriod },
    orderBy: [{ winningBid: 'desc' }],
    take: 40,
    select: {
      playerName: true,
      releaseStatus: true,
      claimedByRosterId: true,
      winningBid: true,
    },
  })

  const claimed = releases.filter((r) => r.releaseStatus === 'claimed')
  const pending = releases.filter((r) => r.releaseStatus !== 'claimed')
  const topClaim = claimed.find((r) => (r.winningBid ?? 0) > 0)

  return {
    headline: `Waiver War — Week ${scoringPeriod}`,
    body: [
      `${claimed.length} players were claimed and ${pending.length} remain available.`,
      topClaim
        ? `Top splash: ${topClaim.playerName} for $${Number(topClaim.winningBid ?? 0).toFixed(0)}.`
        : 'No winning bids were recorded yet.',
      'Managers are reloading for the next chop line.',
    ].join(' '),
    tags: ['guillotine', 'faab'],
  }
}

export async function generateFinalStagePreview(seasonId: string): Promise<DynastyStoryline> {
  const season = await prisma.guillotineSeason.findFirst({
    where: { id: seasonId },
    select: {
      currentScoringPeriod: true,
      isInFinalStage: true,
      league: { select: { name: true } },
    },
  })

  if (!season) {
    return {
      headline: 'Final stage preview',
      body: 'Season not found.',
      tags: ['guillotine', 'finals'],
    }
  }

  const finalists = await prisma.guillotineSurvivalLog.findMany({
    where: {
      seasonId,
      scoringPeriod: season.currentScoringPeriod,
    },
    orderBy: [{ rankAmongActive: 'asc' }],
    take: 4,
    select: { rosterId: true, rankAmongActive: true },
  })

  return {
    headline: `${season.league.name} Final Stage Preview`,
    body: [
      season.isInFinalStage
        ? 'The league has entered final-stage survival mode.'
        : 'Final stage is approaching fast.',
      finalists.length > 0
        ? `Current top survivors: ${finalists.map((f) => `#${f.rankAmongActive} ${f.rosterId}`).join(', ')}.`
        : 'No finalist standings are available yet.',
      'Every waiver dollar and lineup floor call now decides the championship path.',
    ].join(' '),
    tags: ['guillotine', 'finals'],
  }
}
