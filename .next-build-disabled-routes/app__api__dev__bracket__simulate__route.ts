import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { scoreAndAdvanceFinals } from "@/lib/bracket-sync"

export const runtime = "nodejs"

function requireDevSecret(req: Request) {
  const secret = process.env.BRACKET_DEV_SECRET
  if (!secret) return true
  const provided = req.headers.get("x-dev-secret") ?? ""
  return provided === secret
}

function seededScore(nodeId: string, side: "home" | "away"): number {
  let hash = 0
  const key = `${nodeId}-${side}`
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0
  }
  return 60 + Math.abs(hash % 30)
}

function seededWinner(nodeId: string): boolean {
  let hash = 0
  for (let i = 0; i < nodeId.length; i++) {
    hash = ((hash << 5) - hash + nodeId.charCodeAt(i)) | 0
  }
  return (Math.abs(hash) % 2) === 0
}

function pointsForRound(round: number): number {
  switch (round) {
    case 1: return 1
    case 2: return 2
    case 3: return 4
    case 4: return 8
    case 5: return 16
    case 6: return 32
    default: return 0
  }
}

interface RoundResult {
  round: number
  roundName: string
  gamesSimulated: number
  results: string[]
  scoring: { finalized: number; advanced: number; seeded: number }
}

const ROUND_NAMES: Record<number, string> = {
  0: "First Four",
  1: "Round of 64",
  2: "Round of 32",
  3: "Sweet 16",
  4: "Elite 8",
  5: "Final Four",
  6: "Championship",
}

async function simulateRound(
  tournamentId: string,
  round: number,
  season: number
): Promise<RoundResult | null> {
  const nodes = await (prisma as any).bracketNode.findMany({
    where: {
      tournamentId,
      round,
      homeTeamName: { not: null },
      awayTeamName: { not: null },
    },
    orderBy: { slot: "asc" },
  })

  if (nodes.length === 0) return null

  const results: string[] = []

  for (const n of nodes) {
    if (!n.homeTeamName || !n.awayTeamName) continue

    const homeWins = seededWinner(n.id)
    const winScore = seededScore(n.id, "home")
    const loseScore = Math.max(40, winScore - 5 - (seededScore(n.id, "away") % 15))
    const homeScore = homeWins ? winScore : loseScore
    const awayScore = homeWins ? loseScore : winScore

    if (n.sportsGameId) {
      await prisma.sportsGame.update({
        where: { id: n.sportsGameId },
        data: {
          homeScore,
          awayScore,
          status: "final",
          startTime: new Date(Date.now() - 120_000),
          fetchedAt: new Date(),
        },
      })
    } else {
      const game = await prisma.sportsGame.create({
        data: {
          sport: "ncaam",
          externalId: `dev-sim-${n.id}`,
          source: "dev-simulate",
          homeTeam: n.homeTeamName,
          awayTeam: n.awayTeamName,
          homeScore,
          awayScore,
          status: "final",
          startTime: new Date(Date.now() - 120_000),
          fetchedAt: new Date(),
          expiresAt: new Date(Date.now() + 86_400_000),
          season,
        },
      })
      await (prisma as any).bracketNode.update({
        where: { id: n.id },
        data: { sportsGameId: game.id },
      })
    }

    const winner = homeWins ? n.homeTeamName : n.awayTeamName
    results.push(`${n.homeTeamName} ${homeScore}-${awayScore} ${n.awayTeamName} → ${winner}`)
  }

  const scoring = await scoreAndAdvanceFinals(tournamentId)

  return {
    round,
    roundName: ROUND_NAMES[round] ?? `Round ${round}`,
    gamesSimulated: results.length,
    results,
    scoring,
  }
}

async function runDbAssertions(tournamentId: string, isFullMode: boolean) {
  const assertions: { name: string; pass: boolean; detail: string }[] = []

  const picksScored = await (prisma as any).bracketPick.findMany({
    where: {
      node: { tournamentId },
      isCorrect: { not: null },
    },
    select: { points: true, isCorrect: true, nodeId: true, entryId: true },
  })

  const correctPicks = picksScored.filter((p: any) => p.isCorrect === true)
  const incorrectPicks = picksScored.filter((p: any) => p.isCorrect === false)

  assertions.push({
    name: "Correct picks have positive points",
    pass: correctPicks.length === 0 || correctPicks.every((p: any) => p.points > 0),
    detail: `${correctPicks.length} correct picks checked`,
  })

  assertions.push({
    name: "Incorrect picks have 0 points",
    pass: incorrectPicks.every((p: any) => p.points === 0),
    detail: `${incorrectPicks.length} incorrect picks checked`,
  })

  const nodeRounds = await (prisma as any).bracketNode.findMany({
    where: { tournamentId },
    select: { id: true, round: true },
  })
  const roundByNode = new Map(nodeRounds.map((n: any) => [n.id, n.round]))
  const pointsMismatch = correctPicks.filter((p: any) => {
    const round = roundByNode.get(p.nodeId)
    return round !== undefined && p.points !== pointsForRound(round as number)
  })
  assertions.push({
    name: "Points match pointsForRound for correct picks",
    pass: pointsMismatch.length === 0,
    detail: pointsMismatch.length > 0
      ? `${pointsMismatch.length} mismatches found`
      : `All ${correctPicks.length} correct picks match expected round points`,
  })

  const entries = await (prisma as any).bracketEntry.findMany({
    where: { league: { tournamentId } },
    select: {
      id: true,
      name: true,
      picks: { select: { points: true } },
    },
  })

  const leaderboard = entries.map((e: any) => ({
    entry: e.name,
    entryId: e.id,
    totalPoints: e.picks.reduce((s: number, p: any) => s + p.points, 0),
    picksCount: e.picks.length,
  })).sort((a: any, b: any) => b.totalPoints - a.totalPoints)

  if (leaderboard.length > 0) {
    const picksByEntry = new Map<string, number>()
    for (const p of picksScored) {
      picksByEntry.set(p.entryId, (picksByEntry.get(p.entryId) ?? 0) + p.points)
    }
    const mismatches = leaderboard.filter((e: any) => {
      const dbSum = picksByEntry.get(e.entryId) ?? 0
      return e.totalPoints !== dbSum
    })
    assertions.push({
      name: "Leaderboard totals match sum of individual pick points",
      pass: mismatches.length === 0,
      detail: mismatches.length > 0
        ? `${mismatches.length} entries have mismatched totals`
        : `${leaderboard.length} entries verified — totals match`,
    })
  } else {
    assertions.push({
      name: "Leaderboard totals match sum of individual pick points",
      pass: true,
      detail: "No entries exist yet (create entries and make picks to verify)",
    })
  }

  const championNode = await (prisma as any).bracketNode.findFirst({
    where: { tournamentId, round: 6 },
    include: { sportsGame: true },
  })

  let champion: string | null = null
  if (championNode?.sportsGame?.status === "final") {
    const hs = championNode.sportsGame.homeScore ?? 0
    const as_ = championNode.sportsGame.awayScore ?? 0
    champion = hs > as_
      ? championNode.homeTeamName
      : championNode.awayTeamName
  }

  if (isFullMode) {
    assertions.push({
      name: "Champion crowned after full tournament simulation",
      pass: champion !== null,
      detail: champion
        ? `Champion: ${champion}`
        : "No champion determined — championship node may not have both teams or final score",
    })
  }

  const advancedNodes = await (prisma as any).bracketNode.findMany({
    where: {
      tournamentId,
      round: { gte: 2 },
      OR: [
        { homeTeamName: { not: null } },
        { awayTeamName: { not: null } },
      ],
    },
    select: { round: true, homeTeamName: true, awayTeamName: true },
  })

  const advancedByRound: Record<string, number> = {}
  for (const n of advancedNodes) {
    const key = ROUND_NAMES[n.round] ?? `Round ${n.round}`
    const filled = (n.homeTeamName ? 1 : 0) + (n.awayTeamName ? 1 : 0)
    advancedByRound[key] = (advancedByRound[key] ?? 0) + filled
  }

  assertions.push({
    name: "Advancement fills later rounds",
    pass: Object.keys(advancedByRound).length > 0,
    detail: JSON.stringify(advancedByRound),
  })

  const idempotencyBefore = await (prisma as any).bracketPick.aggregate({
    where: { node: { tournamentId }, isCorrect: { not: null } },
    _sum: { points: true },
    _count: true,
  })

  await scoreAndAdvanceFinals(tournamentId)

  const idempotencyAfter = await (prisma as any).bracketPick.aggregate({
    where: { node: { tournamentId }, isCorrect: { not: null } },
    _sum: { points: true },
    _count: true,
  })

  assertions.push({
    name: "Scoring is idempotent (re-run produces identical totals)",
    pass:
      idempotencyBefore._sum.points === idempotencyAfter._sum.points &&
      idempotencyBefore._count === idempotencyAfter._count,
    detail: `Before: ${idempotencyBefore._sum.points ?? 0} pts / ${idempotencyBefore._count} scored → After: ${idempotencyAfter._sum.points ?? 0} pts / ${idempotencyAfter._count} scored`,
  })

  return { assertions, leaderboard, champion }
}

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not allowed in production" }, { status: 403 })
  }
  if (!requireDevSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const season = body.season ?? new Date().getUTCFullYear()
  const mode = body.mode ?? "single"
  const roundToSimulate = body.round ?? 1

  const tournament = await (prisma as any).bracketTournament.findUnique({
    where: { sport_season: { sport: "ncaam", season } },
    select: { id: true, name: true },
  })

  if (!tournament) {
    return NextResponse.json(
      { error: "Tournament not found. Seed it first via admin init." },
      { status: 404 }
    )
  }

  if (mode === "full") {
    const roundResults: RoundResult[] = []
    const skippedRounds: number[] = []

    for (let r = 1; r <= 6; r++) {
      const result = await simulateRound(tournament.id, r, season)
      if (result) {
        roundResults.push(result)
      } else {
        skippedRounds.push(r)
      }
    }

    const dbCheck = await runDbAssertions(tournament.id, true)
    const allPass = dbCheck.assertions.every((a) => a.pass)

    return NextResponse.json({
      ok: true,
      mode: "full",
      tournament: tournament.name,
      rounds: roundResults,
      skippedRounds: skippedRounds.length > 0
        ? skippedRounds.map((r) => `${ROUND_NAMES[r] ?? `Round ${r}`} — no nodes with both teams`)
        : [],
      totalGamesSimulated: roundResults.reduce((s, r) => s + r.gamesSimulated, 0),
      champion: dbCheck.champion,
      leaderboard: dbCheck.leaderboard,
      dbAssertions: dbCheck.assertions,
      allAssertionsPass: allPass,
      verdict: allPass
        ? "ALL CHECKS PASSED — bracket system is working correctly."
        : "SOME CHECKS FAILED — review dbAssertions for details.",
    })
  }

  const result = await simulateRound(tournament.id, roundToSimulate, season)

  if (!result) {
    return NextResponse.json(
      { error: `No nodes with teams assigned for round ${roundToSimulate}. Make sure bracket is seeded.` },
      { status: 404 }
    )
  }

  const dbCheck = await runDbAssertions(tournament.id, false)

  return NextResponse.json({
    ok: true,
    mode: "single",
    tournament: tournament.name,
    ...result,
    leaderboard: dbCheck.leaderboard,
    dbAssertions: dbCheck.assertions,
    allAssertionsPass: dbCheck.assertions.every((a) => a.pass),
    nextStep: "Refresh your bracket page to see updated scores, picks scored, and winners advanced.",
  })
}
