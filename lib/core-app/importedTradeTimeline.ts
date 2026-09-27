import type { TradeRecord } from './trades'
import { mirrorTradeGrade, type TradeGradeLine, type TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { oneGradeBreakdown } from '@/lib/decision-os/trade/tradeGradeBreakdown'

/** One asset on a timeline row, as the Trade Center renders it. */
export type TimelineAsset = {
  id: string
  label: string
  sublabel?: string | null
  headshotUrl?: string | null
  /** The name the grader priced this asset under, when it is not `label` — a used pick is the player drafted with it. */
  gradedAs?: string | null
}

/**
 * Completed import history already read for the page, as timeline rows.
 *
 * 🛑 THE GRADE RIDES ALONG (2026-09-27). This used to say "no second feed or grade" and carry only
 * the realized-points letter, so every archived trade rendered "— → —": no letter for either team,
 * no value on any asset, no reason. The record already held THE grade's inputs; the row threw them
 * away. `leagueGrade` is now attached server-side (`sleeperTradeHistory.ts`) and re-oriented here.
 *
 * ⚠ `leagueGrade` IS GRADED FROM `players[0]`'S SIDE, and the row reads from `first`, which is the
 * viewer when they are in the deal. When `first` is `players[1]` the grade is mirrored — exact, not
 * an estimate (see `mirrorLetter`) — so `sent` is always the grade's `give`.
 */
export function importedTradeTimelineRows(trades: readonly TradeRecord[]) {
  return trades.flatMap(trade => {
    // Received assets identify the opposite side's sends only in a two-party deal.
    if (trade.players.length !== 2 || trade.rosterIds.length !== 2) return []
    const first = trade.players.find(side => side.isYou) ?? trade.players[0]
    const second = trade.players.find(side => side !== first)!
    const assets = (side: typeof first): TimelineAsset[] => [
      ...side.received.map(player => ({
        id: player.sleeperId,
        label: player.name,
        sublabel: [player.position, player.team].filter(Boolean).join(' · ') || null,
        headshotUrl: player.headshotUrl ?? null,
      })),
      ...(side.picks ?? []).map((label, i) => {
        const drafted = side.pickDrafted?.[i]?.trim() || null
        return { id: `pick:${i}:${label}`, label, sublabel: drafted ? `Drafted ${drafted}` : null, headshotUrl: null, gradedAs: drafted }
      }),
    ]
    const raw = trade.leagueGrade ?? null
    const leagueGrade: TradeGradeView | null = raw ? (first === trade.players[0] ? raw : mirrorTradeGrade(raw)) : null
    const date = new Date(trade.at)
    return [{
      id: `sleeper:${trade.transactionId.split(':').at(-1)}`,
      direction: 'complete' as const, status: 'completed_on_sleeper',
      partnerName: `${first.manager ?? 'Side A'} ↔ ${second.manager ?? 'Side B'}`,
      sideAName: first.manager ?? 'Side A', sideBName: second.manager ?? 'Side B',
      sideALabel: `${first.manager ?? 'Side A'} sent`, sideBLabel: `${second.manager ?? 'Side B'} sent`,
      sent: assets(second), received: assets(first),
      timestamp: Number.isFinite(date.getTime()) ? date.toISOString() : '',
      leagueGrade,
      leagueGradeSide: 'viewer' as const,
      currentGrade: leagueGrade?.graded ? leagueGrade.letter : null,
      currentValueGiven: leagueGrade?.graded ? leagueGrade.giveValue : null,
      currentValueReceived: leagueGrade?.graded ? leagueGrade.getValue : null,
      realizedGrade: first.gradeBasis === 'Realized' ? first.grade ?? null : null,
      realizedNote: first.gradeBasis === 'Realized' ? first.gradeNote ?? null : null,
    }]
  })
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * The league value the grade priced each asset at, in the assets' own order.
 *
 * Matched by NAME first (a used pick by the player drafted with it), then — only when what is left
 * on the side pairs up one-for-one — by position, which is the order the grader priced them in. An
 * asset nothing matches reads null and renders no number: a guessed value beside a real letter is
 * the thing the grade exists to refuse.
 */
export function assetValues(
  assets: ReadonlyArray<TimelineAsset>,
  lines: ReadonlyArray<TradeGradeLine>,
  side: 'give' | 'get',
): Array<number | null> {
  const pool = lines.filter(l => l.side === side).map(l => ({ line: l, used: false }))
  const out: Array<number | null> = assets.map(a => {
    const want = norm(a.gradedAs ?? a.label)
    const hit = pool.find(p => !p.used && norm(p.line.name) === want)
    if (!hit) return null
    hit.used = true
    return hit.line.leagueValue
  })
  const openAssets = out.map((v, i) => (v == null ? i : -1)).filter(i => i >= 0)
  const openLines = pool.filter(p => !p.used)
  if (openAssets.length > 0 && openAssets.length === openLines.length) {
    openAssets.forEach((idx, k) => { out[idx] = openLines[k]!.line.leagueValue })
  }
  return out
}

/**
 * Why the deal graded that way, from the side that SENT `give` — THE grade's own sentences, so no
 * number here can disagree with the letter. The per-player moves are left to the value chips.
 */
export function gradeReasons(grade: TradeGradeView | null | undefined, giveLabel: string, otherLabel: string): string[] {
  if (!grade?.graded) return []
  const all = oneGradeBreakdown({ grade, receiverLabel: giveLabel, partnerLabel: otherLabel })
  return all.length > 2 ? [all[0]!, all[1]!, all[all.length - 1]!] : all
}
