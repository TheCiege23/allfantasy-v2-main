import { fromZonedTime } from 'date-fns-tz'

/**
 * A Survivor league's season rulebook, as plain facts the rulebook panel can word in any language
 * (components/core-app/survivor/SurvivorRulebook.tsx). Read from the league's Survivor config, which
 * both the summary and the commissioner dashboard carry. Pure.
 */

export type RulebookConfig = {
  tribeCount?: number | null
  tribeSize?: number | null
  tribeFormation?: string | null
  mergeTrigger?: string | null
  mergeWeek?: number | null
  mergePlayerCount?: number | null
  juryStartAfterMerge?: number | null
  exileReturnEnabled?: boolean | null
  exileReturnTokens?: number | null
  idolCount?: number | null
  tribeShuffleEnabled?: boolean | null
  voteDeadlineDayOfWeek?: number | null
  voteDeadlineTimeUtc?: string | null
  /**
   * When Tribal votes are REALLY due: the settings screen's vote day/time (League.settings
   * tribalCouncilDay / tribalCouncilTime, Eastern), the same values the council scheduler reads
   * (nextTorchCeremonyDeadline), less the finale rule "ballots due N hours before the ceremony".
   * Preferred over the two bootstrap-only columns above, which no edit ever updates.
   */
  tribalVotesDue?: TribalVotesDue | null
  selfVoteDisallowed?: boolean | null
  minigameFrequency?: string | null
  seasonThemeLabel?: string | null
}

export type TribalVotesDue = { day: string; timeEt: string; hoursBefore: number }

export const RULEBOOK_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

export type RulebookRule =
  | { id: 'tribes'; count: number; size: number | null; formation: 'random' | 'commissioner' }
  | { id: 'merge'; byWeek: number | null; byPlayers: number | null }
  | { id: 'jury'; afterMerge: number }
  | { id: 'exile'; on: boolean; tokens: number }
  | { id: 'idols'; count: number }
  | { id: 'swap'; on: boolean }
  | { id: 'vote'; day: number | null; timeUtc: string | null; selfVote: boolean; timeEt?: string | null; hoursBefore?: number }
  | { id: 'challenges'; frequency: string }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Every rule the config states. A rule whose facts are missing is left out rather than guessed. */
export function rulebook(c: RulebookConfig | null | undefined): RulebookRule[] {
  if (!c) return []
  const rules: RulebookRule[] = []
  const count = num(c.tribeCount)
  if (count && count > 0) rules.push({ id: 'tribes', count, size: num(c.tribeSize), formation: c.tribeFormation === 'commissioner' ? 'commissioner' : 'random' })
  const byWeek = c.mergeTrigger === 'player_count' ? null : num(c.mergeWeek)
  const byPlayers = c.mergeTrigger === 'player_count' ? num(c.mergePlayerCount) : null
  if (byWeek != null || byPlayers != null) rules.push({ id: 'merge', byWeek, byPlayers })
  const jury = num(c.juryStartAfterMerge)
  if (jury != null) rules.push({ id: 'jury', afterMerge: Math.max(0, jury) })
  if (c.exileReturnEnabled != null) rules.push({ id: 'exile', on: Boolean(c.exileReturnEnabled), tokens: num(c.exileReturnTokens) ?? 0 })
  const idols = num(c.idolCount)
  if (idols != null) rules.push({ id: 'idols', count: idols })
  if (c.tribeShuffleEnabled != null) rules.push({ id: 'swap', on: Boolean(c.tribeShuffleEnabled) })
  const due = c.tribalVotesDue
  const dueDay = due ? RULEBOOK_WEEKDAYS.indexOf(due.day as (typeof RULEBOOK_WEEKDAYS)[number]) : -1
  if (due && dueDay >= 0 && /^([01]\d|2[0-3]):[0-5]\d$/.test(due.timeEt)) {
    rules.push({ id: 'vote', day: dueDay, timeUtc: null, timeEt: due.timeEt, hoursBefore: Math.max(0, Math.floor(due.hoursBefore || 0)), selfVote: c.selfVoteDisallowed === false })
  } else {
    const day = num(c.voteDeadlineDayOfWeek)
    const time = typeof c.voteDeadlineTimeUtc === 'string' && /^\d{1,2}:\d{2}/.test(c.voteDeadlineTimeUtc) ? c.voteDeadlineTimeUtc.slice(0, 5) : null
    if (day != null || time != null) rules.push({ id: 'vote', day: day != null && day >= 0 && day <= 6 ? day : null, timeUtc: time, selfVote: c.selfVoteDisallowed === false })
  }
  if (c.minigameFrequency && c.minigameFrequency !== 'none') rules.push({ id: 'challenges', frequency: c.minigameFrequency })
  return rules
}

/**
 * The vote deadline in the reader's own time zone: the weekday and time a UTC "day + HH:MM" lands on
 * this week. Null when either half is missing.
 */
export function localDeadline(day: number | null, timeUtc: string | null, locale?: string): string | null {
  if (day == null || !timeUtc) return null
  const [h, m] = timeUtc.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  // A fixed reference week (Sunday 2026-11-01 UTC) so the weekday maths never depends on today.
  const at = new Date(Date.UTC(2026, 10, 1 + day, h, m))
  return at.toLocaleString(locale, { weekday: 'long', hour: 'numeric', minute: '2-digit' })
}

const EASTERN = 'America/New_York'

/** The Eastern calendar date (YYYY-MM-DD) of an instant. */
function easternDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: EASTERN, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

/**
 * The next instant votes are due: the next `day` at `timeEt` Eastern (the Torch Ceremony, exactly as
 * the scheduler resolves it, DST included), less `hoursBefore`. Null when the facts are missing.
 */
export function nextTribalVotesDueAt(day: number | null, timeEt: string | null | undefined, hoursBefore = 0, now: Date = new Date()): Date | null {
  if (day == null || day < 0 || day > 6 || !timeEt || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeEt)) return null
  for (let offset = 0; offset <= 8; offset++) {
    const date = easternDate(new Date(now.getTime() + offset * 86_400_000))
    if (new Date(`${date}T12:00:00Z`).getUTCDay() !== day) continue
    const ceremony = fromZonedTime(`${date}T${timeEt}:00`, EASTERN)
    const due = new Date(ceremony.getTime() - Math.max(0, hoursBefore) * 3_600_000)
    if (due.getTime() > now.getTime()) return due
  }
  return null
}

/** The vote row's "when", in the reader's own zone: the settings-screen value when present, else the legacy UTC pair. */
export function voteRuleWhen(rule: Extract<RulebookRule, { id: 'vote' }>, locale?: string, now: Date = new Date()): string | null {
  if (rule.timeEt) {
    const at = nextTribalVotesDueAt(rule.day, rule.timeEt, rule.hoursBefore ?? 0, now)
    return at ? at.toLocaleString(locale, { weekday: 'long', hour: 'numeric', minute: '2-digit' }) : null
  }
  return localDeadline(rule.day, rule.timeUtc, locale)
}
