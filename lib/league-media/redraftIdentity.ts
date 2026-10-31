/**
 * Redraft visual identity ("the season race"): which native leagues get it, and which sport theme.
 *
 * The workspace root stamps the answer as `data-format="redraft"` + `data-sport="<theme>"`, and
 * components/league/native/redraft-identity.css re-points /core's tokens under those attributes —
 * the same mechanism Dynasty uses (`usesDynastyBackground` → `data-dynasty-background`) and
 * Guillotine uses (`data-format=guillotine`). Token table and rules: docs/design/redraft-identity.md.
 *
 * ⚠ NO NEW CLASSIFICATION. "Is this a redraft league" is `isRedraftFormatLeague`, the format half of
 * the gate the redraft shell already uses (lib/league/is-nfl-redraft-core-dashboard.ts). This file
 * only adds the two things a visual needs on top of it:
 *   - native only: an imported league keeps its provider's presentation (`isNativePlatform`);
 *   - a variant that names another registered format (dynasty, keeper, best_ball, guillotine,
 *     survivor, tournament, devy, c2c, zombie, salary_cap, big_brother) is never themed as redraft,
 *     even when `leagueType` still says `redraft` — the list is keyed on `LeagueFormatId`, so adding
 *     a format to lib/league/format-engine.ts fails the typecheck here until it is placed.
 *
 * ⚠ AN UNKNOWN SPORT IS NOT NFL. `normalizeToSupportedSport` falls back to the default sport for
 * anything it does not recognise; a theme must not, so a sport that only reached NFL through that
 * fallback gets no theme and the league keeps the default look.
 */
import type { LeagueFormatId } from '@/lib/league/format-engine'
import { isRedraftFormatLeague } from '@/lib/league/is-nfl-redraft-core-dashboard'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { usesDynastyBackground } from './dynastyBackground'
import { normalizeLeagueTypeKey } from './leagueTypeMedia'

/** Every sport the native redraft engine has an adapter for (lib/redraft/sportAdapters/). */
export const REDRAFT_SPORT_THEMES = ['nfl', 'nba', 'nhl', 'mlb', 'ncaaf', 'ncaab', 'soccer'] as const
export type RedraftSportTheme = (typeof REDRAFT_SPORT_THEMES)[number]

/** Display name for the header's sport chip. */
export const REDRAFT_SPORT_LABEL: Record<RedraftSportTheme, string> = {
  nfl: 'NFL',
  nba: 'NBA',
  nhl: 'NHL',
  mlb: 'MLB',
  ncaaf: 'College football',
  ncaab: 'College basketball',
  soccer: 'Soccer',
}

/** A Record, not an array, so a new `LeagueFormatId` cannot be forgotten here. */
const NON_REDRAFT_FORMATS: Record<Exclude<LeagueFormatId, 'redraft'>, true> = {
  dynasty: true,
  keeper: true,
  best_ball: true,
  guillotine: true,
  survivor: true,
  tournament: true,
  devy: true,
  c2c: true,
  zombie: true,
  salary_cap: true,
  big_brother: true,
}

export type RedraftIdentityLeague = {
  platform?: string | null
  sport?: string | null
  leagueType?: string | null
  leagueVariant?: string | null
  isDynasty?: boolean | null
  bestBallMode?: boolean | null
  guillotineMode?: boolean | null
  keeperPhaseActive?: boolean | null
}

/** The theme for a sport string, or null when the sport is not one the redraft engine runs. */
export function redraftSportTheme(sport: string | null | undefined): RedraftSportTheme | null {
  const raw = String(sport ?? '').trim()
  if (!raw) return null
  const normalized = normalizeToSupportedSport(raw)
  // The normalizer's fallback is the default sport; only a sport that really is NFL may theme as NFL.
  if (normalized === 'NFL' && raw.toUpperCase() !== 'NFL') return null
  const theme = normalized.toLowerCase() as RedraftSportTheme
  return (REDRAFT_SPORT_THEMES as readonly string[]).includes(theme) ? theme : null
}

/** A league hosted on AllFantasy whose format is plain redraft. */
export function isNativeRedraftLeague(league: RedraftIdentityLeague): boolean {
  if (!isNativePlatform(league.platform)) return false
  if (!isRedraftFormatLeague(league)) return false
  const variant = String(league.leagueVariant ?? '').trim()
  if (variant && Object.prototype.hasOwnProperty.call(NON_REDRAFT_FORMATS, normalizeLeagueTypeKey(variant))) return false
  if (usesDynastyBackground({ ...league, format: null })) return false
  return true
}

export type RedraftIdentity = { sport: RedraftSportTheme; sportLabel: string }

/** Null means "keep the default look": not native, not redraft, or a sport with no theme. */
export function resolveRedraftIdentity(league: RedraftIdentityLeague): RedraftIdentity | null {
  if (!isNativeRedraftLeague(league)) return null
  const sport = redraftSportTheme(league.sport)
  return sport ? { sport, sportLabel: REDRAFT_SPORT_LABEL[sport] } : null
}
