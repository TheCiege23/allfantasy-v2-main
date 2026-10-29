/**
 * Survivor island mood (survivor-theme handoff, "Choosing the mood"). Picked from league state,
 * never a user setting:
 *
 * | League state                                        | Mood  |
 * | voteDeadlineAt is today and still in the future     | dusk  |
 * | Between revealStartsAt and the end of the reveal    | night |
 * | Any Exile Island screen                             | exile |
 * | Everything else                                     | day   |
 *
 * Client-safe and pure; pass `now` (and a time zone for "today") from the caller.
 */

export const SURVIVOR_MOODS = ['day', 'dusk', 'night', 'exile'] as const
export type SurvivorMood = (typeof SURVIVOR_MOODS)[number]

export const SURVIVOR_SCENE_SPORTS = ['football', 'basketball', 'baseball', 'hockey', 'soccer'] as const
export type SurvivorSceneSport = (typeof SURVIVOR_SCENE_SPORTS)[number]

/**
 * How long the island stays at night after the read-out begins when the council does not say
 * when the reveal ends. The scroll read-out itself takes minutes; managers who open the app in the
 * hours after it should still land on the council fire.
 */
export const SURVIVOR_REVEAL_NIGHT_MS = 2 * 60 * 60 * 1000

/** The kicker over the league name, per mood (copy from SurvivorTheme.dc.html). */
export const SURVIVOR_MOOD_TAG: Record<SurvivorMood, string> = {
  day: 'Draft & regular week',
  dusk: 'Vote deadline today',
  night: 'Tribal Council',
  exile: 'Exile Island',
}

type Instant = string | Date | null | undefined

function toMs(value: Instant): number | null {
  if (value == null) return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function calendarDay(ms: number, timeZone?: string): string {
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
    } catch {
      // Unknown zone: fall back to the runtime's local day.
    }
  }
  const date = new Date(ms)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export type SurvivorMoodInput = {
  now: Date | number
  /** The open council's vote deadline. */
  voteDeadlineAt?: Instant
  /** When the council read-out began (`SurvivorTribalCouncil.revealStartsAt`). */
  revealStartsAt?: Instant
  /** When the read-out ends, if known; defaults to `revealStartsAt + SURVIVOR_REVEAL_NIGHT_MS`. */
  revealEndsAt?: Instant
  /** The screen is an Exile Island screen. */
  exileScreen?: boolean
  /** IANA zone that defines "today" for the viewer; defaults to the runtime's local zone. */
  timeZone?: string
}

export function resolveSurvivorMood(input: SurvivorMoodInput): SurvivorMood {
  if (input.exileScreen) return 'exile'
  const now = typeof input.now === 'number' ? input.now : input.now.getTime()
  const revealStart = toMs(input.revealStartsAt)
  if (revealStart != null) {
    const revealEnd = toMs(input.revealEndsAt) ?? revealStart + SURVIVOR_REVEAL_NIGHT_MS
    if (now >= revealStart && now < revealEnd) return 'night'
  }
  const deadline = toMs(input.voteDeadlineAt)
  if (deadline != null && deadline > now && calendarDay(deadline, input.timeZone) === calendarDay(now, input.timeZone)) return 'dusk'
  return 'day'
}

/** NFL/NCAAF use football, NBA/NCAAB basketball. Unknown sports fall back to football. */
export function survivorSceneSport(sport: string | null | undefined): SurvivorSceneSport {
  const key = String(sport ?? '').toUpperCase().replace(/[^A-Z]/g, '')
  if (key === 'NBA' || key === 'NCAAB' || key === 'NCAABB' || key === 'WNBA') return 'basketball'
  if (key === 'MLB') return 'baseball'
  if (key === 'NHL') return 'hockey'
  if (key === 'SOCCER' || key === 'MLS' || key === 'EPL' || key === 'WORLDCUP') return 'soccer'
  return 'football'
}

/** Only whitelisted mood/sport filenames reach an image URL. */
export function survivorBackgroundSrc(mood: SurvivorMood, sport: string | null | undefined): string {
  const safeMood = (SURVIVOR_MOODS as readonly string[]).includes(mood) ? mood : 'day'
  return `/survivor/backgrounds/${safeMood}-${survivorSceneSport(sport)}.svg`
}
