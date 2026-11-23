/**
 * One money format for every Salary Cap screen (2026-11-07, Salary Cap audit item 5).
 *
 * Cap home wrote "$196.0" and "$-10.0"; the sub-views wrote "$196" and "$-10". Now: whole dollars without decimals,
 * one decimal only when there is a fraction, and a real minus sign before the dollar ("−$10"). Over-the-cap amounts
 * were also drawn in the same green as healthy space — `isOverCap` lets a screen colour them as a warning instead.
 */
export function formatCapMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const r = Math.round(n * 10) / 10
  const abs = Math.abs(r)
  const body = Number.isInteger(abs) ? String(abs) : abs.toFixed(1)
  return `${r < 0 ? '−' : ''}$${body}`
}

/** Space below zero: the team is over the cap. */
export function isOverCap(space: number | null | undefined): boolean {
  return typeof space === 'number' && Number.isFinite(space) && space < 0
}

/**
 * Years a contract has left INCLUDING this season. The summary route's `yearsRemaining` counts the years after this one
 * (`yearsTotal − contractYear`); Cap home added one and the Contracts page did not, so one contract read 3 on one
 * screen and 2 on the other.
 */
export function yearsLeftIncludingThisSeason(c: { yearsRemaining: number }): number {
  return Math.max(0, c.yearsRemaining) + 1
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  expiring: 'Expiring',
  tagged: 'Franchise tag',
  option_exercised: 'Option exercised',
  extended: 'Extended',
  cut: 'Cut',
}

/** A contract status for people ("Option exercised"), never the stored value ("option_exercised"). */
export function contractStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase())
}
