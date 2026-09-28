/**
 * Calibrating the tanking check's lineup-drop line (`TANK_LINEUP_DROP_SHARE`), from saved receipts.
 *
 * The review raises "tanking" when a side's projected starting lineup falls by at least that share of
 * itself AND more than half the value it receives would not start. The second half is structural; the
 * first is a number, set to 10% by judgement on 2026-09-27 with no data behind it. This measures real
 * proposals against it: every receipt taken while a trade was still pending carries each roster's lineup
 * effect, so the question "how many ordinary trades would trip each candidate line?" has an answer.
 *
 * Pure — no imports but types. `scripts/report-tanking-calibration.ts` feeds it saved receipts.
 */
import type { TradeEvaluationReceipt } from './evaluateTrade'
import { TANK_BENCH_VALUE_SHARE, TANK_LINEUP_DROP_SHARE } from './tradeReview'

export type TankingSide = {
  /** Share of its starting lineup this side loses, 0..1. Zero or less when it gains. */
  dropShare: number
  /** The points behind that share — the live check compares `drop >= line * before`, so this does too. */
  drop: number
  before: number
  /** Share of the value it receives that would not start, 0..1. */
  benchShare: number
}

/** Received value, and how much of it would not start — shared with the live review (`sideLineup`). */
export function receivedValueSplit(
  lines: ReadonlyArray<{ name: string; leagueValue: number | null }>,
  starts: (name: string) => boolean,
): { receivedValue: number | null; receivedBenchValue: number | null } {
  let receivedValue = 0
  let receivedBenchValue = 0
  for (const line of lines) {
    if (line.leagueValue == null) return { receivedValue: null, receivedBenchValue: null }
    receivedValue += line.leagueValue
    if (!starts(line.name)) receivedBenchValue += line.leagueValue
  }
  return { receivedValue, receivedBenchValue }
}

/** Both sides of one receipt, when it carries everything the check needs — else nothing, never a guess. */
export function tankingSidesFromReceipt(
  receipt: Pick<TradeEvaluationReceipt, 'assets' | 'canonical'>,
): TankingSide[] {
  const c = receipt.canonical
  if (!c?.moves) return []
  const out: TankingSide[] = []
  for (const p of c.participants) {
    const ri = p.rosterImpact
    if (!ri || ri.startingPointsBefore == null || ri.startingPointsDelta == null || !ri.startersAfter || ri.startingPointsBefore <= 0) continue
    // The proposer sends the receipt's `give` lines, so it receives the `get` lines; the receiver, the reverse.
    const receives = p.rosterId === c.proposerRosterId ? 'get' : p.rosterId === c.receiverRosterId ? 'give' : null
    if (!receives) continue
    const startersAfter = new Set(ri.startersAfter)
    const idOf = new Map(c.moves.filter((m) => m.toRosterId === p.rosterId && m.name).map((m) => [m.name!, m.playerId]))
    const split = receivedValueSplit(
      receipt.assets.filter((l) => l.side === receives),
      (name) => {
        const id = idOf.get(name)
        return id != null && startersAfter.has(id)
      },
    )
    if (split.receivedValue == null || split.receivedBenchValue == null) continue
    out.push({
      dropShare: -ri.startingPointsDelta / ri.startingPointsBefore,
      drop: -ri.startingPointsDelta,
      before: ri.startingPointsBefore,
      benchShare: split.receivedValue > 0 ? split.receivedBenchValue / split.receivedValue : 0,
    })
  }
  return out
}

export const CANDIDATE_DROP_SHARES = [0.05, 0.1, 0.15, 0.2, 0.25] as const

export type TankingCalibration = {
  sides: number
  /** Sides that would receive mostly bench value — the half of the check that is not a threshold. */
  benchHeavy: number
  /** For each candidate line: sides it would flag (bench-heavy AND dropping at least that share). */
  flaggedAt: Array<{ dropShare: number; flagged: number; pctOfSides: number | null; current: boolean }>
  /** Drop-share percentiles among the bench-heavy sides that lose lineup at all. */
  dropPercentiles: { p50: number; p75: number; p90: number; p95: number } | null
}

function percentile(sorted: readonly number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[i]!
}

export function tallyTankingCalibration(sides: readonly TankingSide[]): TankingCalibration {
  const heavy = sides.filter((s) => s.benchShare > TANK_BENCH_VALUE_SHARE)
  const losing = heavy.map((s) => s.dropShare).filter((d) => d > 0).sort((a, b) => a - b)
  return {
    sides: sides.length,
    benchHeavy: heavy.length,
    flaggedAt: CANDIDATE_DROP_SHARES.map((t) => {
      const flagged = heavy.filter((s) => s.drop >= t * s.before).length
      return {
        dropShare: t,
        flagged,
        pctOfSides: sides.length ? Math.round((flagged / sides.length) * 1000) / 10 : null,
        current: t === TANK_LINEUP_DROP_SHARE,
      }
    }),
    dropPercentiles: losing.length
      ? { p50: percentile(losing, 50), p75: percentile(losing, 75), p90: percentile(losing, 90), p95: percentile(losing, 95) }
      : null,
  }
}
