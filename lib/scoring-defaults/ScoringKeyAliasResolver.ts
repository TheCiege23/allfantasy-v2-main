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
 * HONESTY CONTRACT, UNCHANGED IN SPIRIT AND NOW MUCH BETTER SUPPLIED: only verifiable
 * mappings appear here. What changed is that they became verifiable.
 *
 * ESPN still ships no stat dictionary — its `scoringItems` carry `{statId, points}`
 * and nothing that names the stat — so for a long time this table held exactly ONE
 * entry, `53` = receptions, the id the PPR-detection code independently keys on. The
 * rest were left unresolved rather than guessed, correctly: a guessed scoring key
 * silently mis-scores every player in a league, and `sleeperMarketService` records the
 * shape of that failure, where keys that matched nothing fell through to `pts_ppr` and
 * understated defenders ~14x.
 *
 * The entries below were DERIVED FROM EVIDENCE, not recalled. Both ESPN and Sleeper
 * publish the same season for the same players, so where an ESPN stat id and a Sleeper
 * key hold the same value for the same player — across 1,277 player-seasons spanning
 * 2024 and 2025, with NOT ONE player-season where they disagree — that is evidence
 * they name the same quantity. Names that are not unique on both sides are dropped
 * before joining, because the NFL has two Maurice Alexanders and two Tony Adamses and
 * pairing one man's stat line with another's would manufacture a contradiction that
 * disqualifies a true mapping.
 *
 * Reproduce with `node scripts/compare-espn-sleeper-stat-ids.mjs`; the evidence,
 * including per-mapping agreement counts, is committed at
 * `lib/scoring-defaults/espn-stat-id-evidence.json`. Regenerate it in the same change
 * as any edit here, so the mapping and its proof never drift apart.
 *
 * Two checks worth knowing the derivation passed:
 *   - It independently reproduced `53` = receptions, the one mapping that was already
 *     verified by other means. A positive control.
 *   - Pooling two seasons means an id that meant one thing in 2024 and another in 2025
 *     produces contradictions and is rejected automatically. None were.
 *
 * ⚠ STILL DELIBERATELY ABSENT: defensive, IDP and team-defense ids. They did not clear
 * the evidence bar, so they are not here. A league scoring them has those weights
 * DROPPED rather than guessed, which understates kickers and team defenses — stated by
 * `resolveImportedScoring`, never silently. Anything unresolved returns null and the
 * caller must keep the provider key, never guess.
 *
 * Comment shows agreeing player-seasons out of 1,277.
 */
const ESPN_STAT_ID_TO_SLEEPER_KEY: Record<string, string> = {
  '0': 'pass_att',              // 179
  '1': 'pass_cmp',              // 158
  '2': 'pass_inc',              // 161
  '3': 'pass_yd',               // 158
  '4': 'pass_td',               // 121
  '15': 'pass_td_40p',          // 72
  '16': 'pass_td_50p',          // 56
  '17': 'bonus_pass_yd_300',    // 60
  '19': 'pass_2pt',             // 51
  '20': 'pass_int',             // 116
  '23': 'rush_att',             // 607
  '24': 'rush_yd',              // 594
  '25': 'rush_td',              // 246
  '26': 'rush_2pt',             // 28
  '35': 'rush_td_40p',          // 44
  '36': 'rush_td_50p',          // 30
  '37': 'bonus_rush_yd_100',    // 70
  '41': 'rec',                  // 861
  '42': 'rec_yd',               // 861
  '43': 'rec_td',               // 481
  '44': 'rec_2pt',              // 62
  '46': 'rec_td_50p',           // 75
  '53': 'rec',                  // 861
  '56': 'bonus_rec_yd_100',     // 142
  '64': 'pass_sack',            // 134
  '68': 'fum',                  // 415
  '72': 'fum_lost',             // 288
  '74': 'fgm_50p',              // 75
  '76': 'fgmiss_50p',           // 67
  '77': 'fgm_40_49',            // 81
  '83': 'fgm',                  // 84
  '84': 'fga',                  // 84
  '85': 'fgmiss',               // 77
  '86': 'xpm',                  // 84
  '87': 'xpa',                  // 84
  '88': 'xpmiss',               // 51
  '114': 'kr_yd',               // 258
  '158': 'kick_pts',            // 84
  '198': 'fgm_50_59',           // 74
  '200': 'fgmiss_50_59',        // 66
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

