import { leagueVariantFor, lineupEntriesFromSettings } from '@/lib/core-app/valueBook'
import type { LeagueContextEnvelope } from '@/lib/league-context/leagueContextService'

/*
 * Moved verbatim from `lib/core-app/playerTradeVisual.ts` (2026-09-24), which re-exports it. The
 * Player Finder, the value book, the waiver pool and now the league-graded trade verdict all price
 * a league off this one rule — two copies of it is how surfaces come to price a league off
 * different charts while each looks right on its own.
 */
const IDP_SLOTS = new Set(['DL', 'LB', 'DB', 'IDP_FLEX', 'DE', 'DT', 'CB', 'S'])

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

/**
 * The league's numeric scoring weights. Imported leagues store Sleeper-shaped `scoring_settings`; leagues
 * created here store `scoringSettings`, whose weights sit at the top level and under `rules`. A
 * top-level weight wins over the same name under `rules`.
 */
export function numericScoringOf(s: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {}
  const take = (o: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'boolean' || v == null || v === '') continue
      const n = Number(v)
      if (Number.isFinite(n)) out[k] = n
    }
  }
  if (isRecord(s.scoring_settings)) {
    take(s.scoring_settings)
    return out
  }
  if (isRecord(s.scoringSettings)) {
    if (isRecord(s.scoringSettings.rules)) take(s.scoringSettings.rules)
    take(s.scoringSettings)
  }
  return out
}

/** The market-value context the value service keys its cache on, from the league's own settings. */
export function marketContextFor(
  settings: unknown,
  leagueType: string | null,
  teams: number
): Pick<LeagueContextEnvelope, 'variant' | 'scoring' | 'teams'> {
  const s = (settings ?? {}) as Record<string, unknown>
  const scoringSettings = numericScoringOf(s)
  /*
   * 🛑 A LEAGUE WITH NO `rec` WAS PRICED AS STANDARD SCORING (trade grade audit, 2026-10-09). Leagues
   * created here store `scoringSettings: { ppr: 0.5, rules: {…} }` — camelCase, with the reception
   * weight named `ppr` — and only snake_case `rec` was read, so all of them were priced on the 0-PPR
   * chart whatever they score. A weight the league never states still reads 0, as before.
   */
  const rec = scoringSettings.rec ?? scoringSettings.ppr ?? 0
  // `NAME:count` entries (ESPN, Yahoo, MFL, starter_slots) name the slot before the colon.
  const positions = lineupEntriesFromSettings(s).map((p) => String(p).toUpperCase().replace(/:\d+(?:-\d+)?$/, '').trim())
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
      keeperShare: variant.keeperShare,
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
