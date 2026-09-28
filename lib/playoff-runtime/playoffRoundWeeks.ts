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
 */

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

/** The fantasy weeks a championship round spans, in order. */
export function playoffRoundWeeks(input: {
  playoffStartWeek: number
  roundNumber: number
  weeksPerRound?: number | null
}): number[] {
  const perRound = normalizeWeeksPerRound(input.weeksPerRound)
  const round = Math.max(1, Math.floor(input.roundNumber))
  const first = Math.max(1, Math.floor(input.playoffStartWeek)) + (round - 1) * perRound
  return Array.from({ length: perRound }, (_, i) => first + i)
}

/** The last fantasy week of a championship round. */
export function lastWeekOfPlayoffRound(input: {
  playoffStartWeek: number
  roundNumber: number
  weeksPerRound?: number | null
}): number {
  const weeks = playoffRoundWeeks(input)
  return weeks[weeks.length - 1]
}
