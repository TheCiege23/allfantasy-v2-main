import { nextWaiverRunMs, type WaiverSchedule } from './waiverRunClock'

/**
 * The /core home's platform calendar (2026-11-12): when waivers run on each platform you play, so a
 * person with leagues on four platforms learns that their claims resolve at four different times.
 *
 * ⚠ ONLY WHAT IS STORED. Waiver times come from `loadSleeperWaiverSchedules` (lib/waivers) — observed
 * from each league's own processed claims, else Sleeper's own setting — which is the only measured
 * source in this codebase. Every other platform's row says its waiver time is not readable, rather
 * than printing a platform default that a league may well have changed. Nothing here calls a
 * provider.
 *
 * PURE and client-safe: the caller reads the schedules and passes them in.
 */

type CalendarLeague = { id: string; platform: string | null }

type CalendarWaiverGroup = {
  schedule: WaiverSchedule
  /** The next run as an instant, so the client can say it in the reader's own time zone. */
  nextRunIso: string | null
  leagues: number
}

export type PlatformCalendarRow = {
  /** Lower-cased platform key ('sleeper', 'espn', … 'allfantasy' when blank). */
  platform: string
  leagues: number
  /** Up to two waiver schedules, most leagues first. Empty when none could be read. */
  waivers: CalendarWaiverGroup[]
  /** Leagues on this platform whose waiver time could not be read. */
  unread: number
}

const MAX_GROUPS = 2

function keyOf(s: WaiverSchedule): string {
  return `${s.dayOfWeek ?? 'daily'}|${s.time}|${s.timeZone}`
}

export function platformKey(platform: string | null | undefined): string {
  const key = (platform ?? '').trim().toLowerCase()
  return key || 'allfantasy'
}

export function buildPlatformCalendar(
  leagues: readonly CalendarLeague[],
  schedules: ReadonlyMap<string, WaiverSchedule>,
  nowMs: number,
): PlatformCalendarRow[] {
  const byPlatform = new Map<string, CalendarLeague[]>()
  for (const l of leagues) {
    const key = platformKey(l.platform)
    const list = byPlatform.get(key) ?? []
    list.push(l)
    byPlatform.set(key, list)
  }
  const rows: PlatformCalendarRow[] = []
  for (const [platform, list] of byPlatform) {
    const groups = new Map<string, { schedule: WaiverSchedule; leagues: number }>()
    let unread = 0
    for (const l of list) {
      const s = schedules.get(l.id)
      if (!s) {
        unread += 1
        continue
      }
      const k = keyOf(s)
      const g = groups.get(k) ?? { schedule: s, leagues: 0 }
      g.leagues += 1
      groups.set(k, g)
    }
    const waivers = [...groups.values()]
      .sort((a, b) => b.leagues - a.leagues || keyOf(a.schedule).localeCompare(keyOf(b.schedule)))
      .slice(0, MAX_GROUPS)
      .map((g) => {
        const next = nextWaiverRunMs(g.schedule, nowMs)
        return { schedule: g.schedule, nextRunIso: next == null ? null : new Date(next).toISOString(), leagues: g.leagues }
      })
    rows.push({ platform, leagues: list.length, waivers, unread })
  }
  return rows.sort((a, b) => b.leagues - a.leagues || a.platform.localeCompare(b.platform))
}
