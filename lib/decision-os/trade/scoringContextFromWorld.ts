/**
 * CanonicalWorld → ScoringContext. PURE: no prisma, no fetch, no clock.
 *
 * ── 🛑 WHY THIS EXISTS: THE PARAMETER WAS THERE AND NOBODY PASSED IT ─────────────────────────
 * `buildTradeValueSnapshot` has accepted `scoring?: ScoringContext` since slice 16, and BOTH
 * canonicalMemo call sites omit it. So the Decision OS trade path — which is LIVE in production
 * (`DECISION_OS_TRADE_LIVE=true` in the committed `.env.production`) — prices every league as
 * standard 1-QB redraft. A superflex league's quarterbacks, a TE-premium league's tight ends and
 * a 32-team league's entire board are all graded against a market none of them are in.
 *
 * The inputs were never missing. `LeagueRosterSettingsFacts` carries `starterSlots`, `rosterSize`,
 * `irSlots` and `taxiSlots`; `LeagueTradeSettingsFacts` carries `deadlineWeek`; `LeagueFacts`
 * carries `scoringSettings`; team count is `world.teams.length`. This module is the wire.
 *
 * ── EVERY FIELD REFUSES RATHER THAN DEFAULTS ────────────────────────────────────────────────
 * A missing `rec` returns null, not `'standard'`. A missing `starterSlots` returns no shape, not
 * a 12-team guess. `normalizedPlayerValue` treats every absent field as "behave exactly as
 * before", so an honest gap degrades to today's behaviour instead of to a confident wrong answer.
 */

import type { ScoringContext } from '@/lib/trade-value/valueEngine'
import { buildLeagueShape, type LeagueShape } from '@/lib/trade-value/leagueShape'

/** The subset of the canonical world this needs. Structural, so any world-shaped object works. */
export interface ScoringContextWorldInput {
  teams: number
  starterSlots: readonly string[] | null | undefined
  rosterSize?: number | null
  irSlots?: number | null
  taxiSlots?: number | null
  deadlineWeek?: number | null
  /** Provider-neutral scoring blob. Sleeper shape: `{ rec, bonus_rec_te, ... }`. */
  scoringSettings?: unknown
}

function numberAt(blob: unknown, key: string): number | null {
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) return null
  const v = (blob as Record<string, unknown>)[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Points per reception → scoring format.
 *
 * ⚠ BANDED, NOT EXACT-MATCHED. Leagues really do run 0.4 and 0.75 PPR, and an exact `=== 0.5`
 * test would silently drop them into whichever branch it fell through to. The bands below are
 * chosen so the common settings (0, 0.5, 1) land where they obviously should, and anything
 * genuinely in between rounds to the nearer of the three formats the engine can express.
 *
 * Returns null when `rec` is absent — the engine then applies no PPR lift at all, which is what
 * it did before this module existed.
 */
export function scoringFormatFromRec(rec: number | null): ScoringContext['scoringFormat'] {
  if (rec == null) return null
  if (rec < 0.25) return 'standard'
  if (rec < 0.75) return 'half_ppr'
  return 'ppr'
}

/**
 * Build the real scoring context for a league, or null when nothing useful is known.
 *
 * Returns null rather than an empty object so a caller can tell "we know nothing" from "we know
 * this league is standard", which are different claims.
 */
export function scoringContextFromWorld(input: ScoringContextWorldInput): ScoringContext | null {
  const shape: LeagueShape | null = buildLeagueShape({
    teams: input.teams,
    starterSlots: input.starterSlots,
    rosterSize: input.rosterSize,
    irSlots: input.irSlots,
    taxiSlots: input.taxiSlots,
    deadlineWeek: input.deadlineWeek,
  })

  const rec = numberAt(input.scoringSettings, 'rec')
  const scoringFormat = scoringFormatFromRec(rec)

  /*
   * TE premium is the PER-RECEPTION BONUS, which is a different number from `rec`. Sleeper calls
   * it `bonus_rec_te`; a TEP league sets it to 0.5 or 1.0 on top of whatever `rec` already is.
   * Four Horsemen runs 0.75.
   */
  const tePremium = numberAt(input.scoringSettings, 'bonus_rec_te')

  if (!shape && scoringFormat == null && tePremium == null) return null

  return {
    shape,
    scoringFormat,
    tePremium: tePremium != null && tePremium > 0 ? tePremium : null,
    /*
     * ⚠ THE BOOLEANS ARE DELIBERATELY LEFT UNSET WHEN A SHAPE EXISTS. `scoringScarcityMultiplier`
     * ignores them in that case anyway, and setting them too would leave two rival descriptions of
     * the same fact on one object for the next reader to reconcile. When the shape could NOT be
     * built, `superflexSlots` is unknowable, so there is nothing honest to put here either — the
     * caller's own boolean (if it has one) is a better source than anything invented here.
     */
  }
}

/**
 * Convenience for callers holding a full `CanonicalWorld`-shaped object.
 *
 * Structural rather than importing `CanonicalWorld`, so this module stays free of the world's
 * import graph and remains trivially testable with a literal.
 */
export function scoringContextFromCanonicalWorld(world: {
  teams: readonly unknown[]
  league: {
    scoringSettings?: unknown
    rosterSettings?: { starterSlots?: string[] | null; rosterSize?: number | null; irSlots?: number | null; taxiSlots?: number | null } | null
    tradeSettings?: { deadlineWeek?: number | null } | null
  }
}): ScoringContext | null {
  return scoringContextFromWorld({
    teams: world.teams.length,
    starterSlots: world.league.rosterSettings?.starterSlots ?? null,
    rosterSize: world.league.rosterSettings?.rosterSize ?? null,
    irSlots: world.league.rosterSettings?.irSlots ?? null,
    taxiSlots: world.league.rosterSettings?.taxiSlots ?? null,
    deadlineWeek: world.league.tradeSettings?.deadlineWeek ?? null,
    scoringSettings: world.league.scoringSettings,
  })
}
