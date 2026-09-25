import { leagueVariantFor } from '@/lib/core-app/valueBook'
import type { LeagueContextEnvelope } from '@/lib/league-context/leagueContextService'

/*
 * Moved verbatim from `lib/core-app/playerTradeVisual.ts` (2026-09-24), which re-exports it. The
 * Player Finder, the value book, the waiver pool and now the league-graded trade verdict all price
 * a league off this one rule — two copies of it is how surfaces come to price a league off
 * different charts while each looks right on its own.
 */
const IDP_SLOTS = new Set(['DL', 'LB', 'DB', 'IDP_FLEX', 'DE', 'DT', 'CB', 'S'])

/** The market-value context the value service keys its cache on, from the league's own settings. */
export function marketContextFor(
  settings: unknown,
  leagueType: string | null,
  teams: number
): Pick<LeagueContextEnvelope, 'variant' | 'scoring' | 'teams'> {
  const s = (settings ?? {}) as Record<string, unknown>
  const rawScoring = (s.scoring_settings ?? {}) as Record<string, unknown>
  const scoringSettings: Record<string, number> = {}
  for (const [k, v] of Object.entries(rawScoring)) {
    const n = Number(v)
    if (Number.isFinite(n)) scoringSettings[k] = n
  }
  const rec = scoringSettings.rec ?? 0
  const positions = Array.isArray(s.roster_positions) ? s.roster_positions.map((p) => String(p).toUpperCase()) : []
  const type = (leagueType ?? '').toLowerCase()
  /*
   * ⚠ `superflex` / `dynasty` / `keeper` COME FROM `valueBook.ts`, NOT FROM A
   * SECOND COPY OF THE PREDICATES. The value tables and this engine context are
   * keyed on the same three traits, and they were derived independently in two
   * places — which is how the player card, the Trades screen and the trades
   * board came to price 68% of leagues off the wrong book while agreeing
   * perfectly with each other. Two implementations of one rule is the bug.
   */
  const variant = leagueVariantFor(settings, leagueType)
  return {
    teams,
    variant: {
      idp: positions.some((p) => IDP_SLOTS.has(p)),
      superflex: variant.superflex,
      dynasty: variant.dynasty,
      keeper: variant.keeper,
      bestBall: type.includes('best ball') || type.includes('bestball'),
    },
    scoring: {
      settings: scoringSettings,
      receptionWeight: rec,
      format: rec >= 0.75 ? 'ppr' : rec >= 0.25 ? 'half_ppr' : 'std',
      idp: { present: false, tacklePts: 0, sackPts: 0, intPts: 0, emphasis: null },
    },
  }
}
