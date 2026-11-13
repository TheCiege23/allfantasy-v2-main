/**
 * Rooting Guide Calculator
 *
 * For a specific entry, answer: "Who do you need to win each upcoming match?"
 *
 * For every pending match the entry has a pick on:
 *   - rootFor = the team they picked (obvious, but surfaced clearly)
 *   - threatsAbove = how many higher-ranked entries picked the opposite team
 *   - maxRankGain = if my team wins AND all threats above lose, how many ranks do I gain?
 *   - urgency = how important is this match for this entry?
 *
 * The topNeed is the single most impactful upcoming match for this entry.
 */
import type { InsightPool } from "./types"

type RootingNeed = {
  matchId: string
  matchDescription: string
  round: string
  /** The team this entry needs to win. */
  rootFor: string
  /** The opposing team this entry needs to lose. */
  against: string
  pointsAtStake: number
  /** Higher-ranked entries that picked the opposite team — they're threats. */
  threatsAbove: number
  /** If rootFor wins AND all threats above misfire: max potential rank gain. */
  maxRankGain: number
  urgency: "critical" | "high" | "moderate" | "low"
}

type RootingGuideResult = {
  entryId: string
  displayName: string
  currentRank: number
  needs: RootingNeed[]
  /** The single match that matters most for this entry right now. */
  topNeed: RootingNeed | null
  /** Can this entry still reach 1st with a perfect run? */
  canReachFirst: boolean
  /** Entries above them who are vulnerable (have a pending pick on a split match). */
  threatEntriesAbove: number
}

export function computeRootingGuide(
  pool: InsightPool,
  targetEntryId: string,
): RootingGuideResult | null {
  const target = pool.entries.find((e) => e.entryId === targetEntryId)
  if (!target) return null

  const entriesAbove = pool.entries.filter((e) => e.rank < target.rank)
  const pendingMatches = pool.matches.filter((m) => m.status === "scheduled")
  const leader = pool.entries.find((e) => e.rank === 1)

  const needs: RootingNeed[] = pendingMatches
    .flatMap((match): RootingNeed[] => {
      const myPick = target.picks.find((p) => p.matchId === match.matchId)
      if (!myPick) return []

      const opposingTeam =
        myPick.pickedTeam === match.homeTeam ? match.awayTeam : match.homeTeam

      // Entries ranked above me that picked the opposite team (threats)
      const threats = entriesAbove.filter((e) =>
        e.picks.some(
          (p) => p.matchId === match.matchId && p.pickedTeam !== myPick.pickedTeam,
        ),
      )

      const urgency: RootingNeed["urgency"] =
        match.pointsAtStake >= 16
          ? "critical"
          : match.pointsAtStake >= 8
            ? "high"
            : match.pointsAtStake >= 4
              ? "moderate"
              : "low"

      return [
        {
          matchId: match.matchId,
          matchDescription: `${match.homeTeam} vs ${match.awayTeam}`,
          round: match.round,
          rootFor: myPick.pickedTeam,
          against: opposingTeam,
          pointsAtStake: match.pointsAtStake,
          threatsAbove: threats.length,
          maxRankGain: threats.length,
          urgency,
        },
      ]
    })
    // Sort: most points at stake first, then most threats
    .sort((a, b) => b.pointsAtStake - a.pointsAtStake || b.threatsAbove - a.threatsAbove)

  const canReachFirst =
    !!leader && target.maxPossible >= leader.currentScore

  const threatEntriesAbove = entriesAbove.filter((e) =>
    pendingMatches.some((m) =>
      e.picks.some(
        (p) =>
          p.matchId === m.id &&
          target.picks.some(
            (tp) => tp.matchId === m.matchId && tp.pickedTeam !== p.pickedTeam,
          ),
      ),
    ),
  ).length

  return {
    entryId: target.entryId,
    displayName: target.displayName,
    currentRank: target.rank,
    needs,
    topNeed: needs[0] ?? null,
    canReachFirst,
    threatEntriesAbove,
  }
}
