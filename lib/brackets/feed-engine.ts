import { prisma } from "@/lib/prisma"

const COOLDOWN_MS = 5 * 60 * 1000

async function hasCooldown(
  tournamentId: string,
  eventType: string,
  leagueId?: string | null,
  cooldownKey?: string
): Promise<boolean> {
  const since = new Date(Date.now() - COOLDOWN_MS)
  const where: any = {
    tournamentId,
    eventType,
    createdAt: { gt: since },
  }
  if (leagueId) where.leagueId = leagueId
  if (cooldownKey) {
    where.metadata = { path: ["key"], equals: cooldownKey }
  }

  const recent = await (prisma as any).bracketFeedEvent.findFirst({ where })
  return Boolean(recent)
}

async function createEvent(data: {
  tournamentId: string
  leagueId?: string | null
  eventType: string
  headline: string
  detail?: string
  metadata?: any
}) {
  return (prisma as any).bracketFeedEvent.create({
    data: {
      tournamentId: data.tournamentId,
      leagueId: data.leagueId || null,
      eventType: data.eventType,
      headline: data.headline,
      detail: data.detail || null,
      metadata: data.metadata || null,
    },
  })
}

export async function checkUpsetImpact(
  tournamentId: string,
  winnerTeam: string,
  loserTeam: string,
  winnerSeed: number,
  loserSeed: number,
  nodeId: string
) {
  if (winnerSeed <= loserSeed) return

  const seedDiff = winnerSeed - loserSeed
  if (seedDiff < 4) return

  const cooldownKey = `upset_${nodeId}`
  if (await hasCooldown(tournamentId, "BIG_UPSET", null, cooldownKey)) return
  if (await hasCooldown(tournamentId, "UPSET_BUSTED", null, cooldownKey)) return

  const allPicks = await prisma.bracketPick.findMany({
    where: { nodeId },
    select: { pickedTeamName: true },
  })

  if (allPicks.length === 0) return

  const bustedCount = allPicks.filter(p => p.pickedTeamName === loserTeam).length
  const bustedPct = Math.round((bustedCount / allPicks.length) * 100)

  if (bustedPct >= 40) {
    await createEvent({
      tournamentId,
      eventType: "UPSET_BUSTED",
      headline: `${winnerSeed}-seed ${winnerTeam} just busted ${bustedPct}% of brackets`,
      detail: `${winnerTeam} (${winnerSeed}) upset ${loserTeam} (${loserSeed}). ${bustedCount} out of ${allPicks.length} brackets had ${loserTeam} advancing.`,
      metadata: { key: cooldownKey, winnerTeam, loserTeam, winnerSeed, loserSeed, bustedPct, nodeId },
    })
  } else if (seedDiff >= 8) {
    await createEvent({
      tournamentId,
      eventType: "BIG_UPSET",
      headline: `UPSET ALERT: ${winnerSeed}-seed ${winnerTeam} takes down ${loserSeed}-seed ${loserTeam}`,
      detail: `A ${seedDiff}-seed line upset! ${bustedPct}% of brackets affected.`,
      metadata: { key: cooldownKey, winnerTeam, loserTeam, winnerSeed, loserSeed, seedDiff, nodeId },
    })
  }
}

export async function checkChampEliminated(
  tournamentId: string,
  eliminatedTeam: string,
  eliminatedSeed: number
) {
  const cooldownKey = `champ_elim_${eliminatedTeam}`
  if (await hasCooldown(tournamentId, "CHAMP_ELIMINATED", null, cooldownKey)) return

  const championshipNodes = await prisma.bracketNode.findMany({
    where: { tournamentId, round: 6 },
    select: { id: true },
  })

  if (championshipNodes.length === 0) return

  const champNodeIds = championshipNodes.map(n => n.id)
  const champPicks = await prisma.bracketPick.findMany({
    where: {
      nodeId: { in: champNodeIds },
      pickedTeamName: eliminatedTeam,
    },
  })

  if (champPicks.length === 0) return

  const totalChampPicks = await prisma.bracketPick.count({
    where: { nodeId: { in: champNodeIds }, pickedTeamName: { not: null } },
  })

  const champPct = totalChampPicks > 0 ? Math.round((champPicks.length / totalChampPicks) * 100) : 0

  if (champPct >= 2) {
    await createEvent({
      tournamentId,
      eventType: "CHAMP_ELIMINATED",
      headline: `Championship pick ${eliminatedTeam} (${eliminatedSeed}) has been eliminated`,
      detail: `${champPct}% of brackets had ${eliminatedTeam} winning it all. Those dreams are officially over.`,
      metadata: { key: cooldownKey, eliminatedTeam, eliminatedSeed, champPct, champPickCount: champPicks.length },
    })
  }
}

export async function checkPerfectBrackets(tournamentId: string) {
  if (await hasCooldown(tournamentId, "PERFECT_TRACKER")) return

  const decidedNodes = await prisma.bracketNode.findMany({
    where: {
      tournamentId,
      picks: { some: { isCorrect: { not: null } } },
    },
    select: { id: true },
  })

  if (decidedNodes.length < 8) return

  const totalEntries = await prisma.bracketEntry.count({
    where: { league: { tournamentId } },
  })

  if (totalEntries === 0) return

  const incorrectEntryIds = await prisma.bracketPick.findMany({
    where: { node: { tournamentId }, isCorrect: false },
    select: { entryId: true },
    distinct: ["entryId"],
  })

  const imperfectCount = incorrectEntryIds.length
  const perfectCount = totalEntries - imperfectCount
  const perfectPct = Math.round((perfectCount / totalEntries) * 100)

  if (perfectPct <= 10 && perfectCount > 0) {
    await createEvent({
      tournamentId,
      eventType: "PERFECT_TRACKER",
      headline: `Only ${perfectPct}% of brackets still perfect`,
      detail: `${perfectCount} out of ${totalEntries} brackets remain perfect after ${decidedNodes.length} decided games.`,
      metadata: { perfectCount, totalEntries, perfectPct, decidedGames: decidedNodes.length },
    })
  }
}

