/**
 * Weekly Clubhouse prompts and the date keys every scheduled Clubhouse thread hangs off.
 * Pure — no database — so the rotation and the keys are tested directly.
 *
 * ⚠ EVERY SYSTEM THREAD IS KEYED, AND THE KEY IS THE ONLY THING THAT MAKES IT RUN ONCE.
 * `CommunityPost.systemKey` is unique, so a cron that fires twice, a retry, or two replicas
 * racing each other all converge on one row. Change a key's format and the next run writes
 * a second copy of the current week's thread.
 */

export type WeeklyPrompt = { channel: string; title: string; body: string }

/**
 * Appending is free; reordering moves every future week to a different prompt (a past
 * week's thread is already written and does not change). Each one should be answerable by
 * someone who has run one league for one season.
 */
export const WEEKLY_PROMPTS: readonly WeeklyPrompt[] = [
  {
    channel: 'commish-corner',
    title: "What's the one league rule you would never give up?",
    body: 'Every league has the rule that makes it theirs. What is yours, and what happened the season before you added it?',
  },
  {
    channel: 'commish-corner',
    title: 'How do you keep the last-place team trying in week 12?',
    body: 'Toilet bowls, punishments, draft-order prizes, shame. What has actually worked in your league?',
  },
  {
    channel: 'league-lab',
    title: 'Pitch a league format in one sentence',
    body: 'One sentence, no rulebook. Best ones get turned into proper League Lab ideas.',
  },
  {
    channel: 'commish-corner',
    title: 'The worst trade you ever had to approve (or veto)',
    body: 'No names needed. What was it, and what did you do?',
  },
  {
    channel: 'other-apps',
    title: 'What does your other fantasy app do better than anyone?',
    body: 'Be honest. If there is a feature you would steal for AllFantasy, name it.',
  },
  {
    channel: 'commish-corner',
    title: 'Snake, auction, or something weirder?',
    body: 'What draft format does your league use, and would you switch?',
  },
  {
    channel: 'sports-news',
    title: 'Who is your league-winner pick for the rest of the season?',
    body: 'One player, any sport. Defend it.',
  },
  {
    channel: 'ask-the-founder',
    title: 'What should AllFantasy build next?',
    body: 'The founder reads every reply in this thread. Small fixes and big swings both welcome.',
  },
  {
    channel: 'commish-corner',
    title: 'Dues, prizes, trophies: what is on the line in your league?',
    body: 'Money, a belt, a sash, a punishment? What keeps people caring?',
  },
  {
    channel: 'commish-corner',
    title: 'How do you settle a rules dispute without losing a friend?',
    body: 'Vote, commissioner ruling, coin flip? What is your process?',
  },
  {
    channel: 'league-lab',
    title: 'Which scoring setting would you change tomorrow?',
    body: 'PPR, TE premium, bonuses, negative points. One change, and why.',
  },
  {
    channel: 'introductions',
    title: 'Roll call: how many leagues are you in this season?',
    body: 'And which one do you care about most? New members, this is a good place to say hi.',
  },
] as const

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
/** Monday 2026-01-05 00:00 ET as a fixed epoch, so rotation does not depend on the year. */
const ROTATION_EPOCH = Date.UTC(2026, 0, 5, 5)

/**
 * The calendar date in US Eastern time, as YYYY-MM-DD. Eastern because that is the date
 * fantasy players live by — a UTC date flips mid-way through Sunday night football.
 */
export function easternDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** The Monday (Eastern) that starts `now`'s week, as YYYY-MM-DD. */
export function easternWeekStart(now: Date): string {
  const [y, m, d] = easternDate(now).split('-').map(Number) as [number, number, number]
  const noonUtc = Date.UTC(y, m - 1, d, 12)
  const dow = new Date(noonUtc).getUTCDay() // 0 Sunday … 6 Saturday
  const back = (dow + 6) % 7
  return new Date(noonUtc - back * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function weeklyPromptFor(now: Date): { prompt: WeeklyPrompt; weekStart: string; index: number } {
  const weekStart = easternWeekStart(now)
  const weeks = Math.floor((Date.parse(`${weekStart}T12:00:00Z`) - ROTATION_EPOCH) / WEEK_MS)
  const n = WEEKLY_PROMPTS.length
  const index = ((weeks % n) + n) % n
  return { prompt: WEEKLY_PROMPTS[index]!, weekStart, index }
}

export const systemKeys = {
  weeklyPrompt: (weekStart: string) => `prompt:${weekStart}`,
  newsDesk: (day: string) => `news:${day}`,
  gameDay: (day: string) => `gameday:${day}`,
}

/**
 * UTC instants bounding an Eastern calendar day: [start, end). Eastern midnight is 04:00Z
 * under daylight time and 05:00Z under standard time; the probe below picks the right one.
 * On the two changeover days the bound can be an hour off, which only shifts which late
 * game is listed first — acceptable for a slate, wrong for anything that counts money.
 */
export function easternDayBoundsUtc(day: string): { start: Date; end: Date } {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const standard = Date.UTC(y, m - 1, d, 5)
  const start = easternDate(new Date(standard - 60 * 60 * 1000)) === day ? standard - 60 * 60 * 1000 : standard
  return { start: new Date(start), end: new Date(start + 24 * 60 * 60 * 1000) }
}

/** "Sunday, November 2" — for thread titles. */
export function easternDayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  )
}

/** Hour of the day (0–23) in US Eastern time. */
export function easternHour(now: Date): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(now)
  return Number(h) % 24
}

/** The news desk waits for the morning, so it is not posted at midnight with yesterday's news. */
export const NEWS_DESK_EARLIEST_ET_HOUR = 7
