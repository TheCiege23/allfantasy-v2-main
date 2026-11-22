import 'server-only'

import {
  APP_DAILY,
  MUSIC_SEARCH_PROVIDER,
  PER_USER_DAILY,
  TALLY_REFUSED_APP,
  TALLY_REFUSED_USER,
  TALLY_SEARCHES,
} from '@/lib/app-music/youtubeSearch'

/**
 * How much the Music tab's YouTube search is used, for /admin/music-search.
 *
 * Reads the day counters youtubeSearch.ts keeps in ApiRateLimitRecord — no new table.
 * The question it answers: are the limits (PER_USER_DAILY a person, APP_DAILY for
 * music) in the right place, and is music leaving player highlights their share of
 * YouTube's 10,000 daily units? Each fresh search costs 100 units.
 *
 * ⚠ "searches" and the refusal counts started on the day this readout shipped. Days
 * before it have fresh searches but no total, and show the total as unknown rather
 * than as equal to the fresh count.
 */

export const YOUTUBE_DAILY_UNITS = 10_000
export const UNITS_PER_SEARCH = 100

export type MusicSearchDay = {
  /** UTC day, YYYY-MM-DD. */
  day: string
  /** Every search typed, cache answers included. Null before counting began. */
  searches: number | null
  /** Searches that went to YouTube (each costs UNITS_PER_SEARCH). */
  fresh: number
  /** Answered from the 24-hour cache, free. Null when `searches` is unknown. */
  fromCache: number | null
  /** People with at least one fresh search. */
  people: number
  /** People who used all PER_USER_DAILY of their fresh searches. */
  peopleAtLimit: number
  refusedPerson: number
  refusedApp: number
}

export type MusicSearchUsage = {
  days: number
  since: string
  perPersonLimit: number
  appLimit: number
  daily: MusicSearchDay[]
  totals: {
    /** Summed over the days that were counted; see `uncountedDays`. */
    searches: number
    fresh: number
    fromCache: number
    /**
     * Days in the window with YouTube sends but no total (before counting began).
     * `searches` and `fromCache` leave those days out, so the page says so rather
     * than showing a dash for the whole window during the first week.
     */
    uncountedDays: number
    refused: number
    peopleAtLimitDays: number
    appLimitDays: number
    busiestFresh: number
  }
  /** One sentence for the top of the page. */
  headline: string
}

type Row = { endpoint: string; callsMade: number; windowStart: Date }

/** Pure: rows in, readout out. Exported for tests. */
export function summarizeMusicSearchUsage(rows: Row[], days: number, now: Date = new Date()): MusicSearchUsage {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const since = new Date(today.getTime() - (days - 1) * 86_400_000)

  const byDay = new Map<string, Row[]>()
  for (const r of rows) {
    if (r.windowStart < since) continue
    const key = r.windowStart.toISOString().slice(0, 10)
    byDay.set(key, [...(byDay.get(key) ?? []), r])
  }

  const daily: MusicSearchDay[] = []
  for (let i = 0; i < days; i++) {
    const day = new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10)
    const dayRows = byDay.get(day) ?? []
    const get = (endpoint: string) => dayRows.find((r) => r.endpoint === endpoint)?.callsMade
    const users = dayRows.filter((r) => r.endpoint.startsWith('user:') && r.callsMade > 0)
    const fresh = get('app') ?? 0
    const searchesRow = get(TALLY_SEARCHES)
    const searches = searchesRow ?? (dayRows.length === 0 ? 0 : null)
    daily.push({
      day,
      searches,
      fresh,
      fromCache: searches === null ? null : Math.max(0, searches - fresh),
      people: users.length,
      peopleAtLimit: users.filter((u) => u.callsMade >= PER_USER_DAILY).length,
      refusedPerson: get(TALLY_REFUSED_USER) ?? 0,
      refusedApp: get(TALLY_REFUSED_APP) ?? 0,
    })
  }

  const known = daily.filter((d) => d.searches !== null)
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const totals = {
    searches: sum(known.map((d) => d.searches!)),
    fresh: sum(daily.map((d) => d.fresh)),
    fromCache: sum(known.map((d) => d.fromCache!)),
    uncountedDays: daily.length - known.length,
    refused: sum(daily.map((d) => d.refusedPerson + d.refusedApp)),
    peopleAtLimitDays: daily.filter((d) => d.peopleAtLimit > 0).length,
    appLimitDays: daily.filter((d) => d.fresh >= APP_DAILY || d.refusedApp > 0).length,
    busiestFresh: Math.max(0, ...daily.map((d) => d.fresh)),
  }

  return {
    days,
    since: since.toISOString(),
    perPersonLimit: PER_USER_DAILY,
    appLimit: APP_DAILY,
    daily,
    totals,
    headline: headlineFor(totals, days),
  }
}

function headlineFor(t: MusicSearchUsage['totals'], days: number): string {
  const span = days === 1 ? 'today' : `in the last ${days} days`
  if (t.fresh === 0 && !t.searches) return `No one has searched YouTube from the Music tab ${span}.`
  if (t.appLimitDays > 0) {
    return `Music used up its ${APP_DAILY} YouTube searches on ${t.appLimitDays} ${t.appLimitDays === 1 ? 'day' : 'days'} ${span}. Searching was off for everyone until midnight UTC.`
  }
  if (t.peopleAtLimitDays > 0) {
    return `Someone used all ${PER_USER_DAILY} of their searches on ${t.peopleAtLimitDays} ${t.peopleAtLimitDays === 1 ? 'day' : 'days'} ${span}. Music as a whole stayed under its limit.`
  }
  return `Plenty of room ${span}: the busiest day used ${t.busiestFresh} of ${APP_DAILY} YouTube searches.`
}

export async function getMusicSearchUsage(opts: { days: number }): Promise<MusicSearchUsage> {
  const { prisma } = await import('@/lib/prisma')
  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const since = new Date(today.getTime() - (opts.days - 1) * 86_400_000)
  const rows = await prisma.apiRateLimitRecord.findMany({
    where: { provider: MUSIC_SEARCH_PROVIDER, windowStart: { gte: since } },
    select: { endpoint: true, callsMade: true, windowStart: true },
  })
  return summarizeMusicSearchUsage(rows, opts.days, now)
}
