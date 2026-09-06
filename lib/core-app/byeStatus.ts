import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

/**
 * Whether a club plays this week, is on a bye, or is simply not on the
 * schedule we hold — three different claims, kept apart on purpose.
 *
 * ⚠ THERE IS NO BYE COLUMN TO READ. `fantasy_players.bye_week` exists in the
 * schema and holds ZERO NFL rows with no writer (measured 2026-09-06), and the
 * season schedule on disk covers only the current week (16 games, all 32
 * clubs, Week 1). So a bye can only be inferred from a club's absence from
 * the week's fixture map — and an absent club is ALSO what a missing fixture
 * looks like. The rule below says "bye" only when the absence has the shape
 * of a real NFL bye slate: a bye week (5–14), an even number of absent clubs,
 * between two and six of them. Anything else reads "no game on the schedule",
 * which is what we know.
 *
 * A false "bye" is still possible if a fixture is missing in a bye week; the
 * shape check narrows it, it does not close it. Client-safe.
 */

export const NFL_CLUBS = 32
export const BYE_WEEKS: readonly [number, number] = [5, 14]

export type ByeStatus = 'playing' | 'bye' | 'no-game' | 'unknown'

export function byeStatus(team: string | null | undefined, kickoffs: Record<string, string>, week: number | null | undefined): ByeStatus {
  const onFile = Object.keys(kickoffs).length
  if (onFile === 0) return 'unknown'
  const club = normalizeTeamAbbrev(team)
  if (!club) return 'unknown'
  if (kickoffs[club]) return 'playing'
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
