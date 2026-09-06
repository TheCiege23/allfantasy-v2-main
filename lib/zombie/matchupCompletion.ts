import { prisma } from '@/lib/prisma'

/**
 * `RedraftMatchup.status` transitions to `'final'` when scored
 * (`lib/redraft/scoringEngine.ts`, `resolveNflRedraftLiveScoringRuntime.ts`) —
 * no writer in the codebase ever sets the literal string `'complete'`. This
 * used to check `m.status === 'complete'` exactly, so it returned `false` for
 * every real week regardless of how long a season ran, and zombie's weekly
 * resolution (infections/serums/bashings/etc. — `weeklyResolutionEngine.ts`)
 * never fired non-force despite the cron that gates on this (`/api/redraft/score-sync`,
 * every 5 min) actually running. Same normalization
 * `server/services/matchupSources/redraftMatchupSource.ts` already uses.
 */
function isMatchupStatusComplete(status: string | null | undefined): boolean {
  const s = String(status ?? '').toLowerCase()
  return s === 'final' || s === 'complete' || s === 'completed'
}

/**
 * True when every regular matchup for the week is complete and has two rosters.
 */
export async function checkAllMatchupsComplete(
  fantasyLeagueId: string,
  week: number,
  seasonYear: number,
): Promise<boolean> {
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId: fantasyLeagueId, season: seasonYear },
  })
  if (!season) return false

  const mm = await prisma.redraftMatchup.findMany({
    where: { seasonId: season.id, week },
  })
  if (mm.length === 0) return false

  return mm.every((m) => m.awayRosterId != null && isMatchupStatusComplete(m.status))
}
