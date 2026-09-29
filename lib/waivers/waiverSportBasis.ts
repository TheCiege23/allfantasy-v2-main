/**
 * What a waiver board can price a player ON, per sport — and, for a sport with nothing, why not.
 *
 * Client-safe on purpose (no imports): both loaders decide with it and both renderers print its
 * words, and two copies of "which sports have a producer" is how one screen starts claiming a
 * number the other admits it does not have.
 *
 * ── THE PRODUCERS, AS THEY EXIST ───────────────────────────────────────────────────────────────
 *
 *   NFL     `fantasy_projections`, one WEEK deep (cron/import-projections). Unchanged: the NFL
 *           boards keep their own path, byte for byte.
 *   NCAAF   `AFProjectionSnapshot`, season baseline rows (`week = null`), PER GAME, keyed by CFBD
 *           id, with `adjustmentFactors.perGameRates` in CFBD's vocabulary (`receiving.REC`, …),
 *           which `leagueScoring` aliases — so a college league's own `scoring_settings` prices it.
 *   NBA · NCAAB · NHL · MLB
 *           `AFProjectionSnapshot`, season baseline rows, PER GAME, keyed by `PlayerIdentityMap.id`,
 *           scored by the engine under its DEFAULT category rules (af-projections/categoryScoring:
 *           DraftKings conventions). Written by cron/compute-projections for every sport.
 *   SOCCER  nothing. The stats vendor serves no soccer player season stats, so the engine has no
 *           rules and no lines for it (categoryScoring.ts says so), and nothing else projects it.
 *
 * ── 🛑 WHY THE CATEGORY SPORTS ARE NOT RE-SCORED UNDER THE LEAGUE'S RULES ──────────────────────
 * The engine stores its per-game component rates in the provider's vocabulary (`total_rebounds`,
 * `three_points_made`, `goals`, `assists`), while league rulebooks are written in another
 * (`rebounds`, `three_pointers_made`, `goal`, `assist` — see ScoringDefaultsRegistry). No alias
 * bridges them, and `computeLeagueProjectedPoints` returns a number as soon as ONE key matches: a
 * default NBA rulebook matches `points`, `assists`, `steals`, `blocks` and `turnovers` and silently
 * drops every rebound, which ranks every centre low. A partial re-score is worse than a stated
 * default, so these sports are priced on AllFantasy's default scoring and every surface says so.
 *
 * ── 🛑 A SEASON RATE IS NOT A WEEKLY PROJECTION ────────────────────────────────────────────────
 * The snapshot writer gates week-scoped rows on the NFL's season state, so no other sport has a
 * week-scoped row at all. What exists is a per-game rate from the season's production. It knows
 * nothing about this week's schedule (an NBA team can play two games or four), a rest day or a
 * changed role, and every surface that shows it labels it "per game" — never "this week".
 */

export type WaiverValueBasis = 'weekly_projection' | 'season_per_game_league' | 'season_per_game_af_default'

export type WaiverSportPlan =
  | { sport: string; kind: 'weekly'; basis: 'weekly_projection' }
  | { sport: string; kind: 'per_game'; basis: 'season_per_game_league' | 'season_per_game_af_default' }
  | { sport: string; kind: 'none'; reason: string }

/** A league's `sport`, as the loaders compare it. A missing sport has always meant NFL here. */
export function normalizeWaiverSport(raw: string | null | undefined): string {
  const s = String(raw ?? 'NFL').trim().toUpperCase()
  return s || 'NFL'
}

const LABEL: Record<string, string> = {
  NFL: 'NFL',
  NCAAF: 'College football',
  NBA: 'NBA',
  NCAAB: 'College basketball',
  NHL: 'NHL',
  MLB: 'MLB',
  SOCCER: 'Soccer',
}

/** "College basketball", "NHL" — a sport as a heading. */
export function waiverSportLabel(sport: string | null | undefined): string {
  const s = normalizeWaiverSport(sport)
  return LABEL[s] ?? s
}

/** The same, mid-sentence: "college basketball", but "NBA" stays capitalised. */
function inSentence(sport: string): string {
  const label = waiverSportLabel(sport)
  return label === label.toUpperCase() ? label : label.toLowerCase()
}

/** Sports priced from a per-game season rate on AllFantasy's DEFAULT scoring. See the header. */
const AF_DEFAULT_SCORED = new Set(['NBA', 'NCAAB', 'NHL', 'MLB'])

/** What a board may price a sport's wire on, or why it cannot. */
export function waiverSportPlan(raw: string | null | undefined): WaiverSportPlan {
  const sport = normalizeWaiverSport(raw)
  if (sport === 'NFL') return { sport, kind: 'weekly', basis: 'weekly_projection' }
  if (sport === 'NCAAF') return { sport, kind: 'per_game', basis: 'season_per_game_league' }
  if (AF_DEFAULT_SCORED.has(sport)) return { sport, kind: 'per_game', basis: 'season_per_game_af_default' }
  if (sport === 'SOCCER') {
    return {
      sport,
      kind: 'none',
      reason:
        'No projection exists for soccer players: our stats provider serves no soccer player season stats, so the projection engine has nothing to project from and this wire cannot be priced.',
    }
  }
  return {
    sport,
    kind: 'none',
    reason: `No projection engine produces ${inSentence(sport)} player values, so this wire cannot be priced.`,
  }
}

/**
 * The producer exists but has written nothing for this sport. A different fact from "no producer"
 * and it gets different words — this one is expected to fix itself when the daily job runs.
 */
export function noSeasonProjectionsReason(sport: string): string {
  return `AllFantasy's ${inSentence(sport)} season projections have not been written yet, so there is nothing to price this wire with.`
}

/** One sentence naming the basis every number in a section was priced on. */
export function waiverBasisSentence(basis: WaiverValueBasis, sport: string): string {
  const label = inSentence(sport)
  if (basis === 'season_per_game_league') {
    return (
      `Per-game rates from AllFantasy's ${label} season projection, re-scored under each league's own scoring_settings. ` +
      `A season rate, not a projection for this week.`
    )
  }
  if (basis === 'season_per_game_af_default') {
    return (
      `Per-game points from AllFantasy's ${label} season projection, on AllFantasy's default ${label} scoring — ` +
      `not each league's own rules, which are written in a stat vocabulary the projection engine does not read yet. ` +
      `A season rate, not a projection for this week.`
    )
  }
  return "Weekly projections, re-scored under each league's own scoring_settings."
}

/** The short unit a per-game figure is printed with. */
export const PER_GAME_UNIT = 'pts/g'

/** True for the two season-rate bases. */
export function isPerGameBasis(basis: WaiverValueBasis | null | undefined): boolean {
  return basis === 'season_per_game_league' || basis === 'season_per_game_af_default'
}
