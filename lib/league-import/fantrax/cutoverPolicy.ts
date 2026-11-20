export type CutoverPolicy = 'after_open_period' | 'reconcile_open_period'
export const cutoverPolicyValid = (value: unknown): value is CutoverPolicy =>
  value === 'after_open_period' || value === 'reconcile_open_period'

export type CutoverPeriod = { number: number; startDate: string; endDate: string }
export type Cutover = {
  policy: CutoverPolicy
  season: number
  period: number
  periods: CutoverPeriod[]
  snapshotId: string
  teams: Record<string, string>
  installedSeasonId?: string
  settled?: boolean
  nativeFrom?: number
  officialRanks?: Record<string, number>
  reason?: string
}

export const object = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {}

export function readCutover(settings: unknown, season?: number): Cutover | undefined {
  const value = object(object(object(settings).importCarryover).cutover)
  if (!cutoverPolicyValid(value.policy) || (season != null && value.season !== season)) return
  return value as Cutover
}

export function activeFantraxCalendar(platform: unknown, settings: unknown, now = new Date()) {
  if (String(platform).toLowerCase() !== 'fantrax') return
  const raw = object(object(settings).fantrax_settings).scoringPeriods
  if (!Array.isArray(raw) || !raw.length) return
  const periods: CutoverPeriod[] = raw.map(p => ({ number: p.number, startDate: p.startDate, endDate: p.endDate })).sort((a,b) => a.number-b.number)
  if (!periods.every((p,i) => p.number === i+1 && Number.isFinite(Date.parse(p.startDate)) && Date.parse(p.endDate) >= Date.parse(p.startDate) &&
    (!i || Date.parse(periods[i-1].endDate) <= Date.parse(p.startDate)))) return
  const period = periods.find(p => Date.parse(p.startDate) <= now.getTime() && now.getTime() <= Date.parse(p.endDate))
  if (period) return { periods, period: period.number }
}

export function sourceOwnsWeek(cutover: Cutover | undefined, week: number) {
  return Boolean(cutover && week < (cutover.nativeFrom ?? cutover.period + 1))
}

export function sourceOwnedFixture(snapshot: unknown) {
  return object(object(snapshot).fantraxCutover).sourceOwned === true
}
