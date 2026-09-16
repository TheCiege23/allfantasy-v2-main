/**
 * Commissioner Hub — the league calendar (brief item 3).
 *
 * Drafts, waivers, the trade deadline, playoffs, dues, votes and renewals, from
 * what this league actually has on file.
 *
 * ⚠ AN IMPORTED LEAGUE HAS VERY FEW DATES ON FILE, AND THE CALENDAR SAYS SO
 * RATHER THAN INVENTING THEM. Measured on origin/main 2026-09-16:
 *
 *   - Draft date: `LeagueSettings.draftDateUtc` is written only for leagues
 *     created in AllFantasy. Sleeper's fetch carries `start_time` and the
 *     importer drops it, so an imported draft has no date here.
 *   - Waiver runs: `LeagueWaiverSettings` processing day/time are OUR defaults
 *     (two distinct values platform-wide). They are real for a native league,
 *     because AllFantasy runs its waivers; for an import they describe nothing.
 *   - Trade deadline / playoffs: week numbers, Sleeper only. `99` = no deadline.
 *   - Dues: the dues tracker has an amount and paid flags but NO due date.
 *   - Votes: league-chat polls carry `closeAt`. Platform votes are not imported.
 *   - Renewal: `LeagueRenewal` has no writer. Only the league's own status
 *     (`complete`) says a season is over.
 *
 * Each of those gaps becomes a `gaps` line, so a short calendar reads as
 * "this is all we know" rather than "nothing is happening".
 *
 * Week-keyed events get a date only from real NFL kickoffs
 * (`SportsGame.startTime`, regular season), passed in as `weekStarts`.
 *
 * Client-safe: no Prisma.
 */

export type CalendarKind = 'draft' | 'waivers' | 'trade_deadline' | 'playoffs' | 'dues' | 'vote' | 'renewal'

export type CalendarEvent = {
  id: string
  kind: CalendarKind
  title: string
  /** Absolute time, when one is known. The only field `.ics` export uses. */
  at: string | null
  /** True when only the day is known (a week's first kickoff, not the moment). */
  allDay: boolean
  week: number | null
  whenLabel: string
  status: 'soon' | 'upcoming' | 'past' | 'unscheduled'
  detail: string
  /** Where the date comes from — the platform's settings, or AllFantasy's own. */
  source: 'platform' | 'allfantasy'
}

export type LeagueCalendar = {
  events: CalendarEvent[]
  gaps: string[]
}

export type CalendarInput = {
  now: Date
  leagueId: string
  platformLabel: string
  native: boolean
  /** The platform's league status: pre_draft | drafting | in_season | complete. */
  status: string | null
  season: number | null
  draftAt: Date | null
  waivers: {
    type: string | null
    /** 0 = Sunday … 6 = Saturday, UTC. */
    dayOfWeek: number | null
    /** "HH:MM", UTC. */
    timeUtc: string | null
  } | null
  tradeDeadlineWeek: number | null
  /** The league has explicitly said trades never close (the `99` sentinel). */
  noTradeDeadline: boolean
  playoffStartWeek: number | null
  currentWeek: number | null
  /** First regular-season kickoff of each week — real fixtures, never guessed. */
  weekStarts: Map<number, Date>
  dues: { enabled: boolean; amountLabel: string | null; unpaid: number } | null
  polls: Array<{ id: string; question: string; closesAt: string | null }>
}

const DAY_MS = 24 * 60 * 60 * 1000
const SOON_MS = 7 * DAY_MS

function statusFor(at: Date, now: Date): CalendarEvent['status'] {
  const delta = at.getTime() - now.getTime()
  if (delta < 0) return 'past'
  return delta <= SOON_MS ? 'soon' : 'upcoming'
}

function weekStatus(week: number, currentWeek: number | null): CalendarEvent['status'] {
  if (currentWeek == null) return 'upcoming'
  if (week < currentWeek) return 'past'
  return week - currentWeek <= 1 ? 'soon' : 'upcoming'
}

export function formatWhen(at: Date, allDay: boolean): string {
  const date = at.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York',
  })
  if (allDay) return date
  const time = at.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
    timeZoneName: 'short',
  })
  return `${date} · ${time}`
}

/**
 * The next time a weekly UTC slot comes round, strictly after `now`.
 * Returns null for anything that is not a real day and HH:MM.
 */
export function nextWeeklyRun(now: Date, dayOfWeek: number, timeUtc: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(timeUtc.trim())
  if (!m || dayOfWeek < 0 || dayOfWeek > 6) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (hh > 23 || mm > 59) return null
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm))
  let add = (dayOfWeek - at.getUTCDay() + 7) % 7
  if (add === 0 && at.getTime() <= now.getTime()) add = 7
  return new Date(at.getTime() + add * DAY_MS)
}

const NO_WAIVER_RUN = new Set(['fcfs', 'off', 'none', 'free_agency'])

export function buildLeagueCalendar(input: CalendarInput): LeagueCalendar {
  const { now } = input
  const events: CalendarEvent[] = []
  const gaps: string[] = []
  const status = (input.status ?? '').toLowerCase()
  const src: CalendarEvent['source'] = input.native ? 'allfantasy' : 'platform'

  // ── Draft ────────────────────────────────────────────────────────────
  if (input.draftAt) {
    events.push({
      id: 'draft',
      kind: 'draft',
      title: 'Draft',
      at: input.draftAt.toISOString(),
      allDay: false,
      week: null,
      whenLabel: formatWhen(input.draftAt, false),
      status: statusFor(input.draftAt, now),
      detail: 'Set in this league’s draft settings.',
      source: 'allfantasy',
    })
  } else if (status === 'pre_draft' || status === 'drafting') {
    events.push({
      id: 'draft',
      kind: 'draft',
      title: status === 'drafting' ? 'Draft — in progress' : 'Draft',
      at: null,
      allDay: false,
      week: null,
      whenLabel: status === 'drafting' ? 'Now' : 'No date on file',
      status: status === 'drafting' ? 'soon' : 'unscheduled',
      detail: input.native
        ? 'No draft date is set. Add one in draft settings so it shows here and in managers’ calendars.'
        : `${input.platformLabel} holds this draft’s date, and imports don’t carry it yet.`,
      source: src,
    })
  }

  // ── Waivers ──────────────────────────────────────────────────────────
  const waiverType = (input.waivers?.type ?? '').toLowerCase()
  if (!input.native) {
    gaps.push(`Waivers process on ${input.platformLabel}, and its processing schedule isn’t imported.`)
  } else if (NO_WAIVER_RUN.has(waiverType)) {
    gaps.push('This league has no waiver run — free agents are first come, first served.')
  } else if (input.waivers?.dayOfWeek != null && input.waivers.timeUtc) {
    const next = nextWeeklyRun(now, input.waivers.dayOfWeek, input.waivers.timeUtc)
    if (next) {
      events.push({
        id: 'waivers',
        kind: 'waivers',
        title: 'Waivers process',
        at: next.toISOString(),
        allDay: false,
        week: null,
        whenLabel: formatWhen(next, false),
        status: statusFor(next, now),
        detail: 'Every week at this time. Claims submitted before then are processed together.',
        source: 'allfantasy',
      })
    }
  } else {
    gaps.push('This league’s waiver processing time isn’t set.')
  }

  // ── Trade deadline ───────────────────────────────────────────────────
  if (input.noTradeDeadline) {
    gaps.push('No trade deadline — trades stay open all season.')
  } else if (input.tradeDeadlineWeek != null) {
    const week = input.tradeDeadlineWeek
    const start = input.weekStarts.get(week) ?? null
    events.push({
      id: 'trade-deadline',
      kind: 'trade_deadline',
      title: 'Trade deadline',
      at: start ? start.toISOString() : null,
      allDay: true,
      week,
      whenLabel: start ? `Week ${week} · ${formatWhen(start, true)}` : `Week ${week}`,
      status: start ? statusFor(start, now) : weekStatus(week, input.currentWeek),
      detail: start
        ? `Trades close in week ${week}, which kicks off on this date.`
        : `Trades close in week ${week}.`,
      source: src,
    })
  } else {
    gaps.push(`No trade deadline is published in this league’s ${input.native ? '' : `${input.platformLabel} `}settings.`)
  }

  // ── Playoffs ─────────────────────────────────────────────────────────
  if (input.playoffStartWeek != null && input.playoffStartWeek > 0) {
    const week = input.playoffStartWeek
    const start = input.weekStarts.get(week) ?? null
    events.push({
      id: 'playoffs',
      kind: 'playoffs',
      title: 'Playoffs begin',
      at: start ? start.toISOString() : null,
      allDay: true,
      week,
      whenLabel: start ? `Week ${week} · ${formatWhen(start, true)}` : `Week ${week}`,
      status: start ? statusFor(start, now) : weekStatus(week, input.currentWeek),
      detail: 'The regular season ends the week before.',
      source: src,
    })
  } else {
    gaps.push('No playoff start week is published for this league.')
  }

  // ── Dues ─────────────────────────────────────────────────────────────
  if (input.dues?.enabled) {
    events.push({
      id: 'dues',
      kind: 'dues',
      title: input.dues.unpaid > 0 ? `Dues — ${input.dues.unpaid} unpaid` : 'Dues — all paid',
      at: null,
      allDay: false,
      week: null,
      whenLabel: 'No due date',
      status: input.dues.unpaid > 0 ? 'soon' : 'past',
      detail: `${input.dues.amountLabel ? `${input.dues.amountLabel} per team. ` : ''}The dues tracker has no due date field, so this can’t be put on a calendar.`,
      source: 'allfantasy',
    })
  } else {
    gaps.push('Dues aren’t tracked in AllFantasy for this league.')
  }

  // ── Votes ────────────────────────────────────────────────────────────
  for (const poll of input.polls) {
    const at = poll.closesAt ? new Date(poll.closesAt) : null
    events.push({
      id: `vote:${poll.id}`,
      kind: 'vote',
      title: `Vote closes: ${poll.question}`,
      at: at ? at.toISOString() : null,
      allDay: false,
      week: null,
      whenLabel: at ? formatWhen(at, false) : 'No deadline',
      status: at ? statusFor(at, now) : 'unscheduled',
      detail: at ? 'League-chat poll.' : 'League-chat poll with no deadline — it stays open until someone closes it.',
      source: 'allfantasy',
    })
  }

  // ── Renewal ──────────────────────────────────────────────────────────
  if (status === 'complete') {
    events.push({
      id: 'renewal',
      kind: 'renewal',
      title: 'Renew for next season',
      at: null,
      allDay: false,
      week: null,
      whenLabel: 'Now',
      status: 'soon',
      detail: input.native
        ? 'This season is finished. Renew the league to carry rosters and managers forward.'
        : `This season is finished. Renew it on ${input.platformLabel}, then re-import so AllFantasy follows the new season.`,
      source: src,
    })
  }

  const order: Record<CalendarEvent['status'], number> = { soon: 0, upcoming: 1, unscheduled: 2, past: 3 }
  events.sort((a, b) => {
    const s = order[a.status] - order[b.status]
    if (s !== 0) return s
    const at = a.at ? Date.parse(a.at) : a.week != null ? 1e15 + a.week : Number.MAX_SAFE_INTEGER
    const bt = b.at ? Date.parse(b.at) : b.week != null ? 1e15 + b.week : Number.MAX_SAFE_INTEGER
    return a.status === 'past' ? bt - at : at - bt
  })

  return { events, gaps }
}

/** The soonest dated or week-keyed event that has not happened yet. */
export function nextDeadline(calendar: LeagueCalendar): CalendarEvent | null {
  return calendar.events.find((e) => (e.status === 'soon' || e.status === 'upcoming') && (e.at || e.week != null)) ?? null
}

// ── .ics export ─────────────────────────────────────────────────────────────

function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1')
}

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function icsDate(d: Date): string {
  // All-day events are the Eastern calendar day the week kicks off on.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
  return parts.replace(/-/g, '')
}

function utf8Bytes(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
}

/**
 * RFC 5545 folds content lines at 75 OCTETS, not characters. League and team
 * names carry em dashes and emoji, so counting characters would split a
 * multi-byte sequence or overrun the limit.
 */
export function foldIcsLine(line: string): string {
  const out: string[] = []
  let current = ''
  let bytes = 0
  for (const ch of line) {
    const size = utf8Bytes(ch)
    // Continuation lines start with a space, which counts toward their 75.
    const limit = out.length === 0 ? 75 : 74
    if (bytes + size > limit) {
      out.push(current)
      current = ''
      bytes = 0
    }
    current += ch
    bytes += size
  }
  out.push(current)
  return out.join('\r\n ')
}

/**
 * A calendar file of this league's DATED events only. A week number with no
 * kickoff behind it is not a date, and exporting it as one would put a guess in
 * twelve people's calendars.
 */
export function buildIcs(args: {
  leagueId: string
  leagueName: string
  events: CalendarEvent[]
  now: Date
  appUrl?: string
}): string | null {
  const dated = args.events.filter((e) => e.at && e.status !== 'past')
  if (dated.length === 0) return null
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AllFantasy//Commissioner Hub//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsText(`${args.leagueName} — league calendar`)}`,
  ]
  for (const e of dated) {
    const at = new Date(e.at as string)
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${e.id.replace(/[^a-zA-Z0-9:_-]/g, '-')}-${args.leagueId}@allfantasy.ai`)
    lines.push(`DTSTAMP:${icsStamp(args.now)}`)
    if (e.allDay) {
      const day = icsDate(at)
      const next = icsDate(new Date(at.getTime() + DAY_MS))
      lines.push(`DTSTART;VALUE=DATE:${day}`)
      lines.push(`DTEND;VALUE=DATE:${next}`)
    } else {
      lines.push(`DTSTART:${icsStamp(at)}`)
      lines.push(`DTEND:${icsStamp(new Date(at.getTime() + 60 * 60 * 1000))}`)
    }
    lines.push(`SUMMARY:${icsText(`${args.leagueName}: ${e.title}`)}`)
    lines.push(`DESCRIPTION:${icsText(e.detail)}`)
    if (args.appUrl) lines.push(`URL:${args.appUrl}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldIcsLine).join('\r\n') + '\r\n'
}
