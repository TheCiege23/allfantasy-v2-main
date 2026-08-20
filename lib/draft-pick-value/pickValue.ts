/**
 * What a draft pick is worth, in THIS league.
 *
 * 8b's pick-trade panel promises a verdict "evaluated against this league's pick values", and
 * nothing computed one — both verdicts in that panel come from an AI review the user has to
 * trigger. This is the deterministic half.
 *
 * ── THE CURVE IS READ FROM THE BOARD, NOT ASSUMED ──────────────────────────────────────────
 * Pick-value charts are famously convex: 1.01 is worth far more than 1.02, and by round 4 the
 * gaps have flattened to nearly nothing. The tempting shortcut is to invent that curve —
 * `100 * (1 - overall/poolSize)` or a hand-tuned table. Both are wrong here for the same reason:
 * they describe SOME league, not this one. A 12-team superflex rookie draft and a 10-team standard
 * redraft have genuinely different curves because their boards do.
 *
 * So a pick's value is the score of the player expected to be there — the Nth-best player on this
 * league's own scored board, where N is the pick's overall position. The convexity falls out of
 * the board's real distribution instead of being asserted. That also makes the phrase "this
 * league's pick values" literally true: change the scoring settings and the board reorders, so the
 * curve moves with it.
 *
 * ⚠ This deliberately does NOT blend external value sources. Repo experience is that value
 * blending has to happen in RANK space and that linear normalisation across sources is refuted;
 * a pick curve derived from one already-ranked board sidesteps that entirely rather than
 * pretending to solve it.
 *
 * ⚠ Every function degrades to null rather than guessing. A pick beyond the end of the board has
 * no expected player, so it has no value — not a zero, which would read as "worthless" when the
 * truth is "unknown".
 */

/** One scored board row. Only the ordering signal is needed — this is engine-agnostic. */
export interface ScoredBoardRow {
  /** Higher is better. `totalScore` from the recommendation engine, or any consistent ranking. */
  score: number
}

export interface PickRef {
  round: number
  /** 1-based draft slot (team position in round one). */
  slot: number
}

export interface PickValueConfig {
  teamCount: number
  rounds: number
  /** Snake reverses even rounds. Linear drafts keep the same order every round. */
  snake: boolean
}

export type BundleVerdict = 'favorable' | 'even' | 'unfavorable'

/**
 * Board position of a pick, 1-based.
 *
 * Snake reverses even rounds — slot 1 picks last in round two. Getting this wrong silently
 * mis-values every pick in an even round, and the error is largest at the edges of the order,
 * which is exactly where pick trades happen.
 */
export function overallForPick(pick: PickRef, config: PickValueConfig): number | null {
  const { teamCount, rounds, snake } = config
  if (!Number.isFinite(teamCount) || teamCount < 1) return null
  if (!Number.isFinite(rounds) || rounds < 1) return null
  if (pick.round < 1 || pick.round > rounds) return null
  if (pick.slot < 1 || pick.slot > teamCount) return null

  const slotInRound = snake && pick.round % 2 === 0 ? teamCount - pick.slot + 1 : pick.slot
  return (pick.round - 1) * teamCount + slotInRound
}

/**
 * Replacement level: the score of the last player who will be drafted at all.
 *
 * ⚠ WITHOUT THIS, QUANTITY ALWAYS WINS AND THE VERDICT IS USELESS.
 * A raw board score carries a large floor — the "is an NFL player" component that every drafted
 * player shares. Summing raw scores therefore counts that floor once per pick, so two late picks
 * beat one early pick essentially always, which is the exact error a pick-value chart exists to
 * prevent. Measuring each pick as SURPLUS over the last drafted player strips the shared floor and
 * leaves only what the pick actually buys you over doing nothing.
 *
 * The baseline is drawn from this board too, so it moves with league size and depth: a 4-round
 * rookie draft has a much higher replacement level than a 20-round redraft, and picks are worth
 * correspondingly less.
 */
export function replacementScore(
  board: readonly ScoredBoardRow[],
  config: PickValueConfig,
): number | null {
  const totalPicks = config.teamCount * config.rounds
  if (!Number.isFinite(totalPicks) || totalPicks < 1) return null
  // If the board is shorter than the draft, the worst listed player is the best baseline we have.
  const idx = Math.min(totalPicks, board.length) - 1
  const row = board[idx]
  return row && Number.isFinite(row.score) ? row.score : null
}

/**
 * Value of a single pick: how much better the player expected there is than a freely available
 * one. See {@link replacementScore} for why this is a surplus and not a raw score.
 *
 * Null when the pick falls past the end of the scored board — a pick nobody can name a player for
 * is unknown, not worthless. Clamped at zero: a pick cannot be worth less than not picking.
 */
export function valuePick(
  pick: PickRef,
  board: readonly ScoredBoardRow[],
  config: PickValueConfig,
): number | null {
  const overall = overallForPick(pick, config)
  if (overall == null) return null
  const row = board[overall - 1]
  if (!row || !Number.isFinite(row.score)) return null
  const baseline = replacementScore(board, config)
  if (baseline == null) return null
  return Math.max(0, row.score - baseline)
}

export interface BundleValue {
  total: number
  /** Picks that could be valued. */
  valued: PickRef[]
  /** Picks with no expected player on this board — reported, never silently treated as zero. */
  unvalued: PickRef[]
}

/** Sum a side of a trade, keeping unvaluable picks visible. */
export function valueBundle(
  picks: readonly PickRef[],
  board: readonly ScoredBoardRow[],
  config: PickValueConfig,
): BundleValue {
  const valued: PickRef[] = []
  const unvalued: PickRef[] = []
  let total = 0
  for (const p of picks) {
    const v = valuePick(p, board, config)
    if (v == null) unvalued.push(p)
    else {
      valued.push(p)
      total += v
    }
  }
  return { total, valued, unvalued }
}

export interface BundleComparison {
  verdict: BundleVerdict
  giveTotal: number
  getTotal: number
  /** Positive means the incoming side is worth more. */
  delta: number
  /** True when either side had a pick this board cannot value — the verdict is then partial. */
  incomplete: boolean
  give: BundleValue
  get: BundleValue
}

/**
 * Compare what you give against what you get.
 *
 * ⚠ "even" IS A REAL ANSWER AND HAS A REAL BAND. Two picks a fraction of a point apart are not
 * meaningfully different, and reporting that as "favorable" would dress noise up as an edge — the
 * same failure as a trade grade that means nothing. The band is relative to the size of the deal,
 * because half a point matters between two late picks and is rounding between two firsts.
 *
 * ⚠ A verdict computed over a partial bundle is flagged `incomplete`. The caller must say so
 * rather than presenting it as a full evaluation.
 */
export function comparePickBundles(
  give: readonly PickRef[],
  get: readonly PickRef[],
  board: readonly ScoredBoardRow[],
  config: PickValueConfig,
  /** Fraction of the larger side within which the sides count as even. */
  evenBandRatio = 0.08,
): BundleComparison {
  const giveValue = valueBundle(give, board, config)
  const getValue = valueBundle(get, board, config)
  const delta = getValue.total - giveValue.total
  const scale = Math.max(Math.abs(giveValue.total), Math.abs(getValue.total))
  const band = scale * evenBandRatio

  const verdict: BundleVerdict =
    Math.abs(delta) <= band ? 'even' : delta > 0 ? 'favorable' : 'unfavorable'

  return {
    verdict,
    giveTotal: giveValue.total,
    getTotal: getValue.total,
    delta,
    incomplete: giveValue.unvalued.length > 0 || getValue.unvalued.length > 0,
    give: giveValue,
    get: getValue,
  }
}

/** `1.04` — how a manager says a pick out loud. */
export function formatPick(pick: PickRef): string {
  return `${pick.round}.${String(pick.slot).padStart(2, '0')}`
}
