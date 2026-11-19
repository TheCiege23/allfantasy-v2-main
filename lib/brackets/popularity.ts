import { prisma } from "@/lib/prisma"

type RawPick = {
  nodeId: string
  teamName: string
  leagueId: string
}

export function summarizeGlobalPopularity(picks: RawPick[]): Map<string, { total: number; perTeam: Map<string, number> }> {
  const perNode = new Map<string, { total: number; perTeam: Map<string, number> }>()
  for (const p of picks) {
    if (!p.teamName) continue
    const nodeKey = p.nodeId
    let entry = perNode.get(nodeKey)
    if (!entry) {
      entry = { total: 0, perTeam: new Map() }
      perNode.set(nodeKey, entry)
    }
    entry.total++
    entry.perTeam.set(p.teamName, (entry.perTeam.get(p.teamName) || 0) + 1)
  }
  return perNode
}

export function summarizeLeaguePopularity(picks: RawPick[]): Map<string, { total: number; perTeam: Map<string, number> }> {
  const perLeagueNode = new Map<string, { total: number; perTeam: Map<string, number> }>()
  for (const p of picks) {
    if (!p.teamName) continue
    const key = `${p.leagueId}:${p.nodeId}`
    let entry = perLeagueNode.get(key)
    if (!entry) {
      entry = { total: 0, perTeam: new Map() }
      perLeagueNode.set(key, entry)
    }
    entry.total++
    entry.perTeam.set(p.teamName, (entry.perTeam.get(p.teamName) || 0) + 1)
  }
  return perLeagueNode
}

export async function computeTournamentPickPopularity(tournamentId: string) {
  const nodes = await prisma.bracketNode.findMany({
    where: { tournamentId },
    select: { id: true, round: true },
  })
  if (nodes.length === 0) {
    return { global: 0, league: 0 }
  }
  const nodeRound = new Map(nodes.map((n) => [n.id, n.round]))

  const picks = await prisma.bracketPick.findMany({
    where: {
      pickedTeamName: { not: null },
      entry: {
        status: { notIn: ["DRAFT", "INVALIDATED"] },
        league: { tournamentId },
      },
    },
    select: {
      nodeId: true,
      pickedTeamName: true,
      entry: { select: { leagueId: true } },
    },
  })

  const raw: RawPick[] = picks
    .filter((p) => p.nodeId && p.pickedTeamName && p.entry?.leagueId)
    .map((p) => ({
      nodeId: p.nodeId,
      teamName: p.pickedTeamName as string,
      leagueId: p.entry!.leagueId,
    }))

  if (raw.length === 0) {
    return { global: 0, league: 0 }
  }

  const globalSummary = summarizeGlobalPopularity(raw)
  const leagueSummary = summarizeLeaguePopularity(raw)

  const upserts: any[] = []
  let globalCount = 0
  let leagueCount = 0

  for (const [nodeId, summary] of globalSummary.entries()) {
    const total = summary.total
    if (!total) continue
    const round = nodeRound.get(nodeId) ?? 0
    for (const [teamName, count] of summary.perTeam.entries()) {
      const pct = total > 0 ? (count / total) * 100 : 0
      upserts.push(
        prisma.bracketPickPopularity.upsert({
          where: {
            tournamentId_leagueId_nodeId_teamName_scope: {
              tournamentId,
              // leagueId is null for global scope; cast to satisfy TS while
              // preserving the Prisma schema type.
              leagueId: null as any,
              nodeId,
              teamName,
              scope: "global",
            },
          },
          update: {
            round,
            pickCount: count,
            pickPct: pct,
          },
          create: {
            tournamentId,
            leagueId: null as any,
            nodeId,
            round,
            teamName,
            scope: "global",
            pickCount: count,
            pickPct: pct,
          },
        }),
      )
      globalCount++
    }
  }

  for (const [key, summary] of leagueSummary.entries()) {
    const [leagueId, nodeId] = key.split(":")
    const total = summary.total
    if (!total) continue
    const round = nodeRound.get(nodeId) ?? 0
    for (const [teamName, count] of summary.perTeam.entries()) {
      const pct = total > 0 ? (count / total) * 100 : 0
      upserts.push(
        prisma.bracketPickPopularity.upsert({
          where: {
            tournamentId_leagueId_nodeId_teamName_scope: {
              tournamentId,
              leagueId,
              nodeId,
              teamName,
              scope: "league",
            },
          },
          update: {
            round,
            pickCount: count,
            pickPct: pct,
          },
          create: {
            tournamentId,
            leagueId,
            nodeId,
            round,
            teamName,
            scope: "league",
            pickCount: count,
            pickPct: pct,
          },
        }),
      )
      leagueCount++
    }
  }

  if (upserts.length) {
    await prisma.$transaction(upserts)
  }

  return { global: globalCount, league: leagueCount }
}

