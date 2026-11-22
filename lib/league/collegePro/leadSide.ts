/**
 * Which half of a college + pro league leads the roster page right now.
 *
 * The owner's rule (2026-11-21): "On game days, when there is a college game playing, the lineup
 * should switch college to the top automatically to see live scoring for the users players. Vice
 * versa on NFL game days."
 *
 * Pure: the caller supplies today's fixtures, so this decision is testable without a database. The
 * fixtures come from `SportsGame`, and that table is not guaranteed to carry every college game. With
 * no fixtures at all, the weekday decides, and that fallback is labelled `weekday` so the page can
 * say it is guessing.
 */

export type LeadSide = 'pro' | 'college'
export type LeadReason = 'live' | 'today' | 'next' | 'weekday'

export type GameLite = {
  sport: string
  startTime: Date | string | null
  status?: string | null
}

const GAME_LENGTH_MS = 4 * 60 * 60 * 1000
const FINISHED = new Set(['final', 'completed', 'complete', 'closed', 'cancelled', 'canceled', 'postponed', 'post'])

/** The US Eastern calendar day as `YYYY-MM-DD`. Fixtures are scheduled in Eastern time, not UTC. */
export function easternDayKey(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** 0 = Sunday … 6 = Saturday, in US Eastern time. */
export function easternWeekday(d: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(d)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name)
}

function toDate(v: Date | string | null): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function isFinished(g: GameLite): boolean {
  return FINISHED.has(String(g.status ?? '').trim().toLowerCase())
}

function isLive(g: GameLite, now: Date): boolean {
  if (isFinished(g)) return false
  const s = String(g.status ?? '').trim().toLowerCase()
  if (s === 'live' || s === 'in_progress' || s === 'inprogress' || s === 'halftime') return true
  const start = toDate(g.startTime)
  if (!start) return false
  const elapsed = now.getTime() - start.getTime()
  return elapsed >= 0 && elapsed <= GAME_LENGTH_MS
}

export function decideLeadSide(input: {
  now: Date
  proSport: string
  collegeSport: string
  games: GameLite[]
}): { lead: LeadSide; reason: LeadReason } {
  const { now } = input
  const today = easternDayKey(now)
  const pro = input.proSport.trim().toUpperCase()
  const college = input.collegeSport.trim().toUpperCase()
  const todays = (sport: string) =>
    input.games.filter((g) => {
      if (g.sport.trim().toUpperCase() !== sport) return false
      const start = toDate(g.startTime)
      return start != null && easternDayKey(start) === today
    })
  const proToday = todays(pro)
  const collegeToday = todays(college)

  const proLive = proToday.some((g) => isLive(g, now))
  const collegeLive = collegeToday.some((g) => isLive(g, now))
  // Both halves live at once (a December Saturday with NFL games): pro keeps the top, the default.
  if (collegeLive && !proLive) return { lead: 'college', reason: 'live' }
  if (proLive) return { lead: 'pro', reason: 'live' }

  if (collegeToday.length > 0 && proToday.length === 0) return { lead: 'college', reason: 'today' }
  if (proToday.length > 0 && collegeToday.length === 0) return { lead: 'pro', reason: 'today' }

  if (collegeToday.length > 0 && proToday.length > 0) {
    const nextStart = (gs: GameLite[]) =>
      gs
        .filter((g) => !isFinished(g))
        .map((g) => toDate(g.startTime)?.getTime() ?? Number.POSITIVE_INFINITY)
        .filter((t) => t >= now.getTime())
        .reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY)
    const c = nextStart(collegeToday)
    const p = nextStart(proToday)
    if (c < p) return { lead: 'college', reason: 'next' }
    return { lead: 'pro', reason: 'next' }
  }

  // No fixtures on file for today: Saturday is college football's day.
  return { lead: easternWeekday(now) === 6 ? 'college' : 'pro', reason: 'weekday' }
}
