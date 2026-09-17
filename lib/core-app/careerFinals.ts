/**
 * Career "Finals" — which of your league-seasons ended in the title game.
 *
 * ⚠ SLEEPER ONLY, AND ONLY WHERE A BRACKET WAS STORED. The one source that says who lost a
 * final is the winners bracket the historical sync keeps in
 * `league_dynasty_seasons.metadata.playoffStructure`. Every other source stores the champion
 * and nothing about the other side of the title game, so their seasons stay unknown here —
 * never "missed the final".
 *
 * Three parts: the loader (`career.ts`) reads the stored rows, `careerFinalsResolve.ts` turns
 * them into a result per league-season, and this file sums those results for the tile. This
 * half is imported by client components through `careerModel.ts`, so it imports nothing.
 */

/** `won` / `lost` — you played the title game; `out` — the final was decided without you. */
export type FinalResult = 'won' | 'lost' | 'out'

/** The Finals tile, from counted career rows. */
export type FinalsSummary = {
  /** Title games played — titles plus finals lost. Null when no counted season has a bracket to read. */
  finals: number | null
  won: number
  lost: number
  /** Counted seasons whose final can be judged: a title, or a stored bracket naming the result. */
  known: number
  /** Counted seasons with a stored bracket verdict. */
  withBracket: number
  /** Counted seasons in all. */
  total: number
  /**
   * Seasons whose bracket says you WON the title but whose source does not record the title.
   * Reported, not counted: what counts as a title is decided elsewhere.
   */
  uncountedTitleWins: number
  note: string
}

export const FINALS_NOTE_NO_BRACKET =
  'Only a stored Sleeper playoff bracket says who lost a final, and none of these seasons has one, so title-game appearances cannot be counted.'

/**
 * ⚠ FINALS = TITLES + FINALS LOST, SO THE TWO TILES CANNOT DISAGREE. The championship count
 * comes from each source's own title flag; a lost final comes from the bracket. A season whose
 * bracket says you won but whose row carries no title is counted in neither and reported in
 * `uncountedTitleWins`, rather than quietly making Finals larger than titles + losses.
 */
export function summarizeFinals(
  rows: ReadonlyArray<{ counted: boolean; isChampion: boolean; finalResult?: FinalResult | null }>,
): FinalsSummary {
  let won = 0
  let lost = 0
  let known = 0
  let withBracket = 0
  let total = 0
  let uncountedTitleWins = 0
  for (const r of rows) {
    if (!r.counted) continue
    total += 1
    const verdict = r.finalResult ?? null
    if (verdict != null) withBracket += 1
    if (r.isChampion) {
      won += 1
      known += 1
    } else if (verdict === 'won') {
      uncountedTitleWins += 1
    } else if (verdict === 'lost') {
      lost += 1
      known += 1
    } else if (verdict === 'out') {
      known += 1
    }
  }
  if (withBracket === 0) {
    return { finals: null, won, lost, known, withBracket, total, uncountedTitleWins, note: FINALS_NOTE_NO_BRACKET }
  }
  const unchecked = total - known - uncountedTitleWins
  const note =
    unchecked > 0
      ? `Finals lost are read from stored Sleeper playoff brackets. ${unchecked.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} finished league-seasons have no bracket to check, so a final lost there is not counted.`
      : 'Finals lost are read from stored Sleeper playoff brackets; every finished league-season could be checked.'
  return { finals: won + lost, won, lost, known, withBracket, total, uncountedTitleWins, note }
}
