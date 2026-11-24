/**
 * `chimmy_advice.advice_day` (2026-11-23): the US Eastern day a DAILY-lineup league's bench check priced, as
 * 'YYYY-MM-DD' — the shape `easternDayKey` and the daily-lineup day picker produce. '' for every weekly call.
 * Pure, so the ledger's "may this render record" check and the store share one definition.
 */
export function isAdviceDay(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}
