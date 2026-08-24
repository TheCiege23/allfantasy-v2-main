/**
 * Canonical scoring stat-key resolver.
 * Handles legacy/unprefixed IDP keys so league overrides still map to current templates.
 */

const IDP_UNAMBIGUOUS_ALIASES: Record<string, string> = {
  solo_tackle: 'idp_solo_tackle',
  assist_tackle: 'idp_assist_tackle',
  tackle_for_loss: 'idp_tackle_for_loss',
  qb_hit: 'idp_qb_hit',
  pass_defended: 'idp_pass_defended',
  forced_fumble: 'idp_forced_fumble',
  fumble_recovery: 'idp_fumble_recovery',
  defensive_touchdown: 'idp_defensive_touchdown',
}

const IDP_CONTEXTUAL_ALIASES: Record<string, string> = {
  sack: 'idp_sack',
  interception: 'idp_interception',
  safety: 'idp_safety',
}

export function normalizeScoringStatKey(
  statKey: string,
  options?: {
    sportType?: string | null
    templateRuleKeys?: Iterable<string>
  }
): string {
  const raw = String(statKey ?? '').trim()
  if (!raw) return ''

  const lower = raw.toLowerCase()
  const templateKeys = options?.templateRuleKeys
    ? new Set(Array.from(options.templateRuleKeys, (k) => String(k)))
    : null

  const unambiguous = IDP_UNAMBIGUOUS_ALIASES[lower]
  if (unambiguous) {
    if (!templateKeys || templateKeys.has(unambiguous)) {
      return unambiguous
    }
    if (templateKeys.has(lower)) return lower
  }

  const contextual = IDP_CONTEXTUAL_ALIASES[lower]
  if (contextual) {
    const sportUpper = String(options?.sportType ?? '').toUpperCase()
    const isNflContext = sportUpper === 'NFL' || sportUpper.length === 0
    if (isNflContext && templateKeys && templateKeys.has(contextual) && !templateKeys.has(lower)) {
      return contextual
    }
  }

  return lower
}

/**
 * Provider-namespaced scoring keys captured at import — `espn_stat_<id>` /
 * `yahoo_stat_<id>` (see EspnAdapter / YahooAdapter) — resolved to the Sleeper
 * projection stat keys `computeLeagueProjectedPoints` consumes.
 *
 * HONESTY CONTRACT: only verifiable mappings appear here. ESPN ships no
 * stat-id dictionary in this repo; the single id the capture code itself
 * verifies is 53 = receptions (`espn-client` detectScoringType and
 * EspnAdapter detectEspnScoringFormat both key PPR detection on it). Yahoo
 * ids are league-scoped and unverifiable statically — but the import captures
 * each league's OWN stat names (`stat_categories`), so Yahoo keys resolve
 * through those captured names instead. Anything unresolved returns null and
 * the caller must keep the provider key (surfaced as uncovered), never guess.
 */
const ESPN_STAT_ID_TO_SLEEPER_KEY: Record<string, string> = {
  '53': 'rec',
}

/**
 * Yahoo stat NAMES (normalized: lowercased, non-alphanumerics collapsed to
 * single spaces) → Sleeper projection keys. Core NFL offensive keys only;
 * both Yahoo's long `name` ("Passing Yards") and short `display_name`
 * ("Pass Yds") forms are listed. Interceptions are handled separately below
 * because the same name means thrown (offense) or made (defense).
 */
const YAHOO_STAT_NAME_TO_SLEEPER_KEY: Record<string, string> = {
  'passing yards': 'pass_yd',
  'pass yds': 'pass_yd',
  'pass yd': 'pass_yd',
  'passing touchdowns': 'pass_td',
  'pass td': 'pass_td',
  'rushing yards': 'rush_yd',
  'rush yds': 'rush_yd',
  'rush yd': 'rush_yd',
  'rushing touchdowns': 'rush_td',
  'rush td': 'rush_td',
  receptions: 'rec',
  rec: 'rec',
  'receiving yards': 'rec_yd',
  'rec yds': 'rec_yd',
  'rec yd': 'rec_yd',
  'receiving touchdowns': 'rec_td',
  'rec td': 'rec_td',
  'fumbles lost': 'fum_lost',
  'fum lost': 'fum_lost',
}

const YAHOO_OFFENSE_INTERCEPTION_NAMES = new Set(['interceptions', 'interceptions thrown', 'int'])

/** Lowercase, collapse every non-alphanumeric run to one space, trim. */
export function normalizeProviderStatName(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** One captured Yahoo stat category (from the league's persisted `yahoo_settings.stat_categories`). */
export interface YahooCapturedStatCategory {
  name?: string | null
  displayName?: string | null
  positionType?: string | null
}

/**
 * Resolve one provider-namespaced scoring key to a Sleeper projection key, or
 * null when it cannot be verified. Keys without a provider prefix return null
 * (they are already canonical or belong to another resolver).
 */
export function resolveProviderScoringStatKey(
  statKey: string,
  options?: { yahooStatCategoriesById?: ReadonlyMap<string, YahooCapturedStatCategory> }
): string | null {
  const key = String(statKey ?? '').trim().toLowerCase()

  if (key.startsWith('espn_stat_')) {
    return ESPN_STAT_ID_TO_SLEEPER_KEY[key.slice('espn_stat_'.length)] ?? null
  }

  if (key.startsWith('yahoo_stat_')) {
    const category = options?.yahooStatCategoriesById?.get(key.slice('yahoo_stat_'.length))
    if (!category) return null
    const candidates = [category.name, category.displayName]
      .map((n) => normalizeProviderStatName(String(n ?? '')))
      .filter(Boolean)
    for (const candidate of candidates) {
      const mapped = YAHOO_STAT_NAME_TO_SLEEPER_KEY[candidate]
      if (mapped) return mapped
      // "Interceptions" is two different stats: thrown (offense) vs made
      // (defense). Map it ONLY when the captured category says offense.
      if (
        YAHOO_OFFENSE_INTERCEPTION_NAMES.has(candidate) &&
        String(category.positionType ?? '').trim().toUpperCase() === 'O'
      ) {
        return 'pass_int'
      }
    }
    return null
  }

  return null
}

