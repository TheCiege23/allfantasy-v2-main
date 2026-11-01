/**
 * Redraft /core Trades + War Room (batch B4 of the redraft visual upgrade) — the pure mappings the two
 * screens use when the /core shell carries the redraft identity (`data-format="redraft"` on
 * `.af-core.af-shell`, stamped by CORE-1). Styling: components/core-app/af-core-redraft-trades.css.
 *
 * ⚠ EVERY FUNCTION RETURNS `null` WHEN THE DATA DOES NOT SAY. The screen drops the element on `null`;
 * it never fills one in. A deadline bar needs a deadline the league actually has (or a real "none"),
 * a fill needs both the current week and the deadline week, a grade tone needs a real letter.
 */
import type { TradeDeadlineCountdown } from '@/lib/trade-deadline/tradeDeadlineCountdown'

/* ── Trade deadline bar ─────────────────────────────────────────────────────────────────────────── */

export type RedraftDeadlineState = 'none' | 'open' | 'final' | 'passed' | 'counting' | 'scheduled'

export type RedraftDeadlineBar = {
  state: RedraftDeadlineState
  /** The league's deadline week; null for `none`, or a time-only deadline. */
  deadlineWeek: number | null
  /** The week in progress, only when the server verdict carried it (`weeks`). */
  currentWeek: number | null
  /** Weeks of trading left after this one; null unless counted in weeks. */
  weeksLeft: number | null
  /** How far through the trading window the season is, 0–100 — only with both weeks known. */
  fillPct: number | null
  label: string
}

/** The import snapshot's deadline (`TradesData.deadline`) — the fallback when no verdict was read. */
export type SnapshotDeadline =
  | { available: true; data: { week: number | null; regularSeasonLength: number | null; none: boolean } }
  | { available: false; reason: string }

const validWeek = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

/**
 * The bar, from the deadline the ENGINE enforces (`deadlineCountdown`, the server's verdict) — so the
 * bar can never call trades open when a proposal would be refused. Without a verdict it falls back to
 * the import snapshot, which can say "none" or name a week but never how far in the season is.
 * Returns null when neither says anything (the screen keeps its own "not ingested" sentence).
 */
export function redraftDeadlineBar(
  snapshot: SnapshotDeadline | null | undefined,
  countdown: TradeDeadlineCountdown | null | undefined,
): RedraftDeadlineBar | null {
  if (countdown) {
    switch (countdown.state) {
      case 'none':
        return bar('none', null, null, null)
      case 'closed':
        return bar('passed', validWeek(countdown.deadlineWeek) ? countdown.deadlineWeek : null, null, null)
      case 'weeks': {
        if (!validWeek(countdown.deadlineWeek)) return null
        const current = validWeek(countdown.currentWeek) ? countdown.currentWeek : null
        const left = Math.max(0, Math.floor(countdown.weeksLeft))
        return bar(left > 0 ? 'open' : 'final', countdown.deadlineWeek, current, left)
      }
      case 'counting':
        return bar('counting', validWeek(countdown.deadlineWeek) ? countdown.deadlineWeek : null, null, null)
      case 'scheduled':
        return bar('scheduled', validWeek(countdown.deadlineWeek) ? countdown.deadlineWeek : null, null, null)
    }
  }
  if (!snapshot || !snapshot.available) return null
  if (snapshot.data.none) return bar('none', null, null, null)
  if (validWeek(snapshot.data.week)) return bar('scheduled', snapshot.data.week, null, null)
  return null
}

function bar(state: RedraftDeadlineState, deadlineWeek: number | null, currentWeek: number | null, weeksLeft: number | null): RedraftDeadlineBar {
  const fillPct =
    deadlineWeek != null && currentWeek != null ? Math.round(Math.min(1, Math.max(0, currentWeek / deadlineWeek)) * 100) : null
  return { state, deadlineWeek, currentWeek, weeksLeft, fillPct, label: redraftDeadlineLabel(state, deadlineWeek, weeksLeft) }
}

/**
 * The bar's value line. The bar already carries a "Trade deadline" kicker, so the value does not
 * repeat it — it says WHEN, and how much room is left.
 */
export function redraftDeadlineLabel(state: RedraftDeadlineState, week: number | null, weeksLeft: number | null): string {
  const wk = week != null ? `Week ${week}` : null
  switch (state) {
    case 'none':
      return 'No trade deadline'
    case 'open':
      return `${wk} · ${weeksLeft} ${weeksLeft === 1 ? 'week' : 'weeks'} left`
    case 'final':
      return `${wk} · last week to trade`
    case 'passed':
      return wk ? `Passed in ${wk} · trades closed` : 'Passed · trades closed'
    case 'counting':
    case 'scheduled':
      return wk ?? 'Set by close time'
  }
}

/* ── Grades ────────────────────────────────────────────────────────────────────────────────────── */

export type RedraftGradeTone = 'good' | 'warn' | 'bad'

/**
 * The tone a letter-grade block takes. A and B read good, C even, D and F bad. Anything else — a
 * withheld grade, "n/a", "—" — has no tone: a withheld grade must never be coloured like a letter.
 */
export function redraftGradeTone(letter: string | null | undefined): RedraftGradeTone | null {
  const m = /^([A-DF])[+-]?$/.exec(String(letter ?? '').trim().toUpperCase())
  if (!m) return null
  const l = m[1]
  if (l === 'A' || l === 'B') return 'good'
  if (l === 'C') return 'warn'
  if (l === 'D' || l === 'F') return 'bad'
  return null
}

/* ── Gating ────────────────────────────────────────────────────────────────────────────────────── */

const RD_THEMES = new Set(['nfl', 'nba', 'nhl', 'mlb', 'ncaaf', 'ncaab', 'soccer'])

/**
 * The redraft sport of the /core shell an element sits in, or null when it is not inside a redraft
 * shell. Read from the DOM because the stamp is the shell's decision (coreShellRedraftSport): a screen
 * repeating that decision from its own props could disagree with the chrome around it.
 */
export function redraftShellSportOf(el: Element | null | undefined): string | null {
  const root = el?.closest?.('.af-core.af-shell[data-format="redraft"]')
  const sport = root?.getAttribute('data-sport') ?? null
  return sport && RD_THEMES.has(sport) ? sport : null
}
