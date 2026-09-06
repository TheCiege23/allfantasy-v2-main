import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

/**
 * Whether a club plays this week, is on a bye, or is simply not on the
 * schedule we hold — three different claims, kept apart on purpose.
 *
 * ⚠ THERE IS NO BYE COLUMN TO READ. `fantasy_players.bye_week` exists in the
 * schema and holds ZERO NFL rows with no writer (measured 2026-09-06). So a
 * bye is inferred from a club's absence from the week's fixture map — and an
 * absent club is ALSO what a missing fixture looks like. The rule below says
 * "bye" only when the absence has the shape of a real NFL bye slate: a bye
 * week (5–14), an even number of absent clubs, between two and six of them.
 * Anything else reads "no game on the schedule", which is what we know.
 *
 * MEASURED AGAINST THE REAL SEASON (2026-09-06, production, thesportsdb rows,
 * distinct clubs per week): weeks 5–14 hold 30/28/28/28/30/28/26/32/28/30
 * clubs — every absence even and inside the window, week 12 a full slate —
 * so the rule fires on every real bye week and declines the one that is not.
 * An earlier note here said the schedule on disk covered only Week 1; that
 * came from a query filtered to one provider, and it was wrong: the season
 * is on file, weeks 1–18. The conservative "no game on the schedule" reading
 * remains the fallback for a gap, not the common case.
 *
 * ⚠ CLUB VOCABULARY. Across ALL providers the season's rows carry more than
 * 32 spellings of the 32 clubs (week 4 shows 84 home/away slots against a
 * ceiling of 64); the map is built through normalizeTeamAbbrev so spellings
 * fold, but a spelling it cannot fold would make a club look absent and
 * manufacture a bye. ⚠ AND THE FOLDER NEVER SAYS SO — it returns an unknown
 * spelling upper-cased, never null — so weekKickoffs keys only CANONICAL
 * clubs and unresolvedClubNames counts the rest (playerGame.ts); the caller
 * passes that count here and a non-zero one refuses the bye judgement. Weeks
 * 5–14 carry only rolling_insights and thesportsdb rows, which share one set
 * of full club names. Client-safe.
 */

export const NFL_CLUBS = 32
export const BYE_WEEKS: readonly [number, number] = [5, 14]

export type ByeStatus = 'playing' | 'bye' | 'no-game' | 'unknown'

export function byeStatus(
  team: string | null | undefined,
  kickoffs: Record<string, string>,
  week: number | null | undefined,
  /** Club names in the week's rows the folder could not resolve (playerGame.ts unresolvedClubNames). */
  unresolved: number = 0,
): ByeStatus {
  const onFile = Object.keys(kickoffs).length
  if (onFile === 0) return 'unknown'
  const club = normalizeTeamAbbrev(team)
  if (!club) return 'unknown'
  if (kickoffs[club]) return 'playing'
  /*
   * ⚠ A SLATE THAT CANNOT BE JUDGED IS NOT A BYE. An unresolved name means a
   * club was left out of the map and now looks absent; more than 32 keys
   * would mean the map stopped keying canonical clubs only (a belt for the
   * braces in weekKickoffs). Either way the absent count is not a count of
   * byes, so the answer is "unknown" — never a manufactured bye.
   */
  if (onFile > NFL_CLUBS || unresolved > 0) return 'unknown'
  const absent = NFL_CLUBS - onFile
  const byeWeek = week != null && week >= BYE_WEEKS[0] && week <= BYE_WEEKS[1]
  if (byeWeek && absent >= 2 && absent <= 6 && absent % 2 === 0) return 'bye'
  return 'no-game'
}

/** The chip for a club that is not playing: "Bye · wk 9" or "No game on the schedule". Null when he plays or we cannot tell. */
export function byeChip(status: ByeStatus, week: number | null | undefined): { label: string; tone: 'bad' | 'warn' } | null {
  if (status === 'bye') return { label: week != null ? `Bye · wk ${week}` : 'Bye', tone: 'bad' }
  if (status === 'no-game') return { label: 'No game on the schedule', tone: 'warn' }
  return null
}
