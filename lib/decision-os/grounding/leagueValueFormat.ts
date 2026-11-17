import { DEVY_DYNASTY_VARIANT } from '@/lib/devy/types'

/**
 * League-derived inputs for pricing and scoring, read off `CanonicalLeagueRules`.
 *
 * ── 🛑 WHY THIS IS ITS OWN MODULE AND NOT PART OF `packet.ts` ───────────────────────────────
 * These two functions started in `grounding/packet.ts` and are still re-exported from it, so
 * nothing that imported them there had to change. They moved because a SECOND caller appeared on
 * a much hotter path: `lib/ai/deterministic.ts`, which runs on EVERY chat message before anything
 * else in the route.
 *
 * `packet.ts` carries 17 imports including `ChimmyContextEngine` and all four OS feed loaders.
 * Importing one pure helper from it would evaluate that entire graph on every message, including
 * the ones that never build a packet. This module has exactly one import, a constant.
 *
 * ⚠ NO IO, NO CLOCK, NO PRISMA. Both functions take rules that a caller has already loaded. Keep
 * it that way — the moment this reaches for the database it stops being safe to call from the
 * deterministic short-circuit, which is the whole reason it exists.
 */

/**
 * 🛑 THE VALUE CHART IS NOT DERIVED HERE ANY MORE (2026-11-17). `deriveValueFormat` lived in this file and
 * priced every keeper league on the dynasty chart; Chimmy now asks `valueBookFor` through
 * ./leagueValueBook, the same rule as every screen. Do not re-add a chart rule here: a second copy is how
 * the card and Chimmy came to quote two different values for one player.
 */

/**
 * R1.5 — does this league want the devy board even though it is not an NCAAF league?
 *
 * 🛑 THE GAP THIS CLOSES. `want.devy` was `sport === 'NCAAF'`, and the board is college-football
 * only, so that test is right for every ordinary league. It is WRONG for a C2C / devy-slot NFL
 * dynasty league, which rosters college players in an NFL league and therefore wants the board
 * while failing the sport test. Recorded as a known limitation when the sport scoping shipped.
 *
 * ⚠ IT READS THE VARIANT, WHICH IS ALREADY IN THE RULES THE PACKET LOADS. `canonicalLeagueRules`
 * puts `leagueVariant` at `general.variant`, so this costs NO new query — the same argument
 * the league-size and scoring readers in this file make. The alternative was calling `isDevyLeague` from the
 * chat route, which is a DB round-trip on every turn and delays the packet kick.
 *
 * ⚠ IT MATCHES THE CANONICAL VARIANT CONSTANT, NOT A SUBSTRING. `lib/devy/types.ts` defines
 * `DEVY_DYNASTY_VARIANT = 'devy_dynasty'`, and `isDevyLeague` compares against exactly that. A
 * loose `/devy/i` test here would be a SECOND definition of "is this a devy league" that could
 * drift from the first — the two-implementations-of-one-rule bug this repo has paid for before.
 * The comparison is case-insensitive only to survive an importer's casing, not to widen the rule.
 *
 * ⚠ AND IT DELIBERATELY DOES NOT READ `devy_league_configs`. That is the other half of
 * `isDevyLeague`, and reading it here would be the query this derivation exists to avoid. A
 * league with a config row but no variant is not detected by this path; that is a known and
 * accepted narrowing, recorded rather than hidden — see §0.38.
 */
export function deriveWantsDevyBoard(rules: unknown): boolean {
  if (!rules || typeof rules !== 'object') return false
  const r = rules as { general?: { variant?: unknown } }
  const v = r.general?.variant
  return typeof v === 'string' && v.trim().toLowerCase() === DEVY_DYNASTY_VARIANT
}

/**
 * This league's scoring as the `statKey → points` map `rescoreIdpForLeague` expects.
 *
 * 🛑 WITHOUT IT EVERY PROJECTION IS THE *BALANCED* IDP PRESET, NOT A NEUTRAL ONE — materially
 * wrong for a tackle-heavy league, and nothing about the number looks wrong.
 *
 * ⚠ ALL ACTIVE RULES, NOT A FILTERED "IDP" SUBSET. `rescoreIdpForLeague` walks the PROJECTION's
 * component amounts and looks each one up here, so a non-IDP key is never read. Filtering on
 * `category` would instead risk dropping a real IDP rule an importer spelled differently — silent
 * under-scoring, which is worse than a harmless extra key.
 */
export function deriveIdpRules(rules: unknown): Record<string, number> | null {
  if (!rules || typeof rules !== 'object') return null
  const active = (rules as { scoring?: { activeRules?: unknown } }).scoring?.activeRules
  if (!Array.isArray(active)) return null
  const out: Record<string, number> = {}
  for (const row of active) {
    if (!row || typeof row !== 'object') continue
    const k = (row as { statKey?: unknown }).statKey
    const v = (row as { pointsValue?: unknown }).pointsValue
    if (typeof k === 'string' && k.length > 0 && typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  // Null rather than `{}` — an empty map would rescore every projection to zero and report
  // `rescored: true`, which is the confident-wrong-number failure the packet exists to prevent.
  return Object.keys(out).length > 0 ? out : null
}

/**
 * How many teams and what PPR this league uses, for a market query.
 *
 * ⚠ NULLABLE ON PURPOSE. `numTeams: 12, ppr: 1` used to be hardcoded in the deterministic path AND
 * printed to the user as "Settings: … 12-team PPR" — a literal, identical for every league on the
 * platform. Where the rules do not carry these, the answer must omit the claim rather than invent
 * a plausible one.
 */
/**
 * ⚠ NARROWED TO THE THREE BUCKETS THE MARKET ACTUALLY PUBLISHES, and that is a data fact rather
 * than a type convenience: `FantasyCalcSettings.ppr` is `0 | 0.5 | 1`, so a league scoring 1.5 per
 * reception (TE-premium, say) has NO exact bucket. Returning `1.5` here would not fail — it would
 * be silently coerced at the call site into a query for a market that does not exist.
 *
 * So an unrepresentable value comes back as **null**, the caller queries a stated default, and —
 * critically — omits PPR from the settings sentence rather than claiming a number the league does
 * not use. Caught by the typechecker after the tests were already green, which is the whole
 * argument for the gate.
 */
type MarketPpr = 0 | 0.5 | 1

export function deriveLeagueSizeAndPpr(
  rules: unknown,
): { numTeams: number | null; ppr: MarketPpr | null } {
  if (!rules || typeof rules !== 'object') return { numTeams: null, ppr: null }
  const r = rules as {
    general?: { teamCount?: unknown }
    scoring?: { activeRules?: unknown }
  }
  const teamCount = typeof r.general?.teamCount === 'number' ? r.general.teamCount : null

  // PPR is a scoring rule, not a setting: read the reception value if the league states one.
  let ppr: MarketPpr | null = null
  const active = r.scoring?.activeRules
  if (Array.isArray(active)) {
    for (const row of active) {
      if (!row || typeof row !== 'object') continue
      const k = (row as { statKey?: unknown }).statKey
      const v = (row as { pointsValue?: unknown }).pointsValue
      if (typeof k === 'string' && /^(rec|reception)s?$/i.test(k) && typeof v === 'number' && Number.isFinite(v)) {
        // Exact match only. A league on 1.5 is NOT "about 1" — it has no bucket, and rounding it
        // to one would hand the caller a number to print that the league does not use.
        ppr = v === 0 ? 0 : v === 0.5 ? 0.5 : v === 1 ? 1 : null
        break
      }
    }
  }
  return { numTeams: teamCount, ppr }
}
