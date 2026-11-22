/**
 * Zombie collusion flag service: deterministic event flags (PROMPT 353). AI summary is optional/hybrid.
 */

interface CollusionFlag {
  leagueId: string
  rosterIdA: string
  rosterIdB: string
  flagType: string
  metadata?: Record<string, unknown>
}

/**
 * Detect simple deterministic flags (e.g. lopsided trades when trade data is available). Does not decide outcome.
 * Trade data may come from league-specific sources; this stub returns [] until integrated with trade pipeline.
 */
export async function evaluateCollusionFlags(leagueId: string): Promise<CollusionFlag[]> {
  const flags: CollusionFlag[] = []
  // Optional: integrate with trade pipeline when leagueId-scoped trade history exists
  return flags
}

