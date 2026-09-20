/**
 * Traded draft picks, and why a trade carries no grade.
 *
 * 🛑 THIS MODULE EXISTS BECAUSE TWO SCREENS READ THE SAME TWO COLUMNS AND NEITHER READ
 * THEM. `LeagueTrade.picksGiven`/`picksReceived` have been written on every sync since
 * `persistTradesForSeason` was first called, and both `/core/trades` (the cross-league
 * board) and the per-league trades screen built their assets from `playersGiven` and
 * `playersReceived` alone. The board therefore printed "Picks or FAAB only — no players
 * on this side" over a side holding three real 2027 picks, and BOTH screens graded a
 * players-and-picks trade on the players alone — which values the pick at zero and
 * mechanically favours whichever side gave it.
 *
 * It is deliberately pure — no prisma, no `server-only`, no clock — so the rules can be
 * asserted directly rather than through a database mock, and so neither screen has to
 * import the other to share them.
 */
import { describeNoSignal, type TradeGrade } from '@/lib/projections/tradeGrading'

export type TradeAsset = {
  /**
   * A Sleeper player id when `kind` is `'player'`, or a synthetic
   * `pick:<season>:<round>:<n>` key when it is `'pick'`.
   *
   * 🛑 READ `kind` BEFORE READING THIS. A synthetic pick key is a non-empty string, so
   * handing it to a player lookup does not degrade to text — it opens the wrong card.
   * The discriminator is the reason picks were safe to render at all.
   */
  id: string
  /** Which of the two shapes `id` holds. */
  kind: 'player' | 'pick'
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
  /**
   * Market value, when a snapshot prices him. Null is common and is not zero.
   *
   * ⚠ THIS USED TO READ "ALWAYS NULL FOR A PICK", AND THAT IS NO LONGER TRUE.
   * `ingestPlayerValues` stored FantasyCalc's draft-pick rows from 2026-09-20, so a pick
   * whose (season, round) matches a stored row now carries a real market price from the
   * SAME book as the players beside it. Null still means unpriced and still is not zero.
   */
  value: number | null
  /**
   * The season a pick conveys, as stored — `'2027'`. Set on picks only.
   *
   * ⚠ KEPT AS A FIELD RATHER THAN PARSED BACK OUT OF `id`. The id is a synthetic display
   * key whose trailing index exists to stop two identical picks colliding in React; making
   * the pricing path re-parse it would couple the price to a rendering detail.
   */
  pickSeason?: string
  /** The round a pick conveys, as stored — `1`. Set on picks only. */
  pickRound?: number
}

export function ordinal(n: number): string {
  const teens = n % 100
  if (teens >= 11 && teens <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

/**
 * The draft picks on one side of a trade, as printable assets.
 *
 * ⚠ THE STORED SHAPE IS `{ season, round }` AND NOTHING ELSE. `persistTradesForSeason`
 * writes exactly those two fields, so "2027 1st" is the whole truth we hold — Sleeper's
 * own "2027 1st Rd via Byerly" needs the pick's ORIGINAL owner, which is dropped at
 * write time. Printing an owner we do not have would be worse than printing less.
 *
 * ⚠ AND THE INDEX IS PART OF THE KEY ON PURPOSE. A side can hold TWO 2027 1sts — the
 * KBFL trade that prompted this does — and keyed on season and round alone they collide,
 * so React renders one row where two assets moved.
 *
 * Anything unparseable is dropped rather than guessed at: the column is untyped JSON
 * written by two different importers, and a row that does not carry a season and a
 * finite round is not a pick we can name.
 */
export function pickAssets(v: unknown, price?: PickPricer): TradeAsset[] {
  if (!Array.isArray(v)) return []
  const parsed: Array<{ season: string; round: number }> = []
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue
    const p = raw as Record<string, unknown>
    const season = String(p.season ?? '').trim()
    const round = Number(p.round ?? 0)
    if (!season || !Number.isFinite(round) || round < 1) continue
    parsed.push({ season, round })
  }
  parsed.sort((a, b) => (a.season === b.season ? a.round - b.round : a.season < b.season ? -1 : 1))
  return parsed.map((p, i) => ({
    id: `pick:${p.season}:${p.round}:${i}`,
    kind: 'pick' as const,
    name: `${p.season} ${ordinal(p.round)}`,
    position: null,
    team: null,
    imageUrl: null,
    value: price?.(p.season, p.round)?.value ?? null,
    pickSeason: p.season,
    pickRound: p.round,
  }))
}

/**
 * What a (season, round) is worth, in the two currencies the screens need.
 *
 * `rank` is the grading currency and `value` is the display one — see `pickPricerFrom`
 * for why the rank is a MEAN OF RANKS rather than a rank derived from the mean value.
 */
export type PickPrice = { rank: number; value: number }

/** Prices one stored pick. Returns null when the book holds no row for it. */
export type PickPricer = (season: string, round: number) => PickPrice | null

/** A stored FantasyCalc row, narrowed to what pricing a pick needs. */
export type PickValueRow = { name: string; value: number; overallRank: number | null }

/**
 * `"2026 Pick 1.01"` and `"2027 1st (Early)"` → `{ season, round }`.
 *
 * ⚠ FANTASYCALC NAMES PICKS TWO DIFFERENT WAYS AND BOTH ARE LIVE IN ONE RESPONSE.
 * Near picks, whose slot is known once the standings settle, come back per SLOT
 * (`2026 Pick 1.01`); far picks come back per BUCKET (`2027 1st (Early)`). Measured
 * examples are recorded in `lib/chimmy/tools/availablePlayersTool.ts`. A parser that
 * knows only one form silently prices half the board at nothing.
 *
 * Returns null for anything else, including a player name that happens to start with a
 * year — the caller filters on `position === 'PICK'` first, and this is the second gate.
 */
export function parsePickRowName(name: string): { season: string; round: number } | null {
  const text = String(name ?? '').trim()
  // "2026 Pick 1.01" — the slot is deliberately discarded; see `pickPricerFrom`.
  const slot = /^(\d{4})\s+Pick\s+(\d+)\.(\d+)\s*$/i.exec(text)
  if (slot) {
    const round = Number(slot[2])
    return Number.isFinite(round) && round >= 1 ? { season: slot[1], round } : null
  }
  // "2027 1st (Early)", "2027 1st" — bucket optional.
  const bucket = /^(\d{4})\s+(\d+)(?:st|nd|rd|th)\b/i.exec(text)
  if (bucket) {
    const round = Number(bucket[2])
    return Number.isFinite(round) && round >= 1 ? { season: bucket[1], round } : null
  }
  return null
}

/**
 * Build a pricer from this book's stored pick rows.
 *
 * 🛑 THE MEAN IS TAKEN OVER RANKS, NOT OVER VALUES, AND THAT IS A DELIBERATE CHOICE
 * BETWEEN TWO DEFENSIBLE ANSWERS.
 *
 * We store a traded pick as `{ season, round }` and nothing else — Sleeper's slot and
 * original owner are dropped at write time — so a bare "2027 1st" has to stand for every
 * slot in that round. Averaging is the user's decision (2026-09-20): treat an unknown slot
 * as genuinely unknown rather than assuming a good or a bad one.
 *
 * The averaging could happen in either currency, and they do not give the same number
 * because the rank→value curve is convex:
 *
 *   • mean of VALUES, then invert the curve to a rank — the exact expected value, but it
 *     asserts that `DEFAULT_RANK_CURVE`'s value scale IS `PlayerValueSnapshot.value`'s.
 *     Both are FantasyCalc, so that is probably true; "probably" is the problem. A wrong
 *     scale here does not fail — it prices every pick trade confidently and wrongly, which
 *     is the one outcome `tradeGrading.ts` exists to prevent.
 *   • mean of RANKS — needs no scale claim at all. FantasyCalc ranks picks in the SAME
 *     `overallRank` sequence as players, so a pick's rank is already the interchange format
 *     this module is built on, and `sideMath` then converts it exactly as it converts every
 *     player's. The cost is second-order: the mean rank prices slightly differently from the
 *     mean value across the bucket span.
 *
 * The second is taken because its failure mode is a small known bias and the first's is a
 * silent wrong answer. `value` is still the mean of values — it is only ever DISPLAYED,
 * never summed, so it carries no scale risk.
 *
 * ⚠ A ROW WITH NO `overallRank` IS SKIPPED FOR RANK AND STILL COUNTED FOR VALUE. They are
 * different questions, and dropping a priced row from the display average because it lacks
 * a rank would hide a price we hold.
 */
export function pickPricerFrom(rows: readonly PickValueRow[]): PickPricer {
  const ranks = new Map<string, number[]>()
  const values = new Map<string, number[]>()
  for (const r of rows) {
    const parsed = parsePickRowName(r.name)
    if (!parsed) continue
    const key = `${parsed.season}:${parsed.round}`
    if (Number.isFinite(r.value)) {
      const v = values.get(key)
      if (v) v.push(r.value)
      else values.set(key, [r.value])
    }
    if (r.overallRank != null && Number.isFinite(r.overallRank) && r.overallRank >= 1) {
      const a = ranks.get(key)
      if (a) a.push(r.overallRank)
      else ranks.set(key, [r.overallRank])
    }
  }
  const mean = (xs: number[] | undefined) =>
    xs && xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null

  return (season, round) => {
    const key = `${String(season).trim()}:${round}`
    const rank = mean(ranks.get(key))
    const value = mean(values.get(key))
    // A pick without a RANK cannot be graded, so it is not a price — see `gradeableSide`.
    if (rank == null) return null
    return { rank, value: value ?? 0 }
  }
}

/**
 * A trade's assets for GRADING — every asset carrying whatever rank the book holds.
 *
 * 🛑 PICKS NOW CARRY A RANK WHEN THE BOOK PRICES THEM, AND `price` IS WHAT DECIDES.
 * Omit it and picks enter unpriced, which is the pre-2026-09-20 behaviour and still the
 * honest answer for a caller that has not loaded pick rows: an unpriced asset withholds
 * the letter rather than counting as zero. `tradeGrading.ts` refuses to grade a partially
 * covered trade precisely so that a missing price cannot be silently read as worthless.
 *
 * ⚠ A PICK THE BOOK DOES NOT HOLD STAYS UNPRICED RATHER THAN FALLING BACK TO A MODEL.
 * This repo contains FIVE hand-built pick curves that disagree by up to 4.6x by the third
 * round (see `scripts/probe-pick-curve.ts`), so a fallback would not be a safety net — it
 * would be an arbitrary choice among five, printed with the same confidence as a real
 * market price and indistinguishable from one on screen.
 */
export function gradeableSide(
  playerIds: readonly string[],
  rankOf: (id: string) => number | null,
  picks: readonly TradeAsset[],
  price?: PickPricer,
): Array<{ id: string; rank: number | null; rawValue: number | null }> {
  const pickRank = (p: TradeAsset): number | null => {
    if (!price || !p.pickSeason || p.pickRound == null) return null
    return price(p.pickSeason, p.pickRound)?.rank ?? null
  }
  return [
    ...playerIds.map((id) => ({ id, rank: rankOf(id), rawValue: null })),
    ...picks.map((p) => ({ id: p.id, rank: pickRank(p), rawValue: null })),
  ]
}

/**
 * Why a trade carries no letter.
 *
 * `describeNoSignal` answers in terms of values on file, which is right for a player
 * nobody has priced yet and vague when the unpriced half is DRAFT PICKS. Naming the cause
 * separates the two claims.
 *
 * ⚠ THE WORDING CHANGED WITH THE FACTS ON 2026-09-20. It used to say picks were something
 * "we do not price yet", which was true while `ingestPlayerValues` discarded every pick row
 * FantasyCalc sends. We store them now, so an unpriced pick is a GAP IN THE BOOK — a season
 * or round the market has no row for — not a category we refuse to price. Telling a manager
 * to stop waiting for something that has already arrived is its own kind of wrong.
 *
 * ⚠ ONLY WHEN THE PICKS ARE THE WHOLE GAP. A trade that is also missing a player's value
 * falls back to the generic reason, because blaming the picks there would be a confident
 * half-truth — and `NO_ASSETS` keeps its own wording, since an empty side is a different
 * fact from an unpriced one.
 */
export function withheldTradeReason(
  grade: Extract<TradeGrade, { graded: false }>,
  pickCount: number,
): string {
  const unpriced = grade.total - grade.covered
  if (grade.reason !== 'NO_ASSETS' && pickCount > 0 && unpriced === pickCount) {
    return `Not graded — no market price on file for ${
      pickCount === 1 ? 'the draft pick' : `the ${pickCount} draft picks`
    } in this trade.`
  }

  /*
   * ⚠ "ASSETS", NOT "PLAYERS", AND SAID HERE RATHER THAN IN `describeNoSignal`.
   * `grade.total` counts picks now, so "6 players" would be a wrong noun bolted to a
   * right number.
   *
   * 🛑 AND THE REASON IT IS RESTATED INSTEAD OF CORRECTED AT SOURCE IS NOT TIDINESS.
   * `lib/projections/tradeGrading.ts` carries two decision-engine boundary violations
   * that predate this change — `gradeTrade` and `evaluateTrade` are verdict-shaped
   * exports living outside `lib/decision-os/`, unchanged on `main` — and
   * `check-decision-engine-boundary.mjs` runs in `--changed` mode, so ANY edit to that
   * file, including a three-word copy fix 180 lines away from either of them, fails CI.
   * Clearing them means moving both functions into `lib/decision-os/trade/` and
   * repointing their callers; that is a real piece of work and it is not this one.
   * `describeNoSignal` keeps `NO_ASSETS`, which is an empty side rather than a coverage
   * count and is right in both vocabularies.
   */
  if (grade.reason === 'PARTIAL_COVERAGE') {
    return `Not graded — only ${grade.covered} of ${grade.total} assets have values on file.`
  }
  if (grade.reason === 'NO_COVERAGE') {
    return 'Not graded — no values on file for anything in this trade.'
  }
  return describeNoSignal(grade)
}

/**
 * The order that decides which trade is "the latest one", shared by both trade screens.
 *
 * 🛑 IT IS `tradeDate`, AND IT USED TO BE `(season, week, …)` — WHICH IS HOW A JULY TRADE
 * OUTRANKED A SEPTEMBER ONE ON A LIVE SCREEN. Sleeper stamps a trade with the LEG it was
 * fetched under, and every offseason trade in a league lands on the same leg;
 * `persistLiveTrades` writes 0 outright for a provider that carries no week. So "highest
 * week wins" is not "most recent wins", and within one leg the tie fell to `historyId` —
 * a cuid, which is to say it fell to nothing. `tradeDate` is the platform's own `created`
 * timestamp and is the only column that answers the question being asked.
 *
 * ⚠ `nulls: 'last'` IS LOAD-BEARING. Postgres sorts NULLs FIRST under `DESC`, so a
 * historical row with no timestamp would take the "latest" slot outright.
 *
 * ⚠ AND THE TAIL IS DETERMINISM, NOT TIDINESS. The two mirrored copies of one trade tie
 * on `tradeDate` by definition; `historyId` decides which survives the collapse, and the
 * copies are INVERTED, so without it a card's two sides could swap between renders.
 */
export const LATEST_TRADE_ORDER = [
  { tradeDate: { sort: 'desc', nulls: 'last' } },
  { season: 'desc' },
  { week: 'desc' },
  { historyId: 'asc' },
] as const
