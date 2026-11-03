/**
 * "Closest without going over" — the original league's last immunity challenge (gap report §6 #62:
 * "closest to the score without going over", Price is Right). Pure: no I/O.
 *
 * HOW THE CHALLENGE BUILDER CALLS THIS (the builder owns the challenge row, the entry form and the
 * effect payout; this module owns only the scoring rule and the target):
 *
 *   1. Create a SurvivorChallenge with `challengeType: 'closest_without_going_over'`, `scope:
 *      'individual'`, and `configJson: { target: { kind: 'game_total', sportsGameId } }` for a game
 *      picked from SportsGame (or `{ kind: 'commissioner' }` when no game fits).
 *   2. Store each manager's guess as a submission (one per manager; first submission stands).
 *   3. To settle: read the SportsGame row FROM OUR DB (never a provider) and call
 *      `closestTargetFromStoredGame(row)`. A null target means the game is not final in our data:
 *      wait, or let the commissioner enter the number (`parseCommissionerTarget`).
 *   4. `settleClosestWithoutGoingOver(entries, target)` gives the winner(s); pay out individual
 *      immunity through SurvivorEffectEngine as for any challenge.
 *   5. Sealed immunity: before posting "X won immunity", call
 *      `shouldDeferImmunityAnnouncement(sealedImmunity, council)` from survivorSealedImmunity.ts and
 *      skip the post while it is true; the council close posts it (postDeferredImmunityLines).
 *
 * RULES
 *  - The best guess is the highest guess that is not above the target.
 *  - Equal guesses: the earliest submission wins (original league: "first submission").
 *  - Everyone over: `allOverRule` decides. Default 'closest_overall' — the smallest overshoot wins,
 *    so the challenge always has a winner without a re-bid round. 'no_winner' leaves it unsettled
 *    for the commissioner.
 */

export interface ClosestEntry {
  userId: string
  guess: number
  submittedAt: Date | string
}

export type ClosestAllOverRule = 'closest_overall' | 'no_winner'

export interface ClosestRanked {
  userId: string
  guess: number
  /** target - guess. Negative when over. */
  margin: number
  over: boolean
}

export interface ClosestResult {
  target: number
  winnerUserId: string | null
  /** True when every guess went over and the all-over rule applied. */
  everyoneOver: boolean
  ranked: ClosestRanked[]
}

function at(value: Date | string): number {
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER
}

export function settleClosestWithoutGoingOver(entries: ReadonlyArray<ClosestEntry>, target: number, opts: { allOverRule?: ClosestAllOverRule } = {}): ClosestResult {
  const valid = entries.filter((e) => typeof e.guess === 'number' && Number.isFinite(e.guess))
  // One entry per manager: the first submission stands.
  const firstByUser = new Map<string, ClosestEntry>()
  for (const entry of [...valid].sort((a, b) => at(a.submittedAt) - at(b.submittedAt))) if (!firstByUser.has(entry.userId)) firstByUser.set(entry.userId, entry)
  const order = [...firstByUser.values()]
  const under = order.filter((e) => e.guess <= target).sort((a, b) => b.guess - a.guess || at(a.submittedAt) - at(b.submittedAt) || a.userId.localeCompare(b.userId))
  const over = order.filter((e) => e.guess > target).sort((a, b) => a.guess - b.guess || at(a.submittedAt) - at(b.submittedAt) || a.userId.localeCompare(b.userId))
  const ranked = [...under, ...over].map((e) => ({ userId: e.userId, guess: e.guess, margin: Math.round((target - e.guess) * 100) / 100, over: e.guess > target }))
  if (under.length) return { target, winnerUserId: under[0]!.userId, everyoneOver: false, ranked }
  if (!over.length) return { target, winnerUserId: null, everyoneOver: false, ranked }
  return { target, winnerUserId: (opts.allOverRule ?? 'closest_overall') === 'closest_overall' ? over[0]!.userId : null, everyoneOver: true, ranked }
}

const FINAL_STATUS = /^(final|ft|ended|complete(d)?|closed|post|aot|ap|aet|f\/ot|final\/ot)$/i

/**
 * The target from a stored SportsGame row: the game's combined score once it is final in our data.
 * Null when the row is not final or a score is missing — then the commissioner enters the number.
 */
export function closestTargetFromStoredGame(game: { status: string | null; homeScore: number | null; awayScore: number | null } | null): number | null {
  if (!game || game.homeScore == null || game.awayScore == null) return null
  if (!FINAL_STATUS.test(String(game.status ?? '').trim())) return null
  return game.homeScore + game.awayScore
}

/** A commissioner-entered target: a non-negative number, at most two decimals. */
export function parseCommissionerTarget(input: unknown): number | null {
  const n = typeof input === 'number' ? input : typeof input === 'string' && input.trim() ? Number(input) : NaN
  if (!Number.isFinite(n) || n < 0 || n > 100000) return null
  return Math.round(n * 100) / 100
}
