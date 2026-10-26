/**
 * The commissioner's Storyline Studio switches, kept in `League.settings.storyline_studio`.
 * Pure: read, write-back and the "is it time" rule. No schema change — the same JSON-in-settings
 * convention the deadline autopilot and scheduled announcements use.
 *
 *   autoPost        OFF by default. When on, the week's top hook is posted to the league chat once,
 *                   at the commissioner's chosen weekday and hour in their own time zone.
 *   includePoll     Also post that matchup's prediction poll (lib/league-chat/predictionPolls.ts).
 *   enabledByUserId Who turned it on — the post is theirs, and THEIR plan is re-checked at send time,
 *                   so a lapsed AF Commissioner plan stops the posts. The switch and the history stay.
 *   posted          Week key → what went out. A record for the commissioner; the guarantee against a
 *                   double post is the chat row's deterministic id, not this map.
 */

export const STORYLINE_SETTINGS_KEY = 'storyline_studio'

export type PostedRecord = { at: string; messageId: string; hookId: string; auto: boolean }

export type StorylineSettings = {
  autoPost: boolean
  includePoll: boolean
  /** 0 = Sunday … 6 = Saturday, in `timeZone`. */
  weekday: number
  /** 0-23, in `timeZone`. */
  hour: number
  timeZone: string
  enabledByUserId: string | null
  posted: Record<string, PostedRecord>
}

export const DEFAULT_STORYLINE_SETTINGS: StorylineSettings = {
  autoPost: false,
  includePoll: false,
  weekday: 3,
  hour: 12,
  timeZone: 'America/New_York',
  enabledByUserId: null,
  posted: {},
}

/** Keep the record bounded: a season is ~18 weeks; two seasons is plenty of history to show. */
const POSTED_KEEP = 40

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function readStorylineSettings(settings: unknown): StorylineSettings {
  const raw = isRecord(settings) && isRecord(settings[STORYLINE_SETTINGS_KEY]) ? settings[STORYLINE_SETTINGS_KEY] : {}
  const r = raw as Record<string, unknown>
  const weekday = Number(r.weekday)
  const hour = Number(r.hour)
  const posted: Record<string, PostedRecord> = {}
  if (isRecord(r.posted)) {
    for (const [k, v] of Object.entries(r.posted)) {
      if (isRecord(v) && typeof v.messageId === 'string' && typeof v.at === 'string') {
        posted[k] = { at: v.at, messageId: v.messageId, hookId: String(v.hookId ?? ''), auto: v.auto === true }
      }
    }
  }
  return {
    autoPost: r.autoPost === true,
    includePoll: r.includePoll === true,
    weekday: Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : DEFAULT_STORYLINE_SETTINGS.weekday,
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_STORYLINE_SETTINGS.hour,
    timeZone: isValidTimeZone(r.timeZone) ? r.timeZone : DEFAULT_STORYLINE_SETTINGS.timeZone,
    enabledByUserId: typeof r.enabledByUserId === 'string' && r.enabledByUserId ? r.enabledByUserId : null,
    posted,
  }
}

export function withStorylineSettings(settings: unknown, next: StorylineSettings): Record<string, unknown> {
  const base = isRecord(settings) ? settings : {}
  const keys = Object.keys(next.posted).sort().slice(-POSTED_KEEP)
  const posted = Object.fromEntries(keys.map((k) => [k, next.posted[k]]))
  return { ...base, [STORYLINE_SETTINGS_KEY]: { ...next, posted } }
}

export function storylineWeekKey(season: number, week: number): string {
  return `${season}-w${String(week).padStart(2, '0')}`
}

/** One auto-post per league per fantasy week, by row id: a second sweep or replica cannot double it. */
export function autoPostMessageId(leagueId: string, season: number, week: number): string {
  return `storyline_${leagueId}_${storylineWeekKey(season, week)}`.slice(0, 120)
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The weekday (0-6) and hour (0-23) of `now` in `timeZone`. */
export function localWeekdayHour(now: Date, timeZone: string): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now)
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const hr = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  return { weekday: Math.max(0, WEEKDAYS.indexOf(wd)), hour: hr === 24 ? 0 : hr }
}

/**
 * Is it the commissioner's posting time? From their hour until the end of that local day, so a sweep
 * that runs a little late (or a replica that restarted) still posts that day. The week's row id is
 * what keeps it to one post; this only decides the day.
 */
export function isAutoPostDue(s: StorylineSettings, now: Date): boolean {
  if (!s.autoPost) return false
  const local = localWeekdayHour(now, s.timeZone)
  return local.weekday === s.weekday && local.hour >= s.hour
}

export type SettingsPatch = Partial<Pick<StorylineSettings, 'autoPost' | 'includePoll' | 'weekday' | 'hour' | 'timeZone'>>

/** Validate a commissioner's PUT body. Unknown keys are ignored; a bad value is a 400, not a default. */
export function parseSettingsPatch(body: unknown): { ok: true; patch: SettingsPatch } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: 'invalid_body' }
  const patch: SettingsPatch = {}
  if (body.autoPost !== undefined) {
    if (typeof body.autoPost !== 'boolean') return { ok: false, error: 'invalid_autoPost' }
    patch.autoPost = body.autoPost
  }
  if (body.includePoll !== undefined) {
    if (typeof body.includePoll !== 'boolean') return { ok: false, error: 'invalid_includePoll' }
    patch.includePoll = body.includePoll
  }
  if (body.weekday !== undefined) {
    const n = Number(body.weekday)
    if (!Number.isInteger(n) || n < 0 || n > 6) return { ok: false, error: 'invalid_weekday' }
    patch.weekday = n
  }
  if (body.hour !== undefined) {
    const n = Number(body.hour)
    if (!Number.isInteger(n) || n < 0 || n > 23) return { ok: false, error: 'invalid_hour' }
    patch.hour = n
  }
  if (body.timeZone !== undefined) {
    if (!isValidTimeZone(body.timeZone)) return { ok: false, error: 'invalid_timeZone' }
    patch.timeZone = body.timeZone
  }
  return { ok: true, patch }
}
