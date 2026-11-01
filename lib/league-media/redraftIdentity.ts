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
 * IMPORTED LEAGUES (owner decision, 2026-10-31, batch B-ID): an imported redraft league gets the same
 * identity — but only when what the import STORED positively says redraft. `isImportedRedraftLeague`
 * below holds the per-platform rule; see its note for why the `leagueType` column alone is never
 * enough for an import.
 *
 * ⚠ AN UNKNOWN SPORT IS NOT NFL. `normalizeToSupportedSport` falls back to the default sport for
 * anything it does not recognise; a theme must not, so a sport that only reached NFL through that
 * fallback gets no theme and the league keeps the default look.
 */
import type { LeagueFormatId } from '@/lib/league/format-engine'
import { isRedraftFormatLeague } from '@/lib/league/is-nfl-redraft-core-dashboard'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { readConfirmedLeagueConcept } from '@/lib/league/leagueConceptOptions'
import { IMPORT_PROVIDERS } from '@/lib/league-import/types'
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
  /**
   * `League.settings`, for an imported league only — the per-platform evidence lives here
   * (`isImportedRedraftLeague`). A native league's answer never reads it.
   */
  settings?: unknown
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

function settingsRecord(settings: unknown): Record<string, unknown> | null {
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : null
}

/**
 * What each importer stores that POSITIVELY says "this league is redraft", or null when the platform's
 * import stores nothing that can. Read off `League.settings`, which every importer rebuilds from its
 * mapper output on import and on every scheduled refresh (`buildImportedLeagueSettings`).
 *
 * 🛑 THE `leagueType` COLUMN IS NOT EVIDENCE FOR AN IMPORT. It is `@default("redraft")`, and the import
 * normalizer writes `redraft` as its shrug whenever nothing told it otherwise (`conceptConfident:
 * false` in lib/league-import/canonicalImportNormalizer.ts — a guillotine league named "Elimination
 * Station 2" landed there in production). `isDynasty: false` is not evidence either: every adapter
 * derives it from the ABSENCE of keeper signals. So the column is a necessary condition here (a name
 * signal that set it to guillotine still vetoes), never a sufficient one.
 *
 * - sleeper — `sleeper_league_type === 0`: Sleeper's own `settings.type` (0 redraft, 1 keeper,
 *   2 dynasty), stored raw by SleeperLeagueMapper. Absent on rows imported before it was stored →
 *   no theme until the next refresh writes it. Best ball (`best_ball`) still vetoes.
 * - espn — `espn_keeper_count === 0`: ESPN's own keeper count, stored raw by EspnAdapter only when ESPN
 *   sent a number. ESPN has no dynasty setting; its "dynasty" IS keepers, so zero keepers is redraft.
 * - yahoo, mfl, fantrax, fleaflicker — no positive signal. Their adapters only test for keeper /
 *   dynasty keys being PRESENT (Fleaflicker's stored `league_type: 'redraft'` is written whenever
 *   `maxKeepers` is absent, which its contract marks optional). These theme only once a person
 *   confirms the type (below).
 */
const IMPORT_REDRAFT_EVIDENCE: Record<(typeof IMPORT_PROVIDERS)[number], ((s: Record<string, unknown>) => boolean) | null> = {
  sleeper: s => s.sleeper_league_type === 0 && s.best_ball !== true,
  espn: s => s.espn_keeper_count === 0,
  yahoo: null,
  mfl: null,
  fantrax: null,
  fleaflicker: null,
}

/**
 * An imported league (Sleeper, ESPN, Yahoo, MFL, Fantrax, Fleaflicker) whose STORED data positively
 * says plain redraft. Unknown → false, never a guess.
 *
 * 1. A person's confirmation outranks every import (`settings.leagueTypeConfirmation`, the same
 *    precedence lib/league-import/leagueTypeWrite.ts gives it): confirmed `redraft` is evidence on any
 *    platform; confirmed anything else is a veto.
 * 2. Otherwise the platform's own stored signal (`IMPORT_REDRAFT_EVIDENCE`) must say redraft AND the
 *    `leagueType` column must still read `redraft` (a name signal that classified it otherwise wins).
 * 3. Either way, the same vetoes as a native league: a dynasty / best ball / guillotine / keeper flag,
 *    a specialty variant, the dynasty background, or the importer's own `settings.isDynasty`.
 */
export function isImportedRedraftLeague(league: RedraftIdentityLeague): boolean {
  const platform = String(league.platform ?? '').trim().toLowerCase()
  if (!platform || isNativePlatform(platform)) return false
  if (!Object.prototype.hasOwnProperty.call(IMPORT_REDRAFT_EVIDENCE, platform)) return false
  const settings = settingsRecord(league.settings)
  if (!settings) return false
  if (settings.isDynasty === true) return false

  const confirmed = readConfirmedLeagueConcept(settings)
  // The type a person confirmed replaces the column everywhere below (resolveLeagueConcept's rule).
  const effective = { ...league, leagueType: confirmed ?? league.leagueType }
  if (!isRedraftFormatLeague(effective)) return false
  const variant = String(league.leagueVariant ?? '').trim()
  if (variant && Object.prototype.hasOwnProperty.call(NON_REDRAFT_FORMATS, normalizeLeagueTypeKey(variant))) return false
  if (usesDynastyBackground({ ...effective, format: null })) return false

  if (confirmed === 'redraft') return true
  const evidence = IMPORT_REDRAFT_EVIDENCE[platform as keyof typeof IMPORT_REDRAFT_EVIDENCE]
  return evidence ? evidence(settings) : false
}

export type RedraftIdentity = { sport: RedraftSportTheme; sportLabel: string }

/**
 * Null means "keep the default look": not redraft, not positively known to be redraft (an import),
 * or a sport with no theme. A native league's answer is exactly what it was before imports were added.
 */
export function resolveRedraftIdentity(league: RedraftIdentityLeague): RedraftIdentity | null {
  if (!isNativeRedraftLeague(league) && !isImportedRedraftLeague(league)) return null
  const sport = redraftSportTheme(league.sport)
  return sport ? { sport, sportLabel: REDRAFT_SPORT_LABEL[sport] } : null
}
