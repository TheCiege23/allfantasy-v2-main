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

/**
 * The last week the season actually scheduled a head-to-head matchup in, or null when none.
 *
 * 🛑 THIS, NOT `RedraftSeason.totalWeeks`, IS WHERE A ZOMBIE SEASON ENDS. The schedule is built only
 * up to `playoffStartWeek - 1` (`finalizeDraftToRedraftSeason.ts`), so `totalWeeks` runs past it —
 * NBA defaults to 22 weeks with playoffs from week 20, NFL to 18 with playoffs from 15. A zombie league
 * carrying `totalWeeks` reached the first playoff week, found no matchups, and waited there forever:
 * no winner, `status` never `complete`.
 */
export async function getLastScheduledWeek(seasonId: string): Promise<number | null> {
  const last = await prisma.redraftMatchup.findFirst({
    where: { seasonId, awayRosterId: { not: null } },
    orderBy: { week: 'desc' },
    select: { week: true },
  })
  return last?.week ?? null
}

/**
 * The first week the season scheduled a head-to-head matchup in, or null when none. A season drafted
 * mid-season starts its schedule at the sport's current week (see `resolveStartWeekForFreshSeason`), so
 * a zombie league activated on it must start THERE, not at week 1, which has no matchups.
 */
export async function getFirstScheduledWeek(seasonId: string): Promise<number | null> {
  const first = await prisma.redraftMatchup.findFirst({
    where: { seasonId, awayRosterId: { not: null } },
    orderBy: { week: 'asc' },
    select: { week: true },
  })
  return first?.week ?? null
}

export type ZombieWeekReadiness =
  | { ready: true }
  | {
      ready: false
      reason: 'NO_SEASON' | 'NO_SCHEDULED_MATCHUPS' | 'MATCHUPS_NOT_FINAL'
      /** Real matchups this week that are not final yet (MATCHUPS_NOT_FINAL only). */
      pending?: number
      /** The season's last scheduled week (NO_SCHEDULED_MATCHUPS only) — past it, the season is over. */
      lastScheduledWeek?: number | null
    }

/**
 * `checkAllMatchupsComplete` with the reason it said no. The scheduled resolver used to skip a
 * not-ready league with a bare `return` — no counter, no log — so a week the NBA finalizer refused to
 * seal looked exactly like a healthy mid-week league, every five minutes, indefinitely.
 */
export async function getZombieWeekReadiness(
  fantasyLeagueId: string,
  week: number,
  seasonYear: number,
): Promise<ZombieWeekReadiness> {
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId: fantasyLeagueId, season: seasonYear },
  })
  if (!season) return { ready: false, reason: 'NO_SEASON' }

  const mm = await prisma.redraftMatchup.findMany({
    where: { seasonId: season.id, week },
  })
  const real = mm.filter((m) => m.awayRosterId != null)
  if (real.length === 0) {
    return { ready: false, reason: 'NO_SCHEDULED_MATCHUPS', lastScheduledWeek: await getLastScheduledWeek(season.id) }
  }

  const pending = real.filter((m) => !isMatchupStatusComplete(m.status)).length
  return pending === 0 ? { ready: true } : { ready: false, reason: 'MATCHUPS_NOT_FINAL', pending }
}
