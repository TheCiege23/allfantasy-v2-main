import type { ChimmyAddReceipt, StartCallReceipt, TradeReceipt, WaiverReceipt } from './decisionReceipts'
import { MIN_DECIDED_FOR_USER_RATE } from '@/lib/chimmy-outcomes/trackRecord'

/**
 * Decision record — the Career stat for "how did taking AllFantasy's advice work out", this season,
 * and since 2026-10-02 how your own moves did beside it.
 *
 * ⚠ ADVICE IS CHIMMY AND AUTOCOACH, AND IT SAYS SO (user decision 2026-10-01). Those are the only
 * advice AllFantasy STORES with what was recommended: `chimmy_advice` (start/sit, adds) and
 * `AutoCoachSwapLog`. My Team's start/sit suggestions are computed per render and kept nowhere, so a
 * record claiming to cover "AF's advice" would be claiming My Team calls it never saw.
 *
 * ⚠ YOUR MOVES ARE A SEPARATE SECTION, NOT MORE ADVICE (user decision 2026-10-02). Trades and waiver
 * adds are YOUR calls; folding them into the advice totals would credit Chimmy with a trade it never
 * suggested. They come from the same Receipts resolvers — a trade as NET POINTS since it was made
 * (never the sweep's letter, whose C band reads "average" for a trade that has produced nothing),
 * a waiver add as the points he scored while on your roster. Both are Sleeper-only today, and a
 * trade too early to call is counted, never shown as even.
 *
 * ⚠ NO SECOND SET OF RULES. Every outcome here was resolved by `decisionReceipts.ts` — the Receipts
 * card's and Chimmy's learning loop's own resolver — so "right", "followed" and "you added him" mean
 * the same thing on the home card, in what Chimmy learns, and here. This file only adds them up.
 *
 * ⚠ A RATE NEEDS A SAMPLE — the track record's own minimum (`MIN_DECIDED_FOR_USER_RATE`), never a
 * second one. Below it the counts stand alone.
 *
 * Pure, so the screen and its tests share it.
 */

export type DecisionRecord = {
  /** Start/sit calls with a final result, Chimmy's and AutoCoach's, each counted once. */
  calls: { total: number; right: number; wrong: number; same: number; ratePct: number | null }
  /** Calls your platform lineup followed, and what they gained you over the player they benched. */
  followed: { count: number; netPoints: number }
  /** Calls your lineup went against — and what the advice would have changed if you had taken it. */
  passed: { count: number; netPoints: number }
  /** Calls where the lineup cannot say which way you went (both started, or neither). */
  unclear: number
  /** Chimmy's "add X" calls: how many you took, and what those players scored while on your roster. */
  adds: { advised: number; added: number; points: number }
  bySource: { chimmy: number; autocoach: number }
  /** The followed call that paid most — the line worth quoting. Null when none paid. */
  best: (StartCallReceipt & { source: 'chimmy' | 'autocoach'; delta: number }) | null
  /** Your trades this season. Null when they could not be read (no Sleeper id, no Sleeper league). */
  trades: {
    /** Trades with enough weeks behind them to call. */
    called: number
    ahead: number
    behind: number
    even: number
    /** Points credited to what you got minus what you gave, summed over the called trades. */
    netPoints: number
    /** Too few weeks (or no scores) to call yet — counted, never shown as even. */
    tooEarly: number
    /** The called trade that has paid most. Null when none is ahead. */
    best: TradeReceipt | null
  } | null
  /** Your waiver and free-agent adds this season. Null when they could not be read. */
  waivers: {
    /** Adds with enough weeks behind them to score. */
    scored: number
    /** Points those players scored while on your roster. */
    points: number
    /** Weeks they were in your starting lineup. */
    starts: number
    tooEarly: number
    /** Old enough to score, but no score rows on file — never printed as 0 points. */
    unscored: number
    /** The add that has scored most for you. */
    best: WaiverReceipt | null
  } | null
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function buildDecisionRecord(input: {
  chimmy: readonly StartCallReceipt[]
  autocoach: readonly StartCallReceipt[]
  adds: readonly ChimmyAddReceipt[]
  /** This season's called trades and the early count, from `getTradeReceipts`. Omitted = not read. */
  trades?: { receipts: readonly TradeReceipt[]; tooEarly: number } | null
  /** This season's scored adds and the withheld counts, from `getWaiverReceipts`. Omitted = not read. */
  waivers?: { receipts: readonly WaiverReceipt[]; tooEarly: number; unscored: number } | null
}): DecisionRecord | null {
  // One call, two advisers: the receipt id is the same advice key, so it counts once — as Chimmy's.
  const seen = new Set<string>()
  const calls: Array<StartCallReceipt & { source: 'chimmy' | 'autocoach' }> = []
  for (const [source, list] of [['chimmy', input.chimmy], ['autocoach', input.autocoach]] as const) {
    for (const r of list) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      calls.push({ ...r, source })
    }
  }
  const trades = input.trades
    ? {
        called: input.trades.receipts.length,
        ahead: input.trades.receipts.filter((t) => t.outcome === 'ahead').length,
        behind: input.trades.receipts.filter((t) => t.outcome === 'behind').length,
        even: input.trades.receipts.filter((t) => t.outcome === 'even').length,
        netPoints: round1(input.trades.receipts.reduce((n, t) => n + t.netPoints, 0)),
        tooEarly: input.trades.tooEarly,
        best: [...input.trades.receipts].filter((t) => t.outcome === 'ahead').sort((a, b) => b.netPoints - a.netPoints)[0] ?? null,
      }
    : null
  const waivers = input.waivers
    ? {
        scored: input.waivers.receipts.length,
        points: round1(input.waivers.receipts.reduce((n, w) => n + w.points, 0)),
        starts: input.waivers.receipts.reduce((n, w) => n + w.starts, 0),
        tooEarly: input.waivers.tooEarly,
        unscored: input.waivers.unscored,
        best: [...input.waivers.receipts].filter((w) => w.points > 0).sort((a, b) => b.points - a.points)[0] ?? null,
      }
    : null
  const anyMoves =
    (trades != null && trades.called + trades.tooEarly > 0) ||
    (waivers != null && waivers.scored + waivers.tooEarly + waivers.unscored > 0)
  if (calls.length === 0 && input.adds.length === 0 && !anyMoves) return null

  const right = calls.filter((c) => c.call === 'right').length
  const wrong = calls.filter((c) => c.call === 'wrong').length
  const same = calls.filter((c) => c.call === 'same').length
  const delta = (c: StartCallReceipt) => c.recommended.points - c.instead.points

  const followed = calls.filter((c) => c.followed === 'yes')
  const passed = calls.filter((c) => c.followed === 'no')
  const bestFollowed = [...followed].sort((a, b) => delta(b) - delta(a))[0]
  const added = input.adds.filter((a) => a.added != null)

  return {
    calls: {
      total: calls.length,
      right,
      wrong,
      same,
      ratePct: right + wrong >= MIN_DECIDED_FOR_USER_RATE ? Math.round((100 * right) / (right + wrong)) : null,
    },
    followed: { count: followed.length, netPoints: round1(followed.reduce((n, c) => n + delta(c), 0)) },
    passed: { count: passed.length, netPoints: round1(passed.reduce((n, c) => n + delta(c), 0)) },
    unclear: calls.filter((c) => c.followed === 'unclear').length,
    adds: {
      advised: input.adds.length,
      added: added.length,
      points: round1(added.reduce((n, a) => n + (a.added?.points ?? 0), 0)),
    },
    bySource: {
      chimmy: calls.filter((c) => c.source === 'chimmy').length,
      autocoach: calls.filter((c) => c.source === 'autocoach').length,
    },
    best: bestFollowed && delta(bestFollowed) > 0 ? { ...bestFollowed, delta: round1(delta(bestFollowed)) } : null,
    trades,
    waivers,
  }
}

/** "+41.2" / "−3.5" / "0" — signed, one decimal, a real minus sign. */
export function signedPoints(n: number): string {
  if (n > 0) return `+${n.toFixed(1)}`
  if (n < 0) return `−${Math.abs(n).toFixed(1)}`
  return '0'
}
