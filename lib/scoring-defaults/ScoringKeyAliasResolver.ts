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
 * ⚠ STILL DELIBERATELY ABSENT: defensive and IDP ids. Team-defense (D/ST) ids are NOT in this
 * table either — they live in `ESPN_TEAM_DEFENSE_STAT_ID_TO_SLEEPER_KEY` below, under a separate,
 * stated evidence tier, because this table's rule cannot settle them (see that table's note).
 * Anything unresolved returns null and the caller must keep the provider key, never guess.
 *
 * Comment shows agreeing player-seasons out of 1,384.
 */
const ESPN_STAT_ID_TO_SLEEPER_KEY: Record<string, string> = {
  '0': 'pass_att',              // 179
  '1': 'pass_cmp',              // 158
  '2': 'pass_inc',              // 161
  '3': 'pass_yd',               // 158
  '4': 'pass_td',               // 121
  '15': 'pass_td_40p',          // 71
  '16': 'pass_td_50p',          // 55
  '17': 'bonus_pass_yd_300',    // 62
  '19': 'pass_2pt',             // 51
  '20': 'pass_int',             // 115
  '23': 'rush_att',             // 627
  '24': 'rush_yd',              // 614
  '25': 'rush_td',              // 260
  '26': 'rush_2pt',             // 27
  '35': 'rush_td_40p',          // 48
  '36': 'rush_td_50p',          // 31
  '37': 'bonus_rush_yd_100',    // 75
  '41': 'rec',                  // 898
  '42': 'rec_yd',               // 897
  '43': 'rec_td',               // 503
  '44': 'rec_2pt',              // 66
  '46': 'rec_td_50p',           // 81
  '53': 'rec',                  // 898
  '56': 'bonus_rec_yd_100',     // 151
  '64': 'pass_sack',            // 135
  '68': 'fum',                  // 431
  '72': 'fum_lost',             // 300
  '74': 'fgm_50p',              // 75
  '76': 'fgmiss_50p',           // 67
  '77': 'fgm_40_49',            // 81
  '83': 'fgm',                  // 84
  '84': 'fga',                  // 84
  '85': 'fgmiss',               // 77
  '86': 'xpm',                  // 84
  '87': 'xpa',                  // 84
  '88': 'xpmiss',               // 51
  '114': 'kr_yd',               // 272
  '158': 'kick_pts',            // 84
  '198': 'fgm_50_59',           // 74
  '200': 'fgmiss_50_59',        // 66
}

/**
 * ESPN TEAM DEFENSE (D/ST) ids → Sleeper keys. A SECOND, STATED EVIDENCE TIER — not the rule above.
 *
 * ⚠ WHY A SECOND TIER, AND WHY IT IS NOT A LOOSENED FIRST ONE. The rule above (≥25 agreements, zero
 * contradictions) cannot settle a team defense, measured on 64 team-seasons (2024–25):
 *   - Sleeper omits zeros, so a shutout or a safety never reaches 25 comparisons even when it
 *     agrees every time;
 *   - season totals carry stat corrections one provider applied and the other did not — sacks agree
 *     on 62 of 64, the other two are 34 vs 35, and one contradiction rejects the id outright.
 * Leaving them out was not neutral: the scoring engine counts an unmatched rule as zero, so a D/ST
 * either went unpriced or would have been priced with its sacks silently missing.
 *
 * This tier compares over EVERY team-season with an absent value read as 0 — which is what makes a
 * coincidence fail: a key that merely shares a few small counts collects a contradiction wherever
 * one side has the event and the other does not (under the old method ESPN 101, a kickoff-return TD,
 * "agreed" 8/8 with special-teams forced fumbles; here it pairs with nothing). A pairing lands only
 * when it is exact on ≥90% of team-seasons, every miss is within ±1, ≥3 team-seasons are non-zero,
 * and it is the ONLY key that passes. Chosen by the owner 2026-11-17 over strict-only, which left
 * every ESPN D/ST unpriced.
 *
 * Points-allowed ids map to `pts_allow_range_<lo>_<hi>` keys, scored from the projection's raw
 * `pts_allow` (`leagueScoring.ts`), NEVER to Sleeper's own `pts_allow_*` buckets: ESPN's edges are
 * not Sleeper's (14–17 / 18–21 / 22–27 against 14–20 / 21–27; 35–45 / 46+ against 35+), and mixing
 * the two ladders could fire two buckets for one game. The edges were SEARCHED — every [lo, hi]
 * against Sleeper's per-game points allowed — not recalled: 14–17 reproduces 63 of 64 team-seasons,
 * the next-best range 41. Where the data cannot separate two edges (no game was decided by exactly
 * 1 point allowed), the buckets must partition, which settles it.
 *
 * Reproduce with `node scripts/compare-espn-sleeper-stat-ids.mjs`; the proof is the `teamDefense`
 * section of `espn-stat-id-evidence.json`. Comment: exact team-seasons of 64, ±1 misses in brackets.
 */
const ESPN_TEAM_DEFENSE_STAT_ID_TO_SLEEPER_KEY: Record<string, string> = {
  '89': 'pts_allow_range_0_0',     // 64
  '90': 'pts_allow_range_1_6',     // 64
  '91': 'pts_allow_range_7_13',    // 64
  '92': 'pts_allow_range_14_17',   // 63 (1)
  '121': 'pts_allow_range_18_21',  // 63 (1)
  '122': 'pts_allow_range_22_27',  // 63 (1)
  '123': 'pts_allow_range_28_34',  // 62 (2)
  '124': 'pts_allow_range_35_45',  // 63 (1)
  '125': 'pts_allow_range_46_up',  // 64
  '188': 'pts_allow_range_0_0',    // 64
  '189': 'pts_allow_range_1_6',    // 64
  '190': 'pts_allow_range_7_13',   // 64
  '194': 'pts_allow_range_28_34',  // 62 (2)
  '93': 'misc_td',                 // 64 — unless the special-teams TD sum below takes it
  '94': 'def_td',                  // 63 (1)
  '95': 'int',                     // 64
  '97': 'blk_kick',                // 64
  '98': 'safe',                    // 64
  '99': 'sack',                    // 62 (2)
  '128': 'yds_allow_0_100',        // 64
  '129': 'yds_allow_100_199',      // 64
  '130': 'yds_allow_200_299',      // 64
  '131': 'yds_allow_300_349',      // 64
  '132': 'yds_allow_350_399',      // 64
  '133': 'yds_allow_400_449',      // 64
  '134': 'yds_allow_450_499',      // 64
  '135': 'yds_allow_500_549',      // 64
  '136': 'yds_allow_550p',         // 64
  '205': 'def_2pt',                // 64
  '206': 'def_2pt',                // 64
}

/**
 * ESPN D/ST ids that are SUMS of Sleeper keys, each a hypothesis the evidence script TESTED (same
 * tier as above). A sum is applied only when every ESPN id in it carries the SAME non-zero weight in
 * the league — then scoring each Sleeper key at that weight is exactly scoring the ESPN ids. With
 * unequal weights it cannot be split back apart, so it is left untranslated and the D/ST is refused.
 *
 * ESPN 124+125 = `pts_allow_35p` also passed (63/64) but is not listed: the range keys above already
 * score 35–45 and 46+ separately, which is strictly better than a sum.
 */
export const ESPN_TEAM_DEFENSE_SUMS: ReadonlyArray<{ espn: readonly string[]; sleeper: readonly string[] }> = [
  { espn: ['96'], sleeper: ['fum_rec', 'def_st_fum_rec'] },  // 60 (4) — ESPN counts special-teams recoveries too
  { espn: ['93', '101', '102'], sleeper: ['def_st_td'] },    // 63 (1)
  { espn: ['103', '104'], sleeper: ['def_td'] },             // 63 (1)
]

/**
 * Every stat id seen on an ESPN D/ST row in the evidence seasons. A D/ST projection is refused when
 * the league scores one of these that is still untranslated — an unmatched rule counts as zero, and
 * for a defence that would silently understate rather than say "we cannot price this".
 */
export const ESPN_TEAM_DEFENSE_STAT_IDS: ReadonlySet<string> = new Set([
  ...Array.from({ length: 37 }, (_, i) => String(89 + i)), // 89–125
  ...Array.from({ length: 10 }, (_, i) => String(127 + i)), // 127–136
  '155', '156',
  ...Array.from({ length: 10 }, (_, i) => String(187 + i)), // 187–196
  '205', '206', '210',
])

/** A points-allowed range key's bounds, or null. `hi` null means open-ended (`_up`). */
export function parsePointsAllowedRangeKey(key: string): { lo: number; hi: number | null } | null {
  const m = /^pts_allow_range_(\d+)_(\d+|up)$/.exec(String(key ?? ''))
  if (!m) return null
  return { lo: Number(m[1]), hi: m[2] === 'up' ? null : Number(m[2]) }
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


/**
 * MFL scoring-rule NAMES (normalized) → Sleeper projection keys.
 *
 * ⚠ NAME-KEYED, NOT CODE-KEYED, AND THAT IS THE HONESTY BAR. MFL's `TYPE=rules` names each
 * event by a short abbreviation, and this repo has no MFL account to derive a code table
 * from — the ESPN table above exists only because 1,277 player-seasons of agreeing evidence
 * could be joined, and no such evidence is available here. Recalling what "RE" or "PY" mean
 * and writing it down as fact is precisely the failure the ESPN note warns about: a guessed
 * scoring key silently mis-scores every player in the league.
 *
 * So this maps only what MFL SPELLS OUT in a rule's own human-readable text, the same
 * mechanism `YAHOO_STAT_NAME_TO_SLEEPER_KEY` uses and for the same reason. A rule with no
 * name, or a name not listed here, resolves to null and keeps its `mfl_stat_<code>` key —
 * unresolved and visibly so, never guessed.
 *
 * ⚠ WHEN AN MFL KEY BECOMES AVAILABLE, derive a code table from evidence the way
 * `scripts/compare-espn-sleeper-stat-ids.mjs` did and commit the evidence alongside it.
 * Do not populate this from memory.
 */
const MFL_STAT_NAME_TO_SLEEPER_KEY: Record<string, string> = {
  'passing yards': 'pass_yd',
  'pass yards': 'pass_yd',
  'passing touchdowns': 'pass_td',
  'passing td': 'pass_td',
  'rushing yards': 'rush_yd',
  'rush yards': 'rush_yd',
  'rushing touchdowns': 'rush_td',
  'rushing td': 'rush_td',
  receptions: 'rec',
  reception: 'rec',
  'receiving yards': 'rec_yd',
  'rec yards': 'rec_yd',
  'receiving touchdowns': 'rec_td',
  'receiving td': 'rec_td',
  'fumbles lost': 'fum_lost',
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
  options?: {
    yahooStatCategoriesById?: ReadonlyMap<string, YahooCapturedStatCategory>
    /** The human-readable name MFL shipped with this rule, when it shipped one. */
    mflStatName?: string | null
  }
): string | null {
  const key = String(statKey ?? '').trim().toLowerCase()

  if (key.startsWith('espn_stat_')) {
    const id = key.slice('espn_stat_'.length)
    return ESPN_STAT_ID_TO_SLEEPER_KEY[id] ?? ESPN_TEAM_DEFENSE_STAT_ID_TO_SLEEPER_KEY[id] ?? null
  }

  if (key.startsWith('mfl_stat_')) {
    /* Resolvable only from the name MFL supplied — never from the code itself. See the
       table's note: there is no evidence base for an MFL code mapping yet. */
    const named = normalizeProviderStatName(String(options?.mflStatName ?? ''))
    if (!named) return null
    return MFL_STAT_NAME_TO_SLEEPER_KEY[named] ?? null
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

