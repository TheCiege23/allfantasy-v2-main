import { prisma } from "@/lib/prisma"
import type { LeagueSport } from "@prisma/client"
import type { TournamentField } from "./providers/types"
import { normalizeTeamAbbrev } from "@/lib/team-abbrev"

type SeededTeamRow = {
  seed: number
  abbrev: string
  wins?: number
  losses?: number
  record?: string
}

function normAbbrev(s: string | null | undefined): string {
  if (!s) return ""
  return (normalizeTeamAbbrev(s.trim()) || s.trim()).toUpperCase()
}

type SeedResult = {
  seeded: number
  totalRound1Nodes: number
  warnings: string[]
}

/**
 * Apply a TournamentField (teams with region + seed) to an existing
 * bracket tournament by populating round‑of‑64 nodes with team names.
 *
 * This does not change structure (slots, rounds, nextNodeId/nextNodeSide);
 * it only fills `homeTeamName` and `awayTeamName` on round 1 nodes that
 * already have `seedHome` / `seedAway` set.
 */
export async function applyTournamentFieldToBracket(
  tournamentId: string,
  field: TournamentField
): Promise<SeedResult> {
  const warnings: string[] = []

  // Basic validation: ensure each (region, seed) appears at most once.
  const seenRegionSeed = new Map<string, string>()
  for (const t of field.teams) {
    const key = `${t.region}-${t.seed}`
    if (!t.teamName || !t.region || !t.seed) {
      warnings.push(`Skipping team with missing data: ${JSON.stringify(t)}`)
      continue
    }
    if (seenRegionSeed.has(key)) {
      warnings.push(
        `Duplicate team for region/seed ${key}: "${seenRegionSeed.get(
          key
        )}" and "${t.teamName}"`
      )
    } else {
      seenRegionSeed.set(key, t.teamName)
    }
  }

  const round1Nodes = await prisma.bracketNode.findMany({
    where: { tournamentId, round: 1 },
    select: {
      id: true,
      region: true,
      seedHome: true,
      seedAway: true,
    },
  })

  if (round1Nodes.length === 0) {
    warnings.push(
      `No round 1 nodes found for tournamentId=${tournamentId}. Did you run bracket init first?`
    )
    return { seeded: 0, totalRound1Nodes: 0, warnings }
  }

  const teamByRegionSeed = new Map<string, string>()
  for (const t of field.teams) {
    if (!t.region || !t.seed || !t.teamName) continue
    teamByRegionSeed.set(`${t.region}-${t.seed}`, t.teamName)
  }

  const updates: ReturnType<typeof prisma.bracketNode.update>[] = []
  let seeded = 0

  for (const node of round1Nodes) {
    if (!node.region || node.seedHome == null || node.seedAway == null) {
      warnings.push(
        `Round 1 node ${node.id} missing region or seeds (region=${node.region}, seedHome=${node.seedHome}, seedAway=${node.seedAway})`
      )
      continue
    }

    const home = teamByRegionSeed.get(`${node.region}-${node.seedHome}`) || null
    const away = teamByRegionSeed.get(`${node.region}-${node.seedAway}`) || null

    if (!home && !away) {
      warnings.push(
        `No team mapping found for node ${node.id} (region=${node.region}, seeds=${node.seedHome}/${node.seedAway})`
      )
      continue
    }

    const data: { homeTeamName?: string | null; awayTeamName?: string | null } = {}
    if (home) data.homeTeamName = home
    if (away) data.awayTeamName = away

    updates.push(
      prisma.bracketNode.update({
        where: { id: node.id },
        data,
      })
    )
    seeded++
  }

  if (updates.length > 0) {
    await prisma.$transaction(updates)
  }

  return {
    seeded,
    totalRound1Nodes: round1Nodes.length,
    warnings,
  }
}

/**
 * Seed round‑1 playoff nodes where `region` is null (pro/college playoff challenge).
 * Team names use abbreviations so they align with `SportsGame` and live score feeds.
 */
export async function applySeededTeamsToPlayoffBracket(
  tournamentId: string,
  teams: SeededTeamRow[],
): Promise<{ seeded: number; warnings: string[] }> {
  const warnings: string[] = []
  if (teams.length === 0) {
    return { seeded: 0, warnings }
  }

  const bySeed = new Map<number, string>()
  for (const t of teams) {
    if (!t.seed || t.seed < 1) continue
    const label = normAbbrev(t.abbrev)
    if (!label) continue
    if (bySeed.has(t.seed)) {
      warnings.push(`Duplicate seed ${t.seed} in standings payload`)
    }
    bySeed.set(t.seed, label)
  }

  const round1Nodes = await prisma.bracketNode.findMany({
    where: { tournamentId, round: 1 },
    select: {
      id: true,
      seedHome: true,
      seedAway: true,
    },
  })

  if (round1Nodes.length === 0) {
    warnings.push(`No round 1 nodes for tournament ${tournamentId}`)
    return { seeded: 0, warnings }
  }

  const updates: Array<ReturnType<typeof prisma.bracketNode.update>> = []
  let seeded = 0

  for (const node of round1Nodes) {
    const sh = node.seedHome
    const sa = node.seedAway
    const home =
      sh != null && sh >= 1 ? bySeed.get(sh) ?? null : null
    const away =
      sa != null && sa >= 1 ? bySeed.get(sa) ?? null : null

    if (!home && !away) continue

    updates.push(
      prisma.bracketNode.update({
        where: { id: node.id },
        data: {
          ...(home ? { homeTeamName: home } : {}),
          ...(away ? { awayTeamName: away } : {}),
        },
      }),
    )
    seeded++
  }

  if (updates.length > 0) {
    await prisma.$transaction(updates)
  }

  return { seeded, warnings }
}

/**
 * Attach `sportsGameId` to round‑1 nodes by matching team pairs to synced `SportsGame` rows.
 */
export async function linkRoundOneNodesToSportsGames(params: {
  tournamentId: string
  sport: LeagueSport
  season: number
}): Promise<{ linked: number; warnings: string[] }> {
  const { tournamentId, sport, season } = params
  const warnings: string[] = []

  const [nodes, games] = await Promise.all([
    prisma.bracketNode.findMany({
      where: { tournamentId, round: 1 },
      select: {
        id: true,
        homeTeamName: true,
        awayTeamName: true,
        sportsGameId: true,
      },
    }),
    prisma.sportsGame.findMany({
      where: {
        sport,
        season: { in: [season, season - 1] },
        source: { in: ["espn_live", "rolling_insights"] },
      },
      select: {
        id: true,
        homeTeam: true,
        awayTeam: true,
        startTime: true,
        status: true,
      },
      orderBy: { startTime: "desc" },
    }),
  ])

  function pickGameForPair(home: string, away: string) {
    const nh = normAbbrev(home)
    const na = normAbbrev(away)
    if (!nh || !na) return null
    const matches = games.filter((g) => {
      const gh = normAbbrev(g.homeTeam)
      const ga = normAbbrev(g.awayTeam)
      return (gh === nh && ga === na) || (gh === na && ga === nh)
    })
    if (matches.length === 0) return null
    const inProg = matches.find((g) =>
      String(g.status ?? "")
        .toLowerCase()
        .includes("progress"),
    )
    if (inProg) return inProg
    const upcoming = matches
      .filter((g) => {
        const st = String(g.status ?? "").toLowerCase()
        return !st.includes("final") && !st.includes("completed") && g.startTime && g.startTime > new Date()
      })
      .sort((a, b) => (a.startTime!.getTime() - b.startTime!.getTime()))
    if (upcoming[0]) return upcoming[0]
    return matches[0] ?? null
  }

  let linked = 0
  const updates: Array<ReturnType<typeof prisma.bracketNode.update>> = []

  for (const n of nodes) {
    if (!n.homeTeamName || !n.awayTeamName) continue
    if (n.sportsGameId) continue
    const g = pickGameForPair(n.homeTeamName, n.awayTeamName)
    if (!g) continue
    updates.push(
      prisma.bracketNode.update({
        where: { id: n.id },
        data: { sportsGameId: g.id },
      }),
    )
    linked++
  }

  if (updates.length > 0) {
    await prisma.$transaction(updates)
  }

  return { linked, warnings }
}

