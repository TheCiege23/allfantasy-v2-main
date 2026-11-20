/**
 * ALLFANTASY'S OWN TRACK RECORD — the pure half (2026-11-15). Chimmy's start/sit record has been graded
 * by the outcome snapshot since 2026-09-24 (`learningSnapshot.ts`). The advice ledger added three
 * calls that nothing graded except a hand-run script:
 *
 *   - My Team's bench check ("start X over Y", surface `my_team_bench`) — right / wrong / same,
 *     by the same rule as every other start/sit receipt: within LEDGER_SAME_BAND points is "same".
 *   - The waiver panel's #1 pickup (surface `waiver_panel`) — did he average STARTABLE_PPR_PER_WEEK
 *     or more over the advice week and the next two, and did he beat the drop it suggested.
 *   - Every `evaluateTrade()` grade (`trade_decision_snapshots`) — by letter, the net PPR per week the
 *     players received out-scored the ones given, from the first week not kicked off (tradeLedger.ts).
 *
 * The maintenance cron rebuilds these with the rest of the snapshot (`ledgerGrading.ts`), from
 * scratch, at most every six hours. This file folds the rows and turns the stored counts into the
 * view the Receipts card shows.
 *
 * 🛑 NOTHING IS GRADED UNTIL ITS WEEK IS PROVABLY OVER. "Over" is the schedule table's last kickoff
 * of that NFL week plus GAME_TAIL_MS — not a calendar guess. A week the schedule does not carry is
 * pending, never graded.
 *
 * 🛑 A RATE NEEDS A SAMPLE, exactly as trackRecord.ts: below the minimums the counts are shown as
 * counts and the rate is null. Trade letters with fewer than MIN_TRADES_PER_LETTER graded deals are
 * left out of the view entirely.
 *
 * ⚠ STANDARD PPR, NOT EACH LEAGUE'S SCORING, for pickups and trades: a free agent has no league score
 * row until someone rosters him, so both are graded on the week-stats feed. The copy says "PPR".
 *
 * Pure and dependency-free (type imports only), so a client component can render the view.
 */

import type { TrackRecordLine } from './trackRecord'
import type { WaiverEngineLedger } from '@/lib/decision-os/waiver/calibration'

/** Within this many points, a start/sit call is "same" — the Receipts card's AutoCoach band. */
export const LEDGER_SAME_BAND = 1
/** A pickup is graded over the advice week and the next two. */
export const ADD_WINDOW_WEEKS = 3
/** …and counts as a startable pickup when he averaged this many standard-PPR points a week. */
export const STARTABLE_PPR_PER_WEEK = 10
/** The last NFL regular-season week. A pickup window never runs past it. */
export const LAST_REGULAR_WEEK = 18
/** A week's last game is over this long after its last kickoff (overtime, stat corrections settle). */
export const GAME_TAIL_MS = 6 * 60 * 60 * 1000
/** Graded calls before YOUR line carries a percentage. Matches trackRecord's user minimum. */
export const MIN_GRADED_FOR_USER_RATE = 5
/** Graded calls across everyone before the platform-wide percentage is shown. */
export const MIN_GRADED_FOR_OVERALL_RATE = 30
/** Graded deals a letter needs before its net is shown at all. */
export const MIN_TRADES_PER_LETTER = 20
/** The most users whose own lines are kept in one snapshot, most calls first. */
export const MAX_LEDGER_USERS = 5000

export const TRADE_LETTERS = ['A', 'B', 'C', 'D', 'F'] as const
export type TradeLetter = (typeof TRADE_LETTERS)[number]

/* ───────────────────────── the NFL week calendar ───────────────────────── */

export type WeekSpan = { week: number; firstKickoff: Date; lastKickoff: Date }
export type WeekCalendar = ReadonlyMap<number, { first: number; last: number }>

export function weekCalendar(rows: readonly WeekSpan[]): WeekCalendar {
  const cal = new Map<number, { first: number; last: number }>()
  for (const r of rows) {
    const first = r.firstKickoff instanceof Date ? r.firstKickoff.getTime() : Number.NaN
    const last = r.lastKickoff instanceof Date ? r.lastKickoff.getTime() : Number.NaN
    if (!Number.isInteger(r.week) || r.week < 1 || r.week > LAST_REGULAR_WEEK) continue
    if (!Number.isFinite(first) || !Number.isFinite(last)) continue
    cal.set(r.week, { first, last })
  }
  return cal
}

/** The week's last game is over. A week the schedule does not carry is never over. */
export function weekIsOver(cal: WeekCalendar, week: number, now: Date): boolean {
  const w = cal.get(week)
  return w != null && w.last + GAME_TAIL_MS <= now.getTime()
}

/** The last week W such that every week 1..W is over; 0 when week 1 is not. */
export function completedThrough(cal: WeekCalendar, now: Date): number {
  let done = 0
  for (let w = 1; w <= LAST_REGULAR_WEEK; w++) {
    if (!weekIsOver(cal, w, now)) break
    done = w
  }
  return done
}

/** The first week none of whose games had kicked off at `at`. Null when the season is past that. */
export function firstWeekNotKickedOff(cal: WeekCalendar, at: Date): number | null {
  const t = at.getTime()
  if (!Number.isFinite(t)) return null
  for (let w = 1; w <= LAST_REGULAR_WEEK; w++) {
    const span = cal.get(w)
    if (span && span.first > t) return w
  }
  return null
}

/** The last week of a pickup's window: the advice week and the next two, never past week 18. */
export function addWindowEnd(week: number): number {
  return Math.min(week + ADD_WINDOW_WEEKS - 1, LAST_REGULAR_WEEK)
}

/* ───────────────────────── grading ───────────────────────── */

export type StartSitCall = 'right' | 'wrong' | 'same'

export function gradeStartSit(recPts: number, altPts: number): StartSitCall {
  const d = recPts - altPts
  return Math.abs(d) < LEDGER_SAME_BAND ? 'same' : d > 0 ? 'right' : 'wrong'
}

export type BenchRow = {
  userId: string
  week: number
  withdrawn: boolean
  recPts: number | null
  altPts: number | null
}

export type AddRow = {
  userId: string
  week: number
  /** Standard PPR he scored over the window (weeks with a row only), and how many weeks had a row. */
  recPts: number | null
  recWeeks: number
  /** The suggested drop's PPR over the same window; null when there was no drop. */
  altPts: number | null
  hasDrop: boolean
}

export type BenchTally = { right: number; wrong: number; same: number; gain: number; pending: number; unscored: number; withdrawn: number }
export type PickupTally = { graded: number; startable: number; vsDrop: number; beatDrop: number; lostDrop: number; pending: number; noStats: number }
export type TradeTally = { n: number; netPerWeek: number; ahead: number; behind: number }

/** What the snapshot stores. Counts only — no player, league or trade identifiers. */
export type LedgerSnapshot = {
  season: number
  /** Every week through this one is over. */
  throughWeek: number
  bench: BenchTally
  pickups: PickupTally
  /** Redraft evaluations only: a dynasty deal is priced for years, not weeks. */
  trades: { byLetter: Partial<Record<TradeLetter, TradeTally>>; pending: number; unscored: number; read: number; gradable: number }
  /**
   * The same tally over only the trades a commissioner was shown in a trade review (surface
   * `commissioner-review`), one per deal. Absent on a snapshot written before 2026-11-20.
   */
  commissionerTrades?: LedgerSnapshot['trades']
  /**
   * The waiver engine's #1 claims per confidence band — how often each band's claims became startable —
   * the waiver engine's own calibration (`lib/decision-os/waiver/calibration.ts`). Absent on a snapshot
   * written before 2026-11-20, and on a rebuild with no scored claim to grade.
   */
  waiverEngine?: WaiverEngineLedger
  /** userId → { b: [right, wrong, same] bench calls, p: [graded, startable] pickups }. */
  users: Record<string, { b?: [number, number, number]; p?: [number, number] }>
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function foldLedger(input: {
  season: number
  cal: WeekCalendar
  now: Date
  bench: readonly BenchRow[]
  adds: readonly AddRow[]
  trades: LedgerSnapshot['trades']
  commissionerTrades?: LedgerSnapshot['trades']
  waiverEngine?: WaiverEngineLedger
}): LedgerSnapshot {
  const { cal, now } = input
  const bench: BenchTally = { right: 0, wrong: 0, same: 0, gain: 0, pending: 0, unscored: 0, withdrawn: 0 }
  const pickups: PickupTally = { graded: 0, startable: 0, vsDrop: 0, beatDrop: 0, lostDrop: 0, pending: 0, noStats: 0 }
  const users = new Map<string, { b?: [number, number, number]; p?: [number, number]; calls: number }>()
  const userOf = (id: string) => {
    let u = users.get(id)
    if (!u) users.set(id, (u = { calls: 0 }))
    return u
  }

  for (const r of input.bench) {
    if (r.withdrawn) {
      bench.withdrawn++
      continue
    }
    if (!weekIsOver(cal, r.week, now)) {
      bench.pending++
      continue
    }
    if (r.recPts == null || r.altPts == null || !Number.isFinite(r.recPts) || !Number.isFinite(r.altPts)) {
      bench.unscored++
      continue
    }
    const call = gradeStartSit(r.recPts, r.altPts)
    bench[call]++
    bench.gain += r.recPts - r.altPts
    if (r.userId) {
      const u = userOf(r.userId)
      const b = (u.b ??= [0, 0, 0])
      b[call === 'right' ? 0 : call === 'wrong' ? 1 : 2]++
      u.calls++
    }
  }
  bench.gain = round1(bench.gain)

  for (const r of input.adds) {
    const end = addWindowEnd(r.week)
    if (!weekIsOver(cal, end, now)) {
      pickups.pending++
      continue
    }
    if (!(r.recWeeks > 0) || r.recPts == null || !Number.isFinite(r.recPts)) {
      pickups.noStats++
      continue
    }
    const weeks = end - r.week + 1
    const startable = r.recPts / weeks >= STARTABLE_PPR_PER_WEEK
    pickups.graded++
    if (startable) pickups.startable++
    if (r.hasDrop) {
      const alt = r.altPts != null && Number.isFinite(r.altPts) ? r.altPts : 0
      pickups.vsDrop++
      if (r.recPts > alt) pickups.beatDrop++
      else if (r.recPts < alt) pickups.lostDrop++
    }
    if (r.userId) {
      const u = userOf(r.userId)
      const p = (u.p ??= [0, 0])
      p[0]++
      if (startable) p[1]++
      u.calls++
    }
  }

  const kept = [...users].sort((a, b) => b[1].calls - a[1].calls).slice(0, MAX_LEDGER_USERS)
  return {
    season: input.season,
    throughWeek: completedThrough(cal, now),
    bench,
    pickups,
    trades: input.trades,
    ...(input.commissionerTrades ? { commissionerTrades: input.commissionerTrades } : {}),
    ...(input.waiverEngine && Object.keys(input.waiverEngine).length > 0 ? { waiverEngine: input.waiverEngine } : {}),
    users: Object.fromEntries(kept.map(([id, { b, p }]) => [id, { ...(b ? { b } : {}), ...(p ? { p } : {}) }])),
  }
}

/* ───────────────────────── the view ───────────────────────── */

export type PickupLine = { graded: number; startable: number; ratePct: number | null }

export type LedgerRecordView = {
  season: number
  /** My Team's bench check. `everyone.gainPerCall` = mean points the recommended player out-scored the other by. */
  bench: { you: TrackRecordLine | null; everyone: (TrackRecordLine & { gainPerCall: number | null }) | null } | null
  /** The waiver panel's #1 pickup: how many averaged 10+ PPR over their window. */
  pickups: { you: PickupLine | null; everyone: (PickupLine & { vsDrop: number; beatDrop: number }) | null } | null
  /**
   * Letters with enough graded redraft deals, A first. Empty → null. `aheadPct` is the share of the letter's
   * deals (ties left out) whose graded side out-scored what it gave; null on a snapshot written before
   * 2026-11-19, which stored no split.
   */
  trades: Array<{ letter: TradeLetter; n: number; netPerWeek: number; aheadPct?: number | null }> | null
  /** The same, over only trades a commissioner was shown in a trade review. Absent or null when none qualify. */
  commissionerTrades?: Array<{ letter: TradeLetter; n: number; netPerWeek: number; aheadPct?: number | null }> | null
}

const nat = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0)

function startSitLine(right: number, wrong: number, same: number, min: number): TrackRecordLine | null {
  if (right + wrong + same === 0) return null
  const decided = right + wrong
  return { right, wrong, same, ratePct: decided >= min ? Math.round((100 * right) / decided) : null }
}

function pickupLine(graded: number, startable: number, min: number): PickupLine | null {
  if (graded === 0) return null
  return { graded, startable: Math.min(startable, graded), ratePct: graded >= min ? Math.round((100 * startable) / graded) : null }
}

/** The stored ledger, for one user (or none). Null when nothing has been graded. */
export function ledgerRecordFor(ledger: LedgerSnapshot | null | undefined, userId: string | null): LedgerRecordView | null {
  if (!ledger || typeof ledger !== 'object') return null
  const mine = userId ? ledger.users?.[userId] : undefined

  const b = ledger.bench ?? ({} as BenchTally)
  const benchEveryone = startSitLine(nat(b.right), nat(b.wrong), nat(b.same), MIN_GRADED_FOR_OVERALL_RATE)
  const benchYou = Array.isArray(mine?.b) ? startSitLine(nat(mine.b[0]), nat(mine.b[1]), nat(mine.b[2]), MIN_GRADED_FOR_USER_RATE) : null
  const graded = nat(b.right) + nat(b.wrong) + nat(b.same)
  const bench =
    benchYou || benchEveryone
      ? {
          you: benchYou,
          everyone: benchEveryone
            ? {
                ...benchEveryone,
                gainPerCall:
                  benchEveryone.ratePct != null && typeof b.gain === 'number' && Number.isFinite(b.gain) && graded > 0 ? round1(b.gain / graded) : null,
              }
            : null,
        }
      : null

  const p = ledger.pickups ?? ({} as PickupTally)
  const pickEveryone = pickupLine(nat(p.graded), nat(p.startable), MIN_GRADED_FOR_OVERALL_RATE)
  const pickYou = Array.isArray(mine?.p) ? pickupLine(nat(mine.p[0]), nat(mine.p[1]), MIN_GRADED_FOR_USER_RATE) : null
  const pickups =
    pickYou || pickEveryone
      ? { you: pickYou, everyone: pickEveryone ? { ...pickEveryone, vsDrop: nat(p.vsDrop), beatDrop: Math.min(nat(p.beatDrop), nat(p.vsDrop)) } : null }
      : null

  const lettersOf = (tally: LedgerSnapshot['trades'] | undefined) =>
    TRADE_LETTERS.flatMap((letter) => {
      const t = tally?.byLetter?.[letter]
      if (!t || nat(t.n) < MIN_TRADES_PER_LETTER || typeof t.netPerWeek !== 'number' || !Number.isFinite(t.netPerWeek)) return []
      const ahead = nat(t.ahead)
      const decided = ahead + nat(t.behind)
      return [{ letter, n: nat(t.n), netPerWeek: round1(t.netPerWeek), aheadPct: decided > 0 ? Math.round((100 * ahead) / decided) : null }]
    })
  const letters = lettersOf(ledger.trades)
  const commissionerLetters = lettersOf(ledger.commissionerTrades)

  if (!bench && !pickups && letters.length === 0) return null
  return {
    season: nat(ledger.season),
    bench,
    pickups,
    trades: letters.length ? letters : null,
    ...(commissionerLetters.length ? { commissionerTrades: commissionerLetters } : {}),
  }
}

/** Only a well-formed view survives a trip to the client; anything else renders nothing. */
export function readLedgerRecordView(value: unknown): LedgerRecordView | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const okLine = (l: unknown) => {
    if (l == null) return true
    if (typeof l !== 'object') return false
    const x = l as Record<string, unknown>
    return [x.right, x.wrong, x.same].every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0) && (x.ratePct === null || typeof x.ratePct === 'number')
  }
  const okPick = (l: unknown) => {
    if (l == null) return true
    if (typeof l !== 'object') return false
    const x = l as Record<string, unknown>
    return [x.graded, x.startable].every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0) && (x.ratePct === null || typeof x.ratePct === 'number')
  }
  const bench = v.bench as LedgerRecordView['bench']
  const pickups = v.pickups as LedgerRecordView['pickups']
  if (bench != null && (typeof bench !== 'object' || !okLine(bench.you) || !okLine(bench.everyone))) return null
  if (pickups != null && (typeof pickups !== 'object' || !okPick(pickups.you) || !okPick(pickups.everyone))) return null
  const okLetters = (list: unknown) => {
    if (list == null) return true
    if (!Array.isArray(list)) return false
    for (const t of list) {
      if (!t || typeof t !== 'object') return false
      const x = t as Record<string, unknown>
      if (!TRADE_LETTERS.includes(x.letter as TradeLetter) || typeof x.n !== 'number' || typeof x.netPerWeek !== 'number') return false
      if (x.aheadPct != null && !(typeof x.aheadPct === 'number' && x.aheadPct >= 0 && x.aheadPct <= 100)) return false
    }
    return true
  }
  const trades = v.trades
  if (!okLetters(trades)) return null
  // A malformed commissioner list drops only itself: the rest of the record is still good.
  const commissionerTrades = okLetters(v.commissionerTrades) ? (v.commissionerTrades as LedgerRecordView['commissionerTrades']) ?? null : null
  if (bench == null && pickups == null && trades == null) return null
  return {
    season: typeof v.season === 'number' ? v.season : 0,
    bench: bench ?? null,
    pickups: pickups ?? null,
    trades: (trades as LedgerRecordView['trades']) ?? null,
    ...(commissionerTrades?.length ? { commissionerTrades } : {}),
  }
}
