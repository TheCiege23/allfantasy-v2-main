import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { isZombieLeagueLike } from '@/lib/zombie/isZombieLeagueLike'

/**
 * What the Zombie tab says for a league played as Zombie on another platform.
 *
 * 🛑 THE TAB OPENED ON A RED "Not a zombie league". The league page gives any league typed zombie a
 * Zombie tab and lands on it (`isZombieLeagueLike`), but the outbreak board is built from AllFantasy's
 * own zombie records, and an imported league has none: no provider has a zombie format, so the
 * commissioner tracks the Whisperer and the infections by hand. Measured read-only on production
 * 2026-11-20: both imports of "Beta 1 Zombie League" (Sleeper, 20 teams, in season) are typed zombie
 * with no zombie config, teams or infections on file, so the summary answered 404 and the first thing
 * a manager saw was an error with a Retry button that could never succeed.
 *
 * Null for a league AllFantasy hosts, and for a league that is not typed zombie at all (that 404 is
 * correct).
 */
export function importedZombieNote(league: { platform?: string | null; leagueType?: string | null; leagueVariant?: string | null } | null | undefined): string | null {
  if (!league || isNativePlatform(league.platform) || !isZombieLeagueLike(league)) return null
  const p = String(league.platform ?? '').trim().toLowerCase()
  const label = ({ sleeper: 'Sleeper', espn: 'ESPN', yahoo: 'Yahoo', mfl: 'MyFantasyLeague', fleaflicker: 'Fleaflicker', fantrax: 'Fantrax' } as Record<string, string>)[p] ?? 'another platform'
  return `This league is played as Zombie on ${label}, where the commissioner tracks the Whisperer and the infections by hand. AllFantasy has its scores, rosters and standings, but not who is a zombie or a survivor, so there is no outbreak board to show here.`
}
