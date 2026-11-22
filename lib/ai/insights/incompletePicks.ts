/**
 * Incomplete Picks Calculator
 *
 * Identifies entries that have not filled out their bracket/picks fully.
 * Useful for commissioner alerts before the pick lock deadline.
 *
 * "completionPercent" = picks submitted / expectedPicksPerEntry × 100
 * "hasCompletionProblem" = more than 20% of entries are incomplete
 */
import type { InsightPool } from "./types"

type IncompleteEntry = {
  entryId: string
  displayName: string
  totalPicksSubmitted: number
  expectedPicks: number
  missingPickCount: number
  /** Rounds for which no picks were submitted. */
  missingRounds: string[]
  completionPercent: number
}

type IncompletePicksResult = {
  incompleteEntries: IncompleteEntry[]
  completeEntries: number
  totalEntries: number
  completionRate: number
  /** True when < 80% of entries are complete — commissioner action needed. */
  hasCompletionProblem: boolean
  /** Most at-risk: entries with 0 picks for any round. */
  zeroPickRounds: IncompleteEntry[]
}

export function computeIncompletePicks(
  pool: InsightPool,
  expectedPicksPerEntry: number,
): IncompletePicksResult {
  const allRounds = [...new Set(pool.matches.map((m) => m.round))]

  const incompleteEntries: IncompleteEntry[] = pool.entries
    .flatMap((entry): IncompleteEntry[] => {
      const picksGiven = entry.picks.length
      if (picksGiven >= expectedPicksPerEntry) return []

      const roundsCovered = new Set(entry.picks.map((p) => p.round))
      const missingRounds = allRounds.filter((r) => !roundsCovered.has(r))
      const completionPct = Math.round((picksGiven / Math.max(1, expectedPicksPerEntry)) * 100)

      return [
        {
          entryId: entry.entryId,
          displayName: entry.displayName,
          totalPicksSubmitted: picksGiven,
          expectedPicks: expectedPicksPerEntry,
          missingPickCount: expectedPicksPerEntry - picksGiven,
          missingRounds,
          completionPercent: completionPct,
        },
      ]
    })
    .sort((a, b) => a.completionPercent - b.completionPercent)

  const completeEntries = pool.entries.length - incompleteEntries.length
  const completionRate = Math.round(
    (completeEntries / Math.max(1, pool.entries.length)) * 100,
  )

  return {
    incompleteEntries,
    completeEntries,
    totalEntries: pool.entries.length,
    completionRate,
    hasCompletionProblem: completionRate < 80,
    zeroPickRounds: incompleteEntries.filter((e) => e.missingRounds.length > 0),
  }
}
