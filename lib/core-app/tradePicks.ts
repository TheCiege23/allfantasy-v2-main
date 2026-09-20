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
   * ⚠ ALWAYS NULL FOR A PICK. We hold no pick prices on this path, and a number here
   * would be invented rather than read.
   */
  value: number | null
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
export function pickAssets(v: unknown): TradeAsset[] {
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
    value: null,
  }))
}

/**
 * A trade's assets for GRADING — players carrying whatever rank the book holds, picks
 * carrying none.
 *
 * 🛑 A PICK IS AN ASSET WE CANNOT PRICE, AND SAYING SO IS THE POINT. Feeding picks in as
 * unpriced turns some letters into withheld reasons, which is the correction rather than
 * a regression: while picks were invisible, "a player and a 2027 1st for a player" was
 * graded on the two players alone. That is not neutrality — it is valuing the pick at
 * ZERO, and `tradeGrading.ts` exists to refuse exactly that. It could not, because it was
 * never told the pick was there.
 */
export function gradeableSide(
  playerIds: readonly string[],
  rankOf: (id: string) => number | null,
  picks: readonly TradeAsset[],
): Array<{ id: string; rank: number | null; rawValue: number | null }> {
  return [
    ...playerIds.map((id) => ({ id, rank: rankOf(id), rawValue: null })),
    ...picks.map((p) => ({ id: p.id, rank: null, rawValue: null })),
  ]
}

/**
 * Why a trade carries no letter.
 *
 * `describeNoSignal` answers in terms of values on file, which is right for a player
 * nobody has priced yet and misleading when the unpriced half is DRAFT PICKS: "only 2 of
 * 6 assets have values" reads as patchy data a sync might fix, when in fact we do not
 * price picks at all and no sync will change it. Naming the cause separates those two
 * claims.
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
    return `Not graded — this trade includes ${
      pickCount === 1 ? 'a draft pick' : `${pickCount} draft picks`
    }, which we do not price yet.`
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
