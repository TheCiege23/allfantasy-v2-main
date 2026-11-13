/**
 * AllFantasy Time Engine — canonical types.
 * Server UTC is authoritative; account timezone is primary display/context; device fields are signals.
 */

export type LockWindowStatus = 'unknown' | 'open' | 'closing_soon' | 'locked' | 'not_applicable'

/** Full structured context for APIs, UI, and non-AI consumers. */
export type UserTimeContext = {
  serverNowUTC: string
  serverNowMs: number
  userTimezone: string
  userLocalNowISO: string
  userLocalDate: string
  userDayOfWeek: number
  userHour: number
  userMinute: number
  deviceTimezone: string | null
  deviceLocalNowISO: string | null
  deviceTimeLastSeenUTC: string | null
  timezoneMismatch: boolean
  deviceClockMismatch: boolean
  clockSkewSeconds: number | null
  currentFantasyDayWindowStartUTC: string
  currentFantasyDayWindowEndUTC: string
  lockWindowStatus: LockWindowStatus
  freshnessSummary: string
  warnings: string[]
}

export type FantasyDayWindowBlock = {
  startUTC: string
  endUTC: string
  calendarDateUserTz: string
}

export type DataFreshnessTimestamps = {
  injuriesLastUpdatedAt: string | null
  scoresLastUpdatedAt: string | null
  projectionsLastUpdatedAt: string | null
  newsLastUpdatedAt: string | null
  liveScoresLastUpdatedAt: string | null
}

export type RelativeCalendarHints = {
  todayInUserTz: string
  tomorrowDateInUserTz: string
  tonightWindowLabel: string
  thisWeekLabel: string
}

export type SportWindowHint = {
  likelyActive: boolean
  note: string
  sportUsed: string
}

/**
 * JSON-safe payload for AI prompts, Chimmy, and tool envelopes.
 * `currentServerTimeUTC` duplicates `serverNowUTC` for backward compatibility.
 */
export type AiTimeContextPayload = {
  schemaVersion: 1
  serverNowUTC: string
  currentServerTimeUTC: string
  userTimezone: string
  userLocalTime: string
  userLocalCalendarDate: string
  currentUserDate: string
  userDayOfWeek: number
  currentUserDayOfWeek: number
  currentUserDayOfWeekName: string
  deviceTimezone: string | null
  deviceLocalTime: string | null
  timezoneMismatch: boolean
  deviceClockMismatch: boolean
  clockSkewSeconds: number | null
  currentFantasyDayWindow: FantasyDayWindowBlock
  currentFantasyDayWindowStartUTC: string
  currentFantasyDayWindowEndUTC: string
  lockWindowStatus: LockWindowStatus
  freshnessSummary: string
  dataFreshness: DataFreshnessTimestamps
  relativeCalendarHints: RelativeCalendarHints
  sportWindow: SportWindowHint
  officialTimeAuthority: 'server_utc_plus_account_timezone'
  injuriesLastUpdatedAt: string | null
  scoresLastUpdatedAt: string | null
  projectionsLastUpdatedAt: string | null
  newsLastUpdatedAt: string | null
  liveScoresLastUpdatedAt: string | null
  waiversProcessAt: string | null
  matchupLockAt: string | null
  /** Alias of `matchupLockAt` — next lineup / matchup lock instant (UTC ISO). */
  nextLockTimeUTC: string | null
  tradeExpiresAt: string | null
  timeUntilNextLockMs: number | null
  timeUntilWaiversMs: number | null
  timeUntilTradeExpiryMs: number | null
  timeAuthorityNote: string
}

