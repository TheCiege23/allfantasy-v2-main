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
 * True when every real matchup for the week is complete.
 *
 * ⚠ A BYE IS NOT AN UNFINISHED MATCHUP. An odd-sized league gets one row a week with no away
 * roster, and that row is never scored — so requiring `awayRosterId` on EVERY row meant an odd
 * league's week could never be complete and its zombie week never resolved. Byes are skipped; at
 * least one real matchup must exist.
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
  const real = mm.filter((m) => m.awayRosterId != null)
  if (real.length === 0) return false

  return real.every((m) => isMatchupStatusComplete(m.status))
}
