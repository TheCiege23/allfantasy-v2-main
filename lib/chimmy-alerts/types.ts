import type { AIActionType } from '@/lib/chimmy-actions'

export type ChimmyAlertClass =
  | 'lineup'
  | 'waiver'
  | 'trade'
  | 'draft'
  | 'matchup'
  | 'team_roster'
  | 'commissioner'
  | 'story_engagement'
  | 'specialty'
  | 'admin_integrity'

export type ChimmyAlertSeverity = 'informational' | 'action_recommended' | 'urgent' | 'critical'

export type ChimmyAlertChannel =
  | 'in_app_banner'
  | 'dashboard_card'
  | 'notification_center'
  | 'floating_nudge'
  | 'critical_drawer'
  | 'page_inline'
  | 'commissioner_panel'
  | 'private_ai_chat'
  | 'league_chat_suggestion'
  | 'push_notification'
  | 'email'
  | 'sms'
  | 'mobile_push'

export type ChimmyAlertLifecycleEvent =
  | 'created'
  | 'shown'
  | 'clicked'
  | 'dismissed'
  | 'snoozed'
  | 'acted_on'
  | 'resolved'
  | 'expired'

export interface ChimmyAlertAction {
  label: string
  href?: string
  actionType?: AIActionType
  payload?: Record<string, unknown>
}

export interface ChimmyAlert {
  alertId: string
  dedupeKey: string
  class: ChimmyAlertClass
  type: string
  title: string
  message: string
  severity: ChimmyAlertSeverity
  confidenceScore: number
  urgencyScore: number
  urgencyDeadlineAt?: string | null
  channels: ChimmyAlertChannel[]
  primaryChannel: ChimmyAlertChannel
  dismissible: boolean
  snoozable: boolean
  repeatable: boolean
  repeatCooldownMinutes: number
  expiresAt?: string | null
  leagueId?: string | null
  teamId?: string | null
  sport?: string | null
  leagueType?: string | null
  roleScope: 'member' | 'commissioner' | 'admin'
  actions: ChimmyAlertAction[]
  metadata?: Record<string, unknown>
}

/**
 * A rostered STARTER carrying an injury designation, with the best available replacement.
 *
 * This is the signal the Sunday-panic case turns on — "OUT and still starting, 45 minutes to
 * lock" — and it did not exist. `hydrateSignalBundle` previously queried only draft state,
 * storylines and pending trades, so no detector could fire on an injury no matter how fresh
 * the injury table was.
 */
export interface InjuredStarterSignal {
  playerName: string
  position: string | null
  /** Parsed designation, e.g. "Out" / "Doubtful" / "Questionable". Never invented. */
  designation: string
  /** Body part or prose detail, when the provider stated one. */
  detail?: string | null
  leagueId: string
  leagueName?: string | null
  /** Where the manager must actually go to fix it — imported leagues are not editable here. */
  platform?: string | null
  /**
   * When THIS player locks — his own kickoff, from the real schedule.
   *
   * Deliberately per-player rather than per-league. A Thursday-night starter locks Thursday
   * while a 4:25pm starter locks Sunday afternoon, so a single league-wide lock time would be
   * wrong for most of a roster. Null when the schedule has no game for him (bye, or no row).
   */
  lockAt?: string | null
  /** Best replacement on the bench, when a projection exists to rank by. */
  replacement?: { playerName: string; projectedPoints: number | null } | null
  /**
   * True when the designation is older than the freshness window. A two-week-old
   * "Questionable" is a false statement, not old data, so it is carried rather than hidden.
   */
  stale?: boolean
}

export interface ChimmyAlertSignalBundle {
  lineupIncomplete?: boolean
  lineupLockAt?: string | null
  /** Rostered starters carrying an injury designation. Empty array = checked, none found. */
  injuredStarters?: InjuredStarterSignal[]
  highConfidenceStartSitSwing?: boolean
  highConfidenceWaiverAdd?: { playerName: string; confidence: number; faabPct?: number } | null
  tradeOfferPendingCount?: number
  tradeFairnessWarning?: boolean
  draftStartingSoon?: boolean
  onTheClock?: boolean
  queueEmpty?: boolean
  winProbabilityShiftPct?: number
  weatherRiskPlayerCount?: number
  irEligibleCount?: number
  benchRedundancyCount?: number
  goalieMinimumAtRisk?: boolean
  categoryImbalanceCritical?: boolean
  inactiveTeamCount?: number
  suspiciousTradeSignal?: boolean
  specialtyPhaseTransition?: { mode: string; phase: string; startsAt?: string | null } | null
  engagementStoryReady?: boolean
}

// ── Per-class and per-type fine controls ─────────────────────────────────────

export interface ChimmyAlertClassPref {
  muted?: boolean
  frequency?: 'normal' | 'reduced' | 'minimal'
}

export interface ChimmyAlertTypeOverride {
  muted?: boolean
  /** Multiplies the alert's repeatCooldownMinutes. 2 = half as often, 4 = quarterly. */
  cooldownMultiplier?: number
  channelOverride?: ChimmyAlertChannel[]
}

export interface ChimmyAlertLeaguePref {
  leagueId: string
  /** When true, all Chimmy alerts for this league are suppressed. */
  disabled?: boolean
  mutedClasses?: ChimmyAlertClass[]
}

export interface ChimmyAlertCommissionerPref {
  enabled: boolean
  receiveSuspiciousTradeAlerts?: boolean
  receiveOrphanTeamAlerts?: boolean
  receiveWeeklyRecapAlerts?: boolean
  receiveIntegrityAlerts?: boolean
}

export interface ChimmyAlertSnoozedEntry {
  dedupeKey: string
  /** Unix timestamp (ms) when the snooze expires. */
  snoozeUntil: number
}

// ── Main preferences bag ──────────────────────────────────────────────────────

export interface ChimmyAlertUserPreferences {
  // --- existing (keep backward compat) ---
  mutedClasses?: ChimmyAlertClass[]
  mutedTypes?: string[]
  quietHours?: { startHour: number; endHour: number; timezone?: string; allowCritical?: boolean }
  channelOverrides?: Partial<Record<ChimmyAlertSeverity, ChimmyAlertChannel[]>>
  sensitivity?: 'low' | 'normal' | 'high'

  // --- frequency & volume ---
  /** Global frequency multiplier applied to all alert cooldowns. */
  frequency?: 'normal' | 'reduced' | 'minimal'

  // --- per-class / per-type controls ---
  classPrefs?: Partial<Record<ChimmyAlertClass, ChimmyAlertClassPref>>
  typeOverrides?: Record<string, ChimmyAlertTypeOverride>

  // --- channel preferences ---
  channelPreferences?: {
    disablePush?: boolean
    disableEmail?: boolean
    disableSms?: boolean
  }

  // --- commissioner-specific ---
  commissionerPrefs?: ChimmyAlertCommissionerPref

  // --- per-league overrides ---
  leaguePrefs?: ChimmyAlertLeaguePref[]

  // --- active snoozes (keyed by dedupeKey) ---
  snoozedAlerts?: ChimmyAlertSnoozedEntry[]
}

export interface ChimmyAlertContext {
  userId: string
  role: 'member' | 'commissioner' | 'admin'
  sport: string
  leagueType: string
  leagueId?: string | null
  teamId?: string | null
  scoringConfig?: Record<string, unknown>
  rosterConfig?: Record<string, unknown>
  scheduleConfig?: Record<string, unknown>
  playoffConfig?: Record<string, unknown>
  draftConfig?: Record<string, unknown>
  teamState?: Record<string, unknown>
  leagueState?: Record<string, unknown>
  subscriptionState?: {
    hasPremium: boolean
    hasCommissioner: boolean
    hasAdmin: boolean
  }
  userPreferences?: ChimmyAlertUserPreferences
  signalBundle?: ChimmyAlertSignalBundle
  pageSurface?: string
  now?: Date
}

export interface ChimmyAlertCandidate {
  class: ChimmyAlertClass
  type: string
  title: string
  message: string
  confidenceScore: number
  urgencySignal: number
  urgencyDeadlineAt?: string | null
  dismissible?: boolean
  snoozable?: boolean
  repeatable?: boolean
  repeatCooldownMinutes?: number
  roleScope?: 'member' | 'commissioner' | 'admin'
  /**
   * League this candidate belongs to. `ChimmyAlert` already carries it; a candidate needs it
   * too whenever one sweep spans several leagues — otherwise two leagues' alerts for the same
   * player are indistinguishable, and per-league mute preferences cannot be applied.
   */
  leagueId?: string | null
  metadata?: Record<string, unknown>
}
