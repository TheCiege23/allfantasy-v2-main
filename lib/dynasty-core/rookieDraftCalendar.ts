/**
 * When a dynasty league's rookie draft opens.
 *
 * The sport's calendar lives in ONE place, `dynastySportConfig.ts` (`offseason.rookieDraftMonth`,
 * `rookieDraftWindowEndMonth`, `rookieDraftYearOffset`), and both of its readers go through it:
 * pick valuation's pre-draft bump (`lib/fantasycalc.ts`) and the scheduled auto-open
 * (`openRookieDraftsOnCalendar.ts`). Before this, the month was read by valuation only and nothing
 * opened a rookie draft at all — a commissioner had to click "Create next draft".
 *
 * Defaults, from the real-world drafts (`proDraftMonth`) each rookie class comes out of:
 *
 *   NFL  draft late April        → rookie draft window May
 *   NBA  draft late June         → July
 *   NHL  Entry Draft late June   → July
 *   MLB  draft mid-July (mid-season) → the offseason after the World Series, November–January,
 *        in the calendar year BEFORE the season it seeds (Nov 2026 seeds 2027)
 *
 * Seasons are keyed by the year they BEGIN (`leagueCreationSeason.ts`), so for every sport but MLB
 * the window falls in the seeded season's own year.
 *
 * A commissioner may turn auto-open on or off and set a custom open date; both live in
 * `League.settings[ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY]` — no schema change. Unset, auto-open follows
 * the league's plan: on for AF Commissioner, off otherwise ({@link resolveRookieDraftAutoOpen}).
 */
import { DYNASTY_SPORT_CONFIGS, type DynastySportConfig } from './dynastySportConfig'

export const ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY = 'dynasty_rookie_draft_calendar'

/**
 * The default for a league whose commissioner does NOT hold AF Commissioner, and the value read
 * when nothing else is known. Free leagues create the next draft with the button.
 */
export const ROOKIE_DRAFT_AUTO_OPEN_DEFAULT = false

/**
 * Leagues whose commissioner holds AF Commissioner open their rookie draft automatically unless the
 * commissioner switched it off (spec §1.1, owner decision 2026-10-27).
 *
 * ⚠ ONLY FOR AN OFFSEASON THAT BEGAN ON OR AFTER THIS INSTANT. An offseason already under way when
 * this shipped (an MLB league crowned this October, say) would otherwise get a rookie draft created
 * under it, and its league moved to `pre_draft`, on the first roller tick. Those leagues keep auto-open
 * off and their commissioner is told once, with the switch to turn it on.
 */
export const ROOKIE_DRAFT_PLAN_DEFAULT_FROM = new Date('2026-10-28T00:00:00Z')

export type RookieDraftAutoOpenDecision = {
  autoOpen: boolean
  source:
    /** The commissioner set the switch; their choice stands. */
    | 'commissioner'
    /** AF Commissioner, offseason began after the plan default shipped. */
    | 'plan_default'
    /** AF Commissioner, but this offseason was already under way: off, and the commissioner is told. */
    | 'plan_default_predates'
    /** No AF Commissioner. */
    | 'free_default'
}

/**
 * Whether THIS offseason's rookie draft opens automatically. Pure: the caller supplies whether the
 * commissioner holds AF Commissioner and when the offseason began (next season's shell was created).
 */
export function resolveRookieDraftAutoOpen(input: {
  settings: unknown
  commissionerPlan: boolean
  offseasonStartedAt: Date
}): RookieDraftAutoOpenDecision {
  const explicit = readExplicitAutoOpen(input.settings)
  if (explicit !== null) return { autoOpen: explicit, source: 'commissioner' }
  if (!input.commissionerPlan) return { autoOpen: ROOKIE_DRAFT_AUTO_OPEN_DEFAULT, source: 'free_default' }
  if (input.offseasonStartedAt.getTime() < ROOKIE_DRAFT_PLAN_DEFAULT_FROM.getTime()) {
    return { autoOpen: false, source: 'plan_default_predates' }
  }
  return { autoOpen: true, source: 'plan_default' }
}

/** The hour (UTC) a window opens on its day: 12:00 UTC is the morning in every US time zone. */
const OPEN_HOUR_UTC = 12

export type RookieDraftCalendarSettings = {
  autoOpen: boolean
  /** `YYYY-MM-DD`, or null for the sport default. */
  customOpenDate: string | null
}

export type RookieDraftWindow = {
  sport: string
  /** The season the rookie draft seeds. */
  season: number
  opensAt: Date
  /** End of the sport's default window. Null for a custom date, which names only an opening. */
  closesAt: Date | null
  source: 'sport_default' | 'custom'
}

/** The sport's own calendar, or null for a sport with none — `getDynastySportConfig` would quietly use NFL's. */
export function sportRookieDraftCalendar(sport: string | null | undefined): DynastySportConfig['offseason'] | null {
  const key = String(sport ?? '').toLowerCase().replace(/[^a-z]/g, '')
  return DYNASTY_SPORT_CONFIGS[key]?.offseason ?? null
}

/** Calendar year a rookie draft for `season` is held in (MLB: the winter before it). */
export function rookieDraftCalendarYear(offseason: Pick<DynastySportConfig['offseason'], 'rookieDraftYearOffset'>, season: number): number {
  return season + (offseason.rookieDraftYearOffset ?? 0)
}

/** The sport's default window for the rookie draft that seeds `season`. */
export function defaultRookieDraftWindow(sport: string, season: number): RookieDraftWindow | null {
  const cal = sportRookieDraftCalendar(sport)
  if (!cal || !Number.isInteger(season)) return null
  const year = rookieDraftCalendarYear(cal, season)
  const openMonth = cal.rookieDraftMonth
  const endMonth = cal.rookieDraftWindowEndMonth ?? openMonth
  const endYear = endMonth < openMonth ? year + 1 : year
  return {
    sport: sport.toUpperCase(),
    season,
    opensAt: new Date(Date.UTC(year, openMonth - 1, 1, OPEN_HOUR_UTC)),
    // The first moment of the month after the window's last one.
    closesAt: new Date(Date.UTC(endYear, endMonth, 1, OPEN_HOUR_UTC)),
    source: 'sport_default',
  }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The sport's default window in words — "May", "November–January" — or null for a sport with none. */
export function describeRookieDraftWindow(sport: string | null | undefined): string | null {
  const cal = sportRookieDraftCalendar(sport)
  if (!cal) return null
  const open = MONTHS[cal.rookieDraftMonth - 1]
  const end = cal.rookieDraftWindowEndMonth
  return end && end !== cal.rookieDraftMonth ? `${open}–${MONTHS[end - 1]}` : open
}

/** A real calendar date in `YYYY-MM-DD` form, or null. */
export function normalizeCustomOpenDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  return v
}

function calendarObject(settings: unknown): Record<string, unknown> {
  const all = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  const raw = all[ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY]
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

/** The commissioner's own auto-open choice, or null when they never set it. */
export function readExplicitAutoOpen(settings: unknown): boolean | null {
  const v = calendarObject(settings).autoOpen
  return typeof v === 'boolean' ? v : null
}

/**
 * The stored settings. `autoOpen` here is the commissioner's choice or the free default; it does not
 * know the league's plan — use {@link resolveRookieDraftAutoOpen} for what will actually happen.
 */
export function readRookieDraftCalendarSettings(settings: unknown): RookieDraftCalendarSettings {
  const o = calendarObject(settings)
  return {
    autoOpen: readExplicitAutoOpen(settings) ?? ROOKIE_DRAFT_AUTO_OPEN_DEFAULT,
    customOpenDate: normalizeCustomOpenDate(o.customOpenDate),
  }
}

/**
 * When THIS offseason's rookie draft opens.
 *
 * A custom date is a full date, so it names one offseason: it applies only when it falls on or after
 * `offseasonStartedAt` (when next season's shell was created, i.e. when the champion was crowned).
 * Last year's date is therefore ignored rather than opening this year's draft at once, and the sport
 * default applies until the commissioner sets a new one.
 */
export function resolveRookieDraftWindow(input: {
  sport: string
  season: number
  settings: unknown
  offseasonStartedAt: Date
}): RookieDraftWindow | null {
  const fallback = defaultRookieDraftWindow(input.sport, input.season)
  const { customOpenDate } = readRookieDraftCalendarSettings(input.settings)
  if (customOpenDate) {
    const [y, mo, d] = customOpenDate.split('-').map(Number)
    const opensAt = new Date(Date.UTC(y, mo - 1, d, OPEN_HOUR_UTC))
    const startedDay = Date.UTC(
      input.offseasonStartedAt.getUTCFullYear(),
      input.offseasonStartedAt.getUTCMonth(),
      input.offseasonStartedAt.getUTCDate(),
    )
    if (Date.UTC(y, mo - 1, d) >= startedDay) {
      return { sport: input.sport.toUpperCase(), season: input.season, opensAt, closesAt: null, source: 'custom' }
    }
  }
  return fallback
}
