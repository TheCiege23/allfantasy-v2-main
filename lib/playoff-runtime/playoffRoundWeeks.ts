/**
 * Which fantasy weeks a playoff round is played in — one rule, for every reader.
 *
 * ⚠ `RedraftPlayoffRound` HAS NO `week` COLUMN. A round stores a 1-based `roundNumber` and the
 * week is derived from `playoffStartWeek` and the league's `playoffWeeksPerRound`. That derivation
 * lived inline in two places (the season-week resolver and the commissioner's standings control)
 * and both assumed one week per round, so a league that set two weeks per round in its playoff
 * settings had its bracket scored — and its season declared complete — on the wrong weeks.
 *
 * ⚠ CONSOLATION ROUNDS ARE STORED AT `100 + roundNumber` IN THE SAME TABLE. Every "last round"
 * lookup that orders by `roundNumber desc` without excluding them lands on a consolation round:
 * the season's last playoff week came out ~100 weeks late, and the rookie draft read the
 * consolation final as the championship. Use `isChampionshipRoundNumber` or
 * `CHAMPIONSHIP_ROUND_WHERE` for any query that means the title bracket.
 *
 * ⚠ THE FINAL CAN BE LONGER THAN THE OTHER ROUNDS. `championship_length` (League.settings
 * `playoff_structure`) is 2 for MLB and NHL by default, and was written at creation and shown to the
 * commissioner while every reader here played the final in `playoffWeeksPerRound` weeks — so the
 * last week of those seasons went unplayed and the title was decided on one week. The final round
 * now spans `max(playoffWeeksPerRound, championship_length)` weeks; earlier rounds are untouched,
 * and a league whose championship length is unset or no longer than its rounds plays exactly the
 * weeks it always did. It is never shorter than the other rounds: the setting lengthens the final.
 *
 * ⚠ SERIES MODE REPLACES ALL OF THE ABOVE (lib/playoff-runtime/playoffSeries.ts). When the league's
 * `settings.playoff_series` sets best-of-N series, round `r` lasts exactly `N_r` weeks — rounds may
 * differ in length, so a round's first week is the playoff start plus every EARLIER round's length —
 * and `playoffWeeksPerRound` / `championship_length` are not read. Pass `seriesLengths` (from
 * `readPlayoffSeriesLengths`) and leave it null for cumulative mode, which is unchanged.
 */

import { seriesLengthForRound } from './playoffSeries'

/** Consolation rounds are written at this offset (`generateNflRedraftPlayoffRuntimeBracket`). */
export const CONSOLATION_ROUND_OFFSET = 100

/** Prisma `where` fragment for `RedraftPlayoffRound.roundNumber` that keeps the title bracket only. */
export const CHAMPIONSHIP_ROUND_WHERE = { lt: CONSOLATION_ROUND_OFFSET } as const

export function isChampionshipRoundNumber(roundNumber: number): boolean {
  return roundNumber >= 1 && roundNumber < CONSOLATION_ROUND_OFFSET
}

/** `League.playoffWeeksPerRound` is nullable and commissioner-set; anything unusable means one. */
export function normalizeWeeksPerRound(value: unknown): number {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n >= 1 ? n : 1
}

/**
 * The league's stored `championship_length`, or null when it has none. Read from
 * `settings.playoff_structure` first and the top level second — the order `getBracketConfigForLeague`
 * uses. Deliberately NOT the sport default: a league that never stored one keeps the final it has.
 */
export function readChampionshipLength(settings: unknown): number | null {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  const structure =
    s.playoff_structure && typeof s.playoff_structure === 'object' && !Array.isArray(s.playoff_structure)
      ? (s.playoff_structure as Record<string, unknown>)
      : {}
  const raw = structure.championship_length ?? s.championship_length
  if (raw == null || raw === '') return null
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) && n >= 1 ? n : null
}

/** How many weeks a championship round lasts: the final may run longer than the rounds before it. */
export function weeksForPlayoffRound(input: {
  roundNumber: number
  weeksPerRound?: number | null
  /** The bracket's last championship round; without it every round is a regular round. */
  finalRoundNumber?: number | null
  championshipLength?: number | null
  /** Series mode (readPlayoffSeriesLengths): the round lasts its series length, nothing else. */
  seriesLengths?: readonly number[] | null
}): number {
  if (input.seriesLengths) return seriesLengthForRound(input.seriesLengths, input.roundNumber)
  const perRound = normalizeWeeksPerRound(input.weeksPerRound)
  const isFinal =
    input.finalRoundNumber != null && Math.floor(input.roundNumber) === Math.floor(input.finalRoundNumber)
  if (!isFinal || input.championshipLength == null) return perRound
  return Math.max(perRound, normalizeWeeksPerRound(input.championshipLength))
}

type PlayoffRoundWeeksInput = {
  playoffStartWeek: number
  roundNumber: number
  weeksPerRound?: number | null
  finalRoundNumber?: number | null
  championshipLength?: number | null
  seriesLengths?: readonly number[] | null
}

/** The fantasy weeks a championship round spans, in order. */
export function playoffRoundWeeks(input: PlayoffRoundWeeksInput): number[] {
  const round = Math.max(1, Math.floor(input.roundNumber))
  const start = Math.max(1, Math.floor(input.playoffStartWeek))
  if (input.seriesLengths) {
    let first = start
    for (let r = 1; r < round; r++) first += seriesLengthForRound(input.seriesLengths, r)
    const length = seriesLengthForRound(input.seriesLengths, round)
    return Array.from({ length }, (_, i) => first + i)
  }
  const perRound = normalizeWeeksPerRound(input.weeksPerRound)
  // Only the final is ever longer, so every round's FIRST week is unchanged by championship length.
  const first = start + (round - 1) * perRound
  const length = weeksForPlayoffRound({ ...input, roundNumber: round })
  return Array.from({ length }, (_, i) => first + i)
}

/** The last fantasy week of a championship round. */
export function lastWeekOfPlayoffRound(input: PlayoffRoundWeeksInput): number {
  const weeks = playoffRoundWeeks(input)
  return weeks[weeks.length - 1]
}
