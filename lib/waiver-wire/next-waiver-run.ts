/**
 * Next waiver run time (UTC) from processing day + time + optional multi-day schedule.
 */

export type NextRunInput = {
  processingDayOfWeek: number | null | undefined
  processingTimeUtc: string | null | undefined
  /** JSON array of weekday indices from settings.processingDays */
  processingDays?: unknown
}

function parseTimeUtc(time: string | null | undefined): { h: number; m: number } | null {
  if (!time || typeof time !== 'string') return null
  const t = time.trim()
  const m = t.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null
  return { h, m: min }
}

/**
 * Returns ISO string for next run after `from`, or null if not enough config.
 */
export function computeNextWaiverRunAtUtc(from: Date, input: NextRunInput): string | null {
  const time = parseTimeUtc(input.processingTimeUtc ?? undefined)
  if (!time) return null

  const multi =
    Array.isArray(input.processingDays) && input.processingDays.length > 0
      ? input.processingDays.map((x) => Number(x)).filter((n) => Number.isFinite(n))
      : null

  const targetDays = multi && multi.length > 0 ? multi : [input.processingDayOfWeek ?? 3]

  const candidates: Date[] = []
  const base = new Date(from.getTime())
  for (let add = 0; add < 14; add += 1) {
    const d = new Date(base)
    d.setUTCDate(d.getUTCDate() + add)
    const dow = d.getUTCDay()
    if (!targetDays.includes(dow)) continue
    d.setUTCHours(time.h, time.m, 0, 0)
    if (d.getTime() > from.getTime()) candidates.push(d)
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.getTime() - b.getTime())
  return candidates[0]!.toISOString()
}

/**
 * The latest scheduled waiver run at or before `at`, as a Date, or null if not enough config — the
 * mirror of `computeNextWaiverRunAtUtc`. Used where a run must count as having cleared even though
 * the processor wrote nothing (it records no run when no claim is pending).
 */
export function computePreviousWaiverRunAtUtc(at: Date, input: NextRunInput): Date | null {
  const time = parseTimeUtc(input.processingTimeUtc ?? undefined)
  if (!time) return null

  const multi =
    Array.isArray(input.processingDays) && input.processingDays.length > 0
      ? input.processingDays.map((x) => Number(x)).filter((n) => Number.isFinite(n))
      : null

  const targetDays = multi && multi.length > 0 ? multi : [input.processingDayOfWeek ?? 3]

  for (let back = 0; back < 14; back += 1) {
    const d = new Date(at.getTime())
    d.setUTCDate(d.getUTCDate() - back)
    if (!targetDays.includes(d.getUTCDay())) continue
    d.setUTCHours(time.h, time.m, 0, 0)
    if (d.getTime() <= at.getTime()) return d
  }
  return null
}
