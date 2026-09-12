/**
 * Fleaflicker `FetchLeagueRules` → the canonical `scoring.rules` shape.
 *
 * Closes the "rules" third of P2 item 1 of the import audit. The Fleaflicker
 * adapter emitted `scoring: null` and its own coverage said so in as many words:
 * "Fleaflicker scoring rules not mapped in v1".
 *
 * Every decision here is measured against
 * `contracts/fleaflicker/fixtures/rules.NFL.json` (league 206154, 48 rules
 * across 8 groups), not inferred from the vendor's docs, which name the endpoint
 * without describing its body.
 *
 * ── WHAT MAKES THIS HARDER THAN THE OTHER PROVIDERS ──────────────────────────
 *
 * 🛑 A CATEGORY CAN CARRY SEVERAL RULES, so "one stat, one points value" is false
 * for Fleaflicker. In the fixture, category 11 (QB Rating) has SEVEN rules —
 * banded tiers — category 102 (Field Goal Made) has three distance bands, and
 * category 41 (Catch) has two. These are `isBonus` / `boundLower` / `boundUpper`
 * rules, and they are genuinely several rules about one stat.
 *
 * The canonical normalizer already anticipates exactly this: its flat
 * `scoringRules` map "is lossy by construction (it cannot express a range,
 * threshold or unit)", which is why it also builds `rulesDetail` as a LIST. So
 * this emits one entry per Fleaflicker rule and lets the map collapse as it
 * already does for every other provider — the detail list keeps all of them, and
 * the normalizer tracks the collision. Inventing a synthetic per-band stat key
 * to dodge the collapse would put a key space in the database that nothing else
 * understands, which is worse than a documented lossy map.
 *
 * ⚠ `abbreviation` IS NOT A KEY. It collides eight ways in the fixture — "Yd"
 * spans Passing, Rushing, Receiving and Returning; "TD" spans six groups. Keying
 * on it would silently merge unrelated rules. `category.id` is the provider's
 * own identifier and is what this uses.
 *
 * ⚠ `applyToAll: true` MEANS "EVERY POSITION", and `applyTo` then lists all ten.
 * Carrying those positions downstream would invent a restriction that does not
 * exist, and the canonical map treats a rule with no positions as global — which
 * is the correct meaning. 39 of the fixture's 48 rules are in this state.
 */
import type {
  FleaflickerRulesResponse,
  FleaflickerScoringRule,
} from '@/lib/league-import/fleaflicker/types'

export interface NormalizedFleaflickerRule {
  /** Provider-native: `category.id` as a string. Not the abbreviation — it collides. */
  stat_key: string
  /**
   * The PER-UNIT rate where the rule has one: `pointsPer.value` (already
   * divided) in preference to `points.value`, because "1 point per 25 yards" is
   * 0.04 points per yard and a scoring engine wants the rate.
   *
   * ⚠ For a flat bonus rule (no `forEvery`, no `pointsPer` — 10 of 48) this is
   * `points.value`, which is the whole bonus rather than a rate. The two are
   * distinguishable downstream only via `description`/bounds, which is a real
   * limit of the canonical shape and is recorded rather than papered over.
   */
  points_value: number
  /** Omitted entirely when the rule applies to every position. */
  positions?: string[]
  /** Human-resolvable name, the way MFL rules are resolved. */
  stat_name?: string
}

function numberOr(value: unknown, fallback: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * The per-unit points a rule is worth.
 *
 * Order matters: `pointsPer` is present only when `forEvery` is not 1, so
 * preferring it gives the true rate for the 13 rules that have one, and falls
 * through to `points.value` for the rest — which is already per-unit when
 * `forEvery` is 1, and is the flat amount for a bonus.
 */
export function ruleRate(rule: FleaflickerScoringRule): number | null {
  const per = numberOr(rule.pointsPer?.value, null)
  if (per != null) return per
  return numberOr(rule.points?.value, null)
}

/**
 * Position codes a rule is restricted to, or `null` when it applies to all.
 *
 * 🛑 `applyToAll` IS CHECKED FIRST AND SHORT-CIRCUITS. A rule can have
 * `applyToAll: true` AND a fully populated `applyTo`; reading the array without
 * checking the flag turns "applies to everyone" into "applies to exactly these
 * ten", which is a different rule the moment an eleventh position exists.
 */
export function rulePositions(rule: FleaflickerScoringRule): string[] | null {
  if (rule.applyToAll === true) return null
  const list = Array.isArray(rule.applyTo) ? rule.applyTo : []
  const cleaned = list.map((p) => String(p ?? '').trim().toUpperCase()).filter(Boolean)
  return cleaned.length > 0 ? cleaned : null
}

/**
 * Flatten `FetchLeagueRules` into the canonical rule list.
 *
 * Returns `[]` rather than throwing on an empty or unexpected body: scoring
 * rules are an enrichment, and an import that can read standings and rosters
 * must not fail because this endpoint had nothing to say.
 */
export function normalizeFleaflickerScoringRules(
  raw: FleaflickerRulesResponse | null | undefined,
): NormalizedFleaflickerRule[] {
  const groups = Array.isArray(raw?.groups) ? raw!.groups : []
  const out: NormalizedFleaflickerRule[] = []

  for (const group of groups) {
    /*
     * ⚠ ABSENT, NOT EMPTY. `Punting` in the committed fixture has 10
     * `allCategories` and no `scoringRules` key at all. `?? []` is load-bearing:
     * without it this iterates `undefined` and the whole import dies on a group
     * that simply has no rules — the same shape that once broke this provider's
     * adapter on a division with no `teams`.
     */
    for (const rule of group?.scoringRules ?? []) {
      const categoryId = numberOr(rule?.category?.id, null)
      if (categoryId == null) continue

      const rate = ruleRate(rule)
      if (rate == null) continue

      const positions = rulePositions(rule)
      const statName = String(rule?.category?.nameSingular ?? '').trim()

      out.push({
        stat_key: String(categoryId),
        points_value: rate,
        ...(positions ? { positions } : {}),
        ...(statName ? { stat_name: statName } : {}),
      })
    }
  }

  return out
}

/**
 * Roster shape, for the settings snapshot.
 *
 * ⚠ `min`/`max`/`start` ARE OPTIONAL — 14 of the fixture's 19 positions omit all
 * three (every bench, IR, taxi and multi-eligibility slot). A starter count
 * derived by summing `start` must therefore treat absence as zero rather than
 * as a parse failure, and `numStarters` is supplied by the provider anyway and
 * is preferred.
 */
export function summarizeFleaflickerRosterShape(
  raw: FleaflickerRulesResponse | null | undefined,
): { starters: number | null; bench: number | null; maxRosterSize: number | null } {
  return {
    starters: numberOr(raw?.numStarters, null),
    bench: numberOr(raw?.numBench, null),
    maxRosterSize: numberOr(raw?.maxRosterSize, null),
  }
}
