import { prisma } from "@/lib/prisma"

export type LeaderboardRowInput = {
  tournamentId: string
  leagueId: string | null
  entryId: string
  score: number
}

type LeaderboardRowRanked = LeaderboardRowInput & {
  rank: number
  tieGroup: number
  previousRank: number | null
}

export function assignRanks(
  rows: LeaderboardRowInput[],
  previousByEntry: Map<string, number> = new Map(),
): LeaderboardRowRanked[] {
  const sorted = [...rows].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.entryId.localeCompare(b.entryId)
  })

  let currentRank = 0
  let currentTie = 0
  let lastScore: number | null = null

  return sorted.map((row, idx) => {
    if (idx === 0) {
      currentRank = 1
      currentTie = 1
      lastScore = row.score
    } else if (row.score !== lastScore) {
      currentRank = idx + 1
      currentTie += 1
      lastScore = row.score
    }
    const key = `${row.tournamentId}:${row.leagueId ?? "global"}:${row.entryId}`
    const previousRank = previousByEntry.get(key) ?? null
    return {
      ...row,
      rank: currentRank,
      tieGroup: currentTie,
      previousRank,
    }
  })
}

export async function rebuildLeaderboardForScope(args: {
  tournamentId: string
  leagueId?: string | null
}) {
  const { tournamentId } = args
  const leagueId = args.leagueId ?? null

  const whereEntry: any = {
    league: { tournamentId },
    status: { notIn: ["DRAFT", "INVALIDATED"] },
  }
  if (leagueId) {
    whereEntry.leagueId = leagueId
  }

  const entries = await prisma.bracketEntry.findMany({
    where: whereEntry,
    select: {
      id: true,
      leagueId: true,
      picks: { select: { points: true } },
    },
  })

  if (!entries.length) {
    return { updated: 0 }
  }

  const scores: LeaderboardRowInput[] = entries.map((e) => ({
    tournamentId,
    leagueId: leagueId ?? e.leagueId,
    entryId: e.id,
    score: e.picks.reduce((sum, p) => sum + (p.points ?? 0), 0),
  }))

  const existing = await prisma.bracketLeaderboard.findMany({
    where: {
      tournamentId,
      leagueId,
    },
    select: { entryId: true, rank: true, score: true },
  })
  const previousByEntry = new Map<string, number>()
  for (const row of existing) {
    const key = `${tournamentId}:${leagueId ?? "global"}:${row.entryId}`
    previousByEntry.set(key, row.rank)
  }

  const ranked = assignRanks(scores, previousByEntry)

  const ops = ranked.map((row) =>
    prisma.bracketLeaderboard.upsert({
      where: {
        tournamentId_leagueId_entryId: {
          tournamentId: row.tournamentId,
          // leagueId can be null for global scope; cast to satisfy TS while
          // preserving the underlying Prisma type from the schema.
          leagueId: row.leagueId as any,
          entryId: row.entryId,
        },
      },
      update: {
        score: row.score,
        rank: row.rank,
        previousRank: row.previousRank,
        tieGroup: row.tieGroup,
      },
      create: {
        tournamentId: row.tournamentId,
        leagueId: row.leagueId as any,
        entryId: row.entryId,
        score: row.score,
        rank: row.rank,
        previousRank: row.previousRank,
        tieGroup: row.tieGroup,
      },
    }),
  )

  await prisma.$transaction(ops)
  // A rank-only rebuild can move a user, so compare both values from the last stored
  // leaderboard row. First-time rows establish a baseline and never trigger an alert.
  if (leagueId) {
    try {
      const beforeByEntry = new Map(existing.map((row) => [row.entryId, row]))
      const changed = ranked.filter((row) => {
        const before = beforeByEntry.get(row.entryId)
        return before && (before.score !== row.score || before.rank !== row.rank)
      })
      if (changed.length) {
        const owners = await prisma.bracketEntry.findMany({
          where: { id: { in: changed.map((row) => row.entryId) } },
          select: { id: true, userId: true, name: true, league: { select: { name: true, tournament: { select: { sport: true } } } } },
        })
        const ownerByEntry = new Map(owners.map((row) => [row.id, row]))
        const { emitBracketChangeAlert, settleBracketAlertBatch } = await import('@/lib/chimmy/bracketChangeAlerts')
        const failed = await settleBracketAlertBatch(changed, (row) => {
          const owner = ownerByEntry.get(row.entryId)
          const before = beforeByEntry.get(row.entryId)
          if (!owner || !before) return Promise.resolve(false)
          return emitBracketChangeAlert({ userId: owner.userId, entryId: row.entryId,
            entryName: owner.name, poolName: owner.league.name, format: 'tournament', sport: owner.league.tournament.sport,
            before: { score: before.score, rank: before.rank }, after: { score: row.score, rank: row.rank } })
        })
        if (failed) console.warn('[bracket leaderboard] change alerts failed', { failed })
      }
    } catch (error) {
      console.warn('[bracket leaderboard] change alerts unavailable', error)
    }
  }
  return { updated: ranked.length }
}

