import { rotateForFairness } from '@/lib/cron/runBudget'

/**
 * Which sports one `?riProfiles=1` fire sweeps.
 *
 * 🛑 WHY NCAAF GETS ITS OWN FIRE, MEASURED 2026-09-26 FROM 16 PRODUCTION `sync_job_runs`.
 * NCAAF alone is 69,043 Rolling Insights players — more than the other six sports together
 * (45,590). Whenever the 24h rotation reached it, it consumed the whole 240s budget and every sport
 * after it was deferred: on the days NCAAF led, it was the ONLY sport swept (e.g. 2026-09-25, six
 * deferred). And because rotation preserves the list's cyclic order, the sports right behind NCAAF —
 * MLB and NBA — were deferred on nearly every run, so MLB's profiles were refreshed only on the one
 * day in seven it led (last write 2026-09-19). Every run still read `success`.
 *
 * The cron list is at its ceiling (60 of 60, `scripts/cron-budget-check.mjs`), so NCAAF cannot have
 * an entry of its own. Instead the ONE entry fires twice a day (`10 3,9 * * *`) and the fire's UTC
 * hour picks the half:
 *   - before 09:00 UTC → NCAAF alone, with the whole budget;
 *   - from 09:00 UTC   → the other six, rotated for fairness among themselves.
 * The six mostly fit one budget — the 2026-09-19 run swept all six; 2026-09-20 swept five and
 * deferred MLB — and rotation among six moves a deferred sport toward the front the next day. So
 * each sport is refreshed daily or every other day, instead of every 4-7 days behind NCAAF.
 *
 * ⚠ A WINDOW, NOT AN EXACT HOUR. GitHub's scheduler can start a fire late; a 03:10 fire that runs
 * at 04:30 must still be the NCAAF half, and a delayed 09:10 fire is still after 09:00.
 *
 * An explicit `?sport=` (an operator re-running one sport) always wins.
 */
export const RI_PROFILES_SPLIT_SPORT = 'NCAAF'
/** Fires starting before this UTC hour are the NCAAF half. Must sit between the two schedule hours. */
export const RI_PROFILES_SPLIT_BEFORE_UTC_HOUR = 9

export function selectRiProfileSports<S extends string>(input: {
  allSports: readonly S[]
  explicitSport?: string | null
  now?: Date
  rotationPeriodMs?: number
}): S[] {
  const { allSports } = input
  const explicit = input.explicitSport?.trim().toUpperCase()
  if (explicit && (allSports as readonly string[]).includes(explicit)) return [explicit as S]

  const now = input.now ?? new Date()
  const split = allSports.find((s) => s === RI_PROFILES_SPLIT_SPORT)
  if (!split) return rotateForFairness(allSports, input.rotationPeriodMs, () => now.getTime())

  if (now.getUTCHours() < RI_PROFILES_SPLIT_BEFORE_UTC_HOUR) return [split]
  return rotateForFairness(
    allSports.filter((s) => s !== split),
    input.rotationPeriodMs ?? 24 * 60 * 60 * 1000,
    () => now.getTime(),
  )
}
