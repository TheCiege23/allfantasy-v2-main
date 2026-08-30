/**
 * ADP that works at every league size, by normalising picks to rounds and projecting back.
 *
 * 🛑 THE PROBLEM THIS SOLVES, MEASURED. `teamCount` is one of the seven fields in the context
 * hash, so a 14-team league can only ever read a 14-team board. Our corpus is overwhelmingly
 * 12-team, so on 2026-08-30 production held 170 boards and every league that was not 12-team read
 * em-dashes: 8-team, 14-team, 22-team and 27-team leagues all showed nothing. Separately, 25,261
 * of 27,742 rows sat on `draftType: 'imported'`, which no league can resolve to at all.
 *
 * ⚠ THE OBVIOUS FIX — DROPPING teamCount FROM THE KEY — IS WRONG, AND EXPENSIVELY SO.
 * Overall pick number is not comparable across league sizes. Pick 13 is the first pick of round 2
 * in a 12-team draft and still round 1 in a 14-team draft. Pooling raw overall picks would report
 * a player as "drafted at 13" in leagues where that means two different things, and the error
 * grows with the size gap: at 27 teams it is more than a full round.
 *
 * What IS comparable is the position in ROUNDS:
 *
 *     rounds = overall / teamCount
 *
 * A player taken at overall 13 in a 12-team draft sits at 1.08 rounds. Project that into a 14-team
 * league and it is overall 15.2 — which is the same market position, expressed in that league's
 * geometry. That is the transform below, and it is exact rather than a heuristic: it is the
 * definition of a draft round.
 *
 * ⚠ EXACT-CONTEXT DATA STILL WINS WHERE IT EXISTS. This is a FILL, not a replacement. A board
 * built from real 14-team drafts describes 14-team behaviour including its own tier breaks and
 * positional runs; a projection from 12-team data is an estimate of the same thing. Callers use
 * the exact board first and fill only the players it does not carry, and every filled entry is
 * marked so a surface can say so rather than implying a precision it does not have.
 *
 * ⚠ AUCTION BOARDS ARE EXCLUDED FROM THE POOL FOR NON-AUCTION READERS, AND THE IMPORTED ONES
 * CANNOT BE. In an auction, `pick_no` is nomination order and carries almost no information about
 * player value, so folding auctions into a snake projection would be noise presented as signal.
 * Boards that declare `draftType: 'auction'` are dropped. Boards marked `imported` MAY contain
 * auctions — `DraftFact` records no draft type, which is exactly why they were quarantined — so
 * the pool uses a SAMPLE-WEIGHTED MEDIAN rather than a mean. A minority of auction-shaped rows
 * shifts a median far less than it drags an average, and the alternative to including them is the
 * status quo: nothing at all for most league sizes.
 */

/** One snapshot row, reduced to what the projection needs. */
export interface CrossSizeRow {
  playerKey: string
  playerName: string
  /** The board's own team count. Rows with a non-positive count cannot be normalised. */
  teamCount: number
  /** The board's draft type, so auctions can be excluded. */
  draftType: string
  averageOverallPick: number
  sampleSize: number
}

export interface CrossSizeEntry {
  playerKey: string
  playerName: string
  /** Overall pick projected into the caller's league size. */
  adp: number
  /** Total picks behind the projection, summed across the boards that contributed. */
  sampleSize: number
  /** Distinct league sizes that contributed, so a surface can say how broad the base is. */
  contributingTeamCounts: number[]
  /** How many distinct boards were pooled. */
  boardCount: number
}

/** Rounds-from-start for a pick. `overall` is 1-based; a 1st overall pick is 1/teamCount rounds. */
export function toRounds(overall: number, teamCount: number): number {
  if (!Number.isFinite(overall) || !Number.isFinite(teamCount) || teamCount <= 0) return Number.NaN
  return overall / teamCount
}

/** Inverse of `toRounds` — the overall pick that position corresponds to at `teamCount`. */
export function toOverall(rounds: number, teamCount: number): number {
  if (!Number.isFinite(rounds) || !Number.isFinite(teamCount) || teamCount <= 0) return Number.NaN
  return rounds * teamCount
}

/**
 * Weighted median of (value, weight) pairs.
 *
 * ⚠ A MEDIAN, NOT A MEAN, AND THE REASON IS IN THE HEADER. The pool can contain auction-shaped
 * rows we cannot identify, and an auction's nomination order is close to noise. A mean lets a
 * handful of them drag a player tens of picks; a weighted median needs half the WEIGHT to move.
 *
 * Weight is sample size, so a 400-draft board counts for more than a 3-draft one, which is the
 * same principle as `sampleConfidence` in blendPolicy.ts applied to a different question.
 */
export function weightedMedian(pairs: ReadonlyArray<{ value: number; weight: number }>): number {
  const usable = pairs
    .filter((p) => Number.isFinite(p.value) && Number.isFinite(p.weight) && p.weight > 0)
    .sort((a, b) => a.value - b.value)
  if (usable.length === 0) return Number.NaN
  if (usable.length === 1) return usable[0]!.value

  const total = usable.reduce((sum, p) => sum + p.weight, 0)
  const half = total / 2
  let running = 0
  for (const p of usable) {
    running += p.weight
    if (running >= half) return p.value
  }
  return usable[usable.length - 1]!.value
}

export interface BuildCrossSizeOptions {
  /** The league size to project into. */
  targetTeamCount: number
  /**
   * The reader's own draft type. Auction readers pool ONLY auction boards; everyone else pools
   * everything except auction boards. Mixing the two directions is what the exclusion prevents.
   */
  targetDraftType: string
  /** Boards at or below this sample size are ignored entirely — one pick is not a market. */
  minBoardSampleSize?: number
}

export const DEFAULT_MIN_BOARD_SAMPLE = 1

/**
 * Pool snapshot rows from every league size into one board projected to `targetTeamCount`.
 *
 * Rows are grouped by `playerKey`, each row's `averageOverallPick` is converted to rounds using
 * ITS OWN board's team count, the rounds are combined by weighted median, and the result is
 * projected back into the target size.
 */
export function buildCrossSizeBoard(
  rows: readonly CrossSizeRow[],
  options: BuildCrossSizeOptions,
): Map<string, CrossSizeEntry> {
  const out = new Map<string, CrossSizeEntry>()
  const { targetTeamCount, targetDraftType } = options
  if (!Number.isFinite(targetTeamCount) || targetTeamCount <= 0) return out

  const minSample = options.minBoardSampleSize ?? DEFAULT_MIN_BOARD_SAMPLE
  const wantsAuction = String(targetDraftType).trim().toLowerCase() === 'auction'

  const grouped = new Map<string, CrossSizeRow[]>()
  for (const row of rows) {
    if (!row.playerKey || !Number.isFinite(row.teamCount) || row.teamCount <= 0) continue
    if (!Number.isFinite(row.averageOverallPick) || row.averageOverallPick <= 0) continue
    if (row.sampleSize < minSample) continue

    const isAuction = String(row.draftType).trim().toLowerCase() === 'auction'
    // An auction reader wants auction evidence only; everyone else wants everything but auctions.
    if (isAuction !== wantsAuction) continue

    const bucket = grouped.get(row.playerKey) ?? []
    bucket.push(row)
    grouped.set(row.playerKey, bucket)
  }

  for (const [playerKey, bucket] of grouped) {
    const pairs = bucket.map((r) => ({
      value: toRounds(r.averageOverallPick, r.teamCount),
      weight: r.sampleSize,
    }))
    const rounds = weightedMedian(pairs)
    if (!Number.isFinite(rounds)) continue

    const projected = toOverall(rounds, targetTeamCount)
    if (!Number.isFinite(projected) || projected <= 0) continue

    out.set(playerKey, {
      playerKey,
      playerName: bucket[0]!.playerName,
      adp: Math.round(projected * 100) / 100,
      sampleSize: bucket.reduce((sum, r) => sum + r.sampleSize, 0),
      contributingTeamCounts: [...new Set(bucket.map((r) => r.teamCount))].sort((a, b) => a - b),
      boardCount: bucket.length,
    })
  }

  return out
}
