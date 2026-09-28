/**
 * Which leagues run the standard weekly season — a head-to-head schedule, weeks closed by the
 * finalizer and advanced by the roller, then a playoff bracket and a champion.
 *
 * 🛑 THE SCHEDULE AND PLAYOFF RUNTIMES ACCEPTED ONLY `sport === 'NFL' && format === 'redraft'`.
 * Every NFL keeper, dynasty and best-ball league — each of which gets a `RedraftSeason` with a
 * weekly schedule at draft completion — was refused every hourly roll (`FORMAT_NOT_SUPPORTED`) and
 * sat on week 1 forever: no standings past week 1, no bracket, no champion, no offseason, so no
 * keeper window either. NHL and NCAAB, whose weeks the finalizer can close (#1195, #1203), never
 * advanced for the same reason.
 *
 * Formats with an engine of their own stay out: guillotine, survivor, zombie, big brother and
 * tournament schedule and eliminate by their own rules, and letting the round-robin runtime
 * advance them would fight that engine.
 */
import { canRunSeasonForSport } from '@/lib/sport-scope'

export const STANDARD_WEEKLY_SEASON_FORMATS: ReadonlySet<string> = new Set([
  'redraft',
  'keeper',
  'dynasty',
  'best_ball',
  'bestball',
  'idp',
  'devy',
  'c2c',
  'salary_cap',
  'salarycap',
])

/** `RedraftSeason.sport` stores config keys (`NCAAFB`); the sport scope speaks `LeagueSport`. */
export function seasonSportToLeagueSport(sport: string | null | undefined): string {
  const u = String(sport ?? '').trim().toUpperCase()
  if (u === 'NCAAFB') return 'NCAAF'
  if (u === 'NCAABB') return 'NCAAB'
  return u
}

export function runsStandardWeeklySeason(sport: string | null | undefined, format: string | null | undefined): boolean {
  const f = String(format ?? 'redraft').trim().toLowerCase() || 'redraft'
  return canRunSeasonForSport(seasonSportToLeagueSport(sport)) && STANDARD_WEEKLY_SEASON_FORMATS.has(f)
}
